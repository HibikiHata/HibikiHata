// サイトを dist/ に組み立てる。外部ライブラリは使わない。
//   static/     … そのままコピーする素材（CSS・画像・robots.txt 等）
//   src/layout.html … 全ページ共通の骨格（head・header・footer）。唯一の正本
//   src/pages/  … ページごとの front matter と <main>
// 異常時は例外で非ゼロ終了し、Vercel は直前のデプロイを配信し続ける。
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { aboutMain } from "./about.mjs";

const ORIGIN = "https://hibikihata.com";
const SITE_NAME = "Hibiki Hata";
const OG_IMAGE = `${ORIGIN}/images/og-v1.png`;
const OG_IMAGE_ALT = "Hibiki Hata, hibikihata.com";
const KEYS = new Set(["title", "description", "type", "noindex"]);
const TYPES = new Set(["website", "article"]);

const ABOUT_META = {
  title: "About — Hibiki Hata",
  description: "Who Hibiki Hata is and what Hibiki Hata builds, mirrored from the GitHub profile.",
  type: "website",
  noindex: false,
};

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// 先頭の <!-- ... --> を "key: value" の front matter として読む
export function parsePage(source, file) {
  const m = source.match(/^<!--\n([\s\S]*?)\n-->\n/);
  if (!m) throw new Error(`${file}: missing front matter comment at the top`);
  const meta = { type: "website", noindex: false };
  const seen = new Set();
  for (const line of m[1].split("\n")) {
    if (!line.trim()) continue;
    const i = line.indexOf(": ");
    if (i < 0) throw new Error(`${file}: malformed front matter line: ${line}`);
    const key = line.slice(0, i);
    const value = line.slice(i + 2).trim();
    if (!KEYS.has(key)) throw new Error(`${file}: unknown front matter key "${key}"`);
    if (seen.has(key)) throw new Error(`${file}: duplicate front matter key "${key}"`);
    seen.add(key);
    if (key === "noindex") {
      if (value !== "true") throw new Error(`${file}: noindex must be "true" when present`);
      meta.noindex = true;
    } else {
      meta[key] = value;
    }
  }
  if (!meta.title) throw new Error(`${file}: title is required`);
  if (!meta.noindex && !meta.description) throw new Error(`${file}: description is required for indexable pages`);
  if (!TYPES.has(meta.type)) throw new Error(`${file}: type must be website or article, got "${meta.type}"`);
  return { meta, main: source.slice(m[0].length).trim() };
}

function headLines({ meta, url, stylesheets }) {
  const lines = [];
  if (meta.description !== undefined) lines.push(`<meta name="description" content="${escapeHtml(meta.description)}">`);
  if (meta.noindex) lines.push('<meta name="robots" content="noindex">');
  for (const href of [...stylesheets, "/style.css"]) lines.push(`<link rel="stylesheet" href="${href}">`);
  lines.push('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
  if (meta.noindex) return lines;
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  lines.push(
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:type" content="${meta.type}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${OG_IMAGE}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:type" content="image/png">',
    `<meta property="og:image:alt" content="${OG_IMAGE_ALT}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:site" content="@00001Neo">',
    `<meta name="twitter:image:alt" content="${OG_IMAGE_ALT}">`,
  );
  return lines;
}

// レイアウトの {{name}} を1回の走査で置き換える。本文側の $ や {{...}} には触れない
export function renderPage({ layout, meta, main, urlPath, stylesheets = [] }) {
  const url = urlPath === null ? null : ORIGIN + urlPath;
  const values = {
    title: escapeHtml(meta.title),
    head: headLines({ meta, url, stylesheets }).join("\n"),
    brand: urlPath === "/" ? `<h1>${SITE_NAME}</h1>` : `<a href="/">${SITE_NAME}</a>`,
    main,
  };
  return layout.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`layout: unknown placeholder {{${name}}}`);
    return values[name];
  });
}

export function sitemapXml(urlPaths) {
  const urls = [...urlPaths].sort().map((p) => `  <url><loc>${ORIGIN}${p}</loc></url>\n`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>\n`;
}

async function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    // macOS が勝手に作るファイルは素材でもページでもない。公開もしない。
    // それ以外のドットファイル（.well-known/ 等）は通常どおり扱い、誤配置は検査で止める
    if (entry.name === ".DS_Store" || entry.name.startsWith("._")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

// src/pages/ 内の相対パス → 公開 URL のパス（404 は URL を持たない）
function urlPathOf(rel) {
  if (rel === "404.html") return null;
  if (rel === "index.html") return "/";
  if (!rel.endsWith("/index.html")) throw new Error(`src/pages/${rel}: pages must be named index.html (or 404.html)`);
  const dir = rel.slice(0, -"/index.html".length);
  // canonical・sitemap にそのまま入るので、エスケープの要らない文字だけを許す
  if (!dir.split("/").every((seg) => /^[a-z0-9-]+$/.test(seg))) {
    throw new Error(`src/pages/${rel}: directory names may use only a-z, 0-9 and "-"`);
  }
  return `/${dir}/`;
}

export async function buildSite({ root, outDir = path.join(root, "dist"), fetchImpl, token }) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const written = new Set();
  const write = async (rel, body) => {
    if (written.has(rel)) throw new Error(`output collision: ${rel} is produced twice`);
    written.add(rel);
    await mkdir(path.dirname(path.join(outDir, rel)), { recursive: true });
    await writeFile(path.join(outDir, rel), body);
  };

  // 素材のコピー。HTML と sitemap.xml は生成物なので、static/ に残っていたら古い写しとみなして止める
  const staticDir = path.join(root, "static");
  for (const rel of await listFiles(staticDir)) {
    if (rel.endsWith(".html")) throw new Error(`static/${rel}: HTML belongs in src/pages/, not static/`);
    if (rel === "sitemap.xml") throw new Error("static/sitemap.xml: sitemap.xml is generated; delete the static copy");
    written.add(rel);
    await mkdir(path.dirname(path.join(outDir, rel)), { recursive: true });
    await copyFile(path.join(staticDir, rel), path.join(outDir, rel));
  }

  const layout = await readFile(path.join(root, "src/layout.html"), "utf8");
  const indexable = [];
  const pagesDir = path.join(root, "src/pages");
  for (const rel of await listFiles(pagesDir)) {
    if (!rel.endsWith(".html")) throw new Error(`src/pages/${rel}: only .html files belong in src/pages/`);
    const { meta, main } = parsePage(await readFile(path.join(pagesDir, rel), "utf8"), `src/pages/${rel}`);
    const urlPath = urlPathOf(rel);
    if (urlPath === null && !meta.noindex) throw new Error(`src/pages/${rel}: noindex: true is required (the page has no URL)`);
    await write(rel, renderPage({ layout, meta, main, urlPath }));
    if (!meta.noindex) indexable.push(urlPath);
  }

  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const about = await aboutMain({ readme, fetchImpl, token });
  await write("about/index.html", renderPage({ layout, meta: ABOUT_META, main: about, urlPath: "/about/", stylesheets: ["/github-markdown.css"] }));
  indexable.push("/about/");

  await write("sitemap.xml", sitemapXml(indexable));
  return { pages: written.size, indexable: indexable.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(`node ${process.version}`);
    const { pages, indexable } = await buildSite({ root: process.cwd(), fetchImpl: fetch, token: process.env.GITHUB_TOKEN });
    console.log(`dist/: ${pages} files, ${indexable} pages in sitemap.xml`);
  } catch (err) {
    // 想定外の不具合も追えるよう、スタックごと出す
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  }
}
