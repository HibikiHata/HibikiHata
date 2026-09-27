// scripts/build.mjs と scripts/about.mjs の振る舞いを検証する。実行: node --test（リポジトリ直下で）
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSite, parsePage, renderPage, sitemapXml } from "../scripts/build.mjs";
import { aboutMain } from "../scripts/about.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// テスト用の最小レイアウト。本物の src/layout.html と同じ枠名を使う
const LAYOUT = `<title>{{title}}</title>
{{head}}
<header>{{brand}}</header>
{{main}}
<footer></footer>
`;

async function tempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "site-build-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function put(root, rel, body) {
  const file = path.join(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
}

// 他のテストが書き換えないよう、fetch は引数で差し込む
function fakeFetch(html, status = 200) {
  return async () => ({ ok: status === 200, status, text: async () => html });
}

const COUNTER = '<a href="https://github.com/HibikiHata"><img src="https://komarev.com/ghpvc/?username=HibikiHata"></a>';

// ---------- parsePage ----------

test("parsePage: front matter の値と本文を分けて返す", () => {
  const page = parsePage(
    "<!--\ntitle: Contact — Hibiki Hata\ndescription: How to reach: here.\n-->\n<main>\n  <p>Hi</p>\n</main>\n",
    "contact/index.html",
  );
  assert.deepEqual(page.meta, {
    title: "Contact — Hibiki Hata",
    description: "How to reach: here.",
    type: "website",
    noindex: false,
  });
  assert.equal(page.main, "<main>\n  <p>Hi</p>\n</main>");
});

test("parsePage: type と noindex を読み取る", () => {
  const article = parsePage("<!--\ntitle: T\ndescription: D\ntype: article\n-->\n<main></main>\n", "a.html");
  assert.equal(article.meta.type, "article");
  const missing = parsePage("<!--\ntitle: Page not found\nnoindex: true\n-->\n<main></main>\n", "404.html");
  assert.equal(missing.meta.noindex, true);
  assert.equal(missing.meta.description, undefined);
});

test("parsePage: 未知のキーはファイル名つきで失敗する", () => {
  assert.throws(() => parsePage("<!--\ntitle: T\ndescription: D\ndate: 2026-09-27\n-->\n<main></main>\n", "x/index.html"), /x\/index\.html.*date/);
});

test("parsePage: title が無いと失敗する", () => {
  assert.throws(() => parsePage("<!--\ndescription: D\n-->\n<main></main>\n", "x.html"), /title/);
});

test("parsePage: 検索対象のページで description が無いと失敗する", () => {
  assert.throws(() => parsePage("<!--\ntitle: T\n-->\n<main></main>\n", "x.html"), /description/);
});

test("parsePage: front matter が無いと失敗する", () => {
  assert.throws(() => parsePage("<main></main>\n", "x.html"), /front matter/);
});

test("parsePage: type は website と article 以外を受け付けない", () => {
  assert.throws(() => parsePage("<!--\ntitle: T\ndescription: D\ntype: blog\n-->\n<main></main>\n", "x.html"), /type/);
});

// ---------- renderPage ----------

const META = { title: "Contact — Hibiki Hata", description: "How to reach.", type: "website", noindex: false };

test("renderPage: canonical と og:url にパスから作った同じ URL を入れる", () => {
  const html = renderPage({ layout: LAYOUT, meta: META, main: "<main></main>", urlPath: "/contact/" });
  assert.ok(html.includes('<link rel="canonical" href="https://hibikihata.com/contact/">'));
  assert.ok(html.includes('<meta property="og:url" content="https://hibikihata.com/contact/">'));
});

test("renderPage: title と description を og と twitter の meta にも入れる", () => {
  const html = renderPage({ layout: LAYOUT, meta: META, main: "<main></main>", urlPath: "/contact/" });
  assert.ok(html.includes("<title>Contact — Hibiki Hata</title>"));
  assert.ok(html.includes('<meta name="description" content="How to reach.">'));
  assert.ok(html.includes('<meta property="og:title" content="Contact — Hibiki Hata">'));
  assert.ok(html.includes('<meta property="og:description" content="How to reach.">'));
  assert.ok(html.includes('<meta property="og:image" content="https://hibikihata.com/images/og-v1.png">'));
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image">'));
});

test("renderPage: トップページだけ名前を h1 にし、他はトップへのリンクにする", () => {
  const home = renderPage({ layout: LAYOUT, meta: META, main: "<main></main>", urlPath: "/" });
  const other = renderPage({ layout: LAYOUT, meta: META, main: "<main></main>", urlPath: "/contact/" });
  assert.ok(home.includes("<header><h1>Hibiki Hata</h1></header>"));
  assert.ok(other.includes('<header><a href="/">Hibiki Hata</a></header>'));
});

test("renderPage: 記事は og:type を article にする", () => {
  const html = renderPage({ layout: LAYOUT, meta: { ...META, type: "article" }, main: "<main></main>", urlPath: "/writing/x/" });
  assert.ok(html.includes('<meta property="og:type" content="article">'));
});

test("renderPage: noindex のページは robots を入れ、canonical・og・twitter を出さない", () => {
  const html = renderPage({
    layout: LAYOUT,
    meta: { title: "Page not found — Hibiki Hata", type: "website", noindex: true },
    main: "<main></main>",
    urlPath: null,
  });
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
  assert.ok(!html.includes("canonical"));
  assert.ok(!html.includes('property="og:'));
  assert.ok(!html.includes('name="twitter:'));
  assert.ok(!html.includes('name="description"'));
});

test("renderPage: 追加のスタイルシートを style.css より前に置く", () => {
  const html = renderPage({
    layout: LAYOUT,
    meta: META,
    main: "<main></main>",
    urlPath: "/about/",
    stylesheets: ["/github-markdown.css"],
  });
  const extra = html.indexOf('<link rel="stylesheet" href="/github-markdown.css">');
  const base = html.indexOf('<link rel="stylesheet" href="/style.css">');
  assert.ok(extra !== -1 && base !== -1, "both stylesheets must be present");
  assert.ok(extra < base);
});

test("renderPage: 属性と title の値を HTML エスケープする", () => {
  const html = renderPage({
    layout: LAYOUT,
    meta: { ...META, title: 'A & B <"C">', description: 'say "hi" & <go>' },
    main: "<main></main>",
    urlPath: "/x/",
  });
  assert.ok(html.includes("<title>A &amp; B &lt;&quot;C&quot;&gt;</title>"));
  assert.ok(html.includes('<meta name="description" content="say &quot;hi&quot; &amp; &lt;go&gt;">'));
});

test("renderPage: 本文の $ 記号や {{...}} はそのまま残す", () => {
  const main = "<main><code>$&amp; $' $1 {{title}}</code></main>";
  const html = renderPage({ layout: LAYOUT, meta: META, main, urlPath: "/x/" });
  assert.ok(html.includes(main));
});

test("renderPage: レイアウトに未知の枠があると失敗する", () => {
  assert.throws(
    () => renderPage({ layout: LAYOUT + "{{sidebar}}", meta: META, main: "<main></main>", urlPath: "/x/" }),
    /sidebar/,
  );
});

// ---------- sitemapXml ----------

test("sitemapXml: URL をパス順に並べ、lastmod などを書かない", () => {
  const xml = sitemapXml(["/writing/x/", "/", "/about/"]);
  assert.equal(
    xml,
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      "  <url><loc>https://hibikihata.com/</loc></url>\n" +
      "  <url><loc>https://hibikihata.com/about/</loc></url>\n" +
      "  <url><loc>https://hibikihata.com/writing/x/</loc></url>\n" +
      "</urlset>\n",
  );
});

// ---------- aboutMain ----------

test("aboutMain: README の HTML を About の本文に包む", async () => {
  const main = await aboutMain({ readme: "# Hi", fetchImpl: fakeFetch(`<p>Hi</p>${COUNTER}`) });
  assert.equal(main, '<main>\n  <h1>About</h1>\n  <article class="markdown-body">\n<p>Hi</p>\n  </article>\n</main>');
});

test("aboutMain: 相対パスの画像をリポジトリの raw URL に置き換える", async () => {
  const main = await aboutMain({ readme: "x", fetchImpl: fakeFetch(`<img src="assets/pixel.png">${COUNTER}`) });
  assert.ok(main.includes('src="https://raw.githubusercontent.com/HibikiHata/HibikiHata/main/assets/pixel.png"'));
});

test("aboutMain: 訪問者カウンターがちょうど1つでなければ失敗する", async () => {
  await assert.rejects(aboutMain({ readme: "x", fetchImpl: fakeFetch("<p>no counter</p>") }), /counter/);
  await assert.rejects(aboutMain({ readme: "x", fetchImpl: fakeFetch(COUNTER + COUNTER) }), /counter/);
});

test("aboutMain: 変換結果に script があれば失敗する", async () => {
  await assert.rejects(aboutMain({ readme: "x", fetchImpl: fakeFetch(`<script>x</script>${COUNTER}`) }), /script/);
});

test("aboutMain: API が失敗したら HTTP ステータスつきで失敗する", async () => {
  await assert.rejects(aboutMain({ readme: "x", fetchImpl: fakeFetch("", 403) }), /403/);
});

// ---------- buildSite（一時ディレクトリでの統合） ----------

async function fixtureSite(t) {
  const root = await tempDir(t);
  await put(root, "src/layout.html", LAYOUT);
  await put(root, "src/pages/index.html", "<!--\ntitle: Home\ndescription: D\n-->\n<main>home</main>\n");
  await put(root, "src/pages/writing/x/index.html", "<!--\ntitle: X\ndescription: D\ntype: article\n-->\n<main>x</main>\n");
  await put(root, "src/pages/404.html", "<!--\ntitle: Not found\nnoindex: true\n-->\n<main>404</main>\n");
  await put(root, "static/style.css", "body{}");
  await put(root, "static/images/og-v1.png", "png");
  await put(root, "README.md", "# Hi");
  return root;
}

test("buildSite: ページを <パス>/index.html に、404 を 404.html に書き出す", async (t) => {
  const root = await fixtureSite(t);
  await buildSite({ root, fetchImpl: fakeFetch(`<p>Hi</p>${COUNTER}`) });
  const dist = path.join(root, "dist");
  assert.ok((await readFile(path.join(dist, "index.html"), "utf8")).includes("<main>home</main>"));
  assert.ok((await readFile(path.join(dist, "writing/x/index.html"), "utf8")).includes("<main>x</main>"));
  assert.ok((await readFile(path.join(dist, "404.html"), "utf8")).includes("<main>404</main>"));
  assert.ok((await readFile(path.join(dist, "about/index.html"), "utf8")).includes("<p>Hi</p>"));
});

test("buildSite: static/ の中身をそのまま dist/ にコピーする", async (t) => {
  const root = await fixtureSite(t);
  await buildSite({ root, fetchImpl: fakeFetch(`<p>Hi</p>${COUNTER}`) });
  assert.equal(await readFile(path.join(root, "dist/style.css"), "utf8"), "body{}");
  assert.equal(await readFile(path.join(root, "dist/images/og-v1.png"), "utf8"), "png");
});

test("buildSite: sitemap に検索対象のページと About だけを載せる", async (t) => {
  const root = await fixtureSite(t);
  await buildSite({ root, fetchImpl: fakeFetch(`<p>Hi</p>${COUNTER}`) });
  const xml = await readFile(path.join(root, "dist/sitemap.xml"), "utf8");
  assert.equal(xml, sitemapXml(["/", "/about/", "/writing/x/"]));
});

test("buildSite: 前回の出力を消してから作り直す", async (t) => {
  const root = await fixtureSite(t);
  await put(root, "dist/stale.html", "old");
  await buildSite({ root, fetchImpl: fakeFetch(`<p>Hi</p>${COUNTER}`) });
  assert.ok(!(await readdir(path.join(root, "dist"))).includes("stale.html"));
});

test("buildSite: static/ に HTML があると失敗する", async (t) => {
  const root = await fixtureSite(t);
  await put(root, "static/contact/index.html", "<p>old</p>");
  await assert.rejects(buildSite({ root, fetchImpl: fakeFetch(`<p>Hi</p>${COUNTER}`) }), /static.*html/i);
});

test("buildSite: static/ の sitemap.xml は生成物と重なるので失敗する", async (t) => {
  const root = await fixtureSite(t);
  await put(root, "static/sitemap.xml", "<urlset/>");
  await assert.rejects(buildSite({ root, fetchImpl: fakeFetch(`<p>Hi</p>${COUNTER}`) }), /sitemap\.xml/);
});

test("buildSite: About の取得に失敗したらビルド全体を失敗させる", async (t) => {
  const root = await fixtureSite(t);
  await assert.rejects(buildSite({ root, fetchImpl: fakeFetch("", 500) }), /500/);
});

// ---------- 本物のソースでの不変条件 ----------

test("実サイト: 全ページが不変条件を満たす", async (t) => {
  const outDir = await tempDir(t);
  await buildSite({ root: REPO, outDir, fetchImpl: fakeFetch(`<p>About body</p>${COUNTER}`) });
  const xml = await readFile(path.join(outDir, "sitemap.xml"), "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, [
    "https://hibikihata.com/",
    "https://hibikihata.com/about/",
    "https://hibikihata.com/contact/",
    "https://hibikihata.com/privacy/",
    "https://hibikihata.com/projects/pinterest-post/privacy/",
    "https://hibikihata.com/writing/rdap-me-false-negative/",
  ]);
  for (const loc of locs) {
    const rel = loc.replace("https://hibikihata.com/", "");
    const html = await readFile(path.join(outDir, rel, "index.html"), "utf8");
    assert.equal(html.match(/<h1[ >]/g)?.length, 1, `${loc}: h1 must appear exactly once`);
    assert.ok(html.includes(`<link rel="canonical" href="${loc}">`), `${loc}: canonical`);
    assert.ok(html.includes(`<meta property="og:url" content="${loc}">`), `${loc}: og:url`);
    assert.ok(html.includes('<a class="xbtn follow"'), `${loc}: follow button`);
    assert.ok(!/\{\{\w+\}\}/.test(html.split("<main>")[0]), `${loc}: unfilled placeholder`);
  }
  const notFound = await readFile(path.join(outDir, "404.html"), "utf8");
  assert.ok(notFound.includes('<meta name="robots" content="noindex">'));
  for (const asset of ["style.css", "github-markdown.css", "favicon.svg", "robots.txt", "llms.txt", "images/og-v1.png"]) {
    await readFile(path.join(outDir, asset));
  }
});

// ---------- 追加: 失敗パスと契約（2026-09-27 レビュー反映） ----------

import { spawnSync } from "node:child_process";

const BUILD_SCRIPT = path.join(REPO, "scripts/build.mjs");

test("parsePage: 同じキーが2回あると失敗する", () => {
  assert.throws(() => parsePage("<!--\ntitle: A\ntitle: B\ndescription: D\n-->\n<main></main>\n", "x.html"), /duplicate.*title/);
});

test("parsePage: key: value 形式でない行は失敗する", () => {
  assert.throws(() => parsePage("<!--\ntitle: T\ndescription: D\njust text\n-->\n<main></main>\n", "x.html"), /malformed/);
});

test("parsePage: noindex は true 以外を受け付けない", () => {
  assert.throws(() => parsePage("<!--\ntitle: T\ndescription: D\nnoindex: false\n-->\n<main></main>\n", "x.html"), /noindex/);
});

test("renderPage: シングルクォートもエスケープする", () => {
  const html = renderPage({ layout: LAYOUT, meta: { ...META, title: "it's" }, main: "<main></main>", urlPath: "/x/" });
  assert.ok(html.includes("<title>it&#39;s</title>"));
  assert.ok(html.includes('<meta property="og:title" content="it&#39;s">'));
});

test("renderPage: 共有用の固定 meta とアイコンをすべて出す", () => {
  const html = renderPage({ layout: LAYOUT, meta: META, main: "<main></main>", urlPath: "/contact/" });
  for (const tag of [
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '<meta property="og:site_name" content="Hibiki Hata">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:type" content="image/png">',
    '<meta property="og:image:alt" content="Hibiki Hata, hibikihata.com">',
    '<meta name="twitter:site" content="@00001Neo">',
    '<meta name="twitter:image:alt" content="Hibiki Hata, hibikihata.com">',
  ]) {
    assert.ok(html.includes(tag), tag);
  }
});

test("aboutMain: GitHub Markdown API を決まった内容で呼び、トークンがあれば Bearer で渡す", async () => {
  const calls = [];
  const spy = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, text: async () => `<p>x</p>${COUNTER}` };
  };
  await aboutMain({ readme: "# Readme", fetchImpl: spy, token: "t0ken" });
  await aboutMain({ readme: "# Readme", fetchImpl: spy });
  const [withToken, withoutToken] = calls;
  assert.equal(withToken.url, "https://api.github.com/markdown");
  assert.equal(withToken.options.method, "POST");
  assert.equal(withToken.options.headers.Accept, "application/vnd.github+json");
  assert.equal(withToken.options.headers["Content-Type"], "application/json");
  assert.equal(withToken.options.headers["User-Agent"], "hibikihata.com-build");
  assert.deepEqual(JSON.parse(withToken.options.body), { text: "# Readme", mode: "gfm", context: "HibikiHata/HibikiHata" });
  assert.equal(withToken.options.headers.Authorization, "Bearer t0ken");
  assert.equal(withoutToken.options.headers.Authorization, undefined);
});

test("aboutMain: 応答待ちに上限を設ける（AbortSignal を渡す）", async () => {
  let signal;
  await aboutMain({
    readme: "x",
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      return { ok: true, status: 200, text: async () => `<p>x</p>${COUNTER}` };
    },
  });
  assert.ok(signal instanceof AbortSignal);
});

test("aboutMain: 大文字の <SCRIPT> も拒否する", async () => {
  await assert.rejects(aboutMain({ readme: "x", fetchImpl: fakeFetch(`<SCRIPT>x</SCRIPT>${COUNTER}`) }), /script/);
});

test("aboutMain: href の相対パスも raw URL に置き換える", async () => {
  const main = await aboutMain({ readme: "x", fetchImpl: fakeFetch(`<a href="assets/file.png">f</a>${COUNTER}`) });
  assert.ok(main.includes('href="https://raw.githubusercontent.com/HibikiHata/HibikiHata/main/assets/file.png"'));
});

test("aboutMain: カウンター除去後も komarev.com の参照が残れば失敗する", async () => {
  await assert.rejects(
    aboutMain({ readme: "x", fetchImpl: fakeFetch(`${COUNTER}<img src="https://komarev.com/other">`) }),
    /counter reference remains/,
  );
});

test("buildSite: 出力したファイル数と sitemap のページ数を返す", async (t) => {
  const root = await fixtureSite(t);
  const result = await buildSite({ root, fetchImpl: fakeFetch(`<p>Hi</p>${COUNTER}`) });
  // static 2 + ページ 3 + about + sitemap
  assert.deepEqual(result, { pages: 7, indexable: 3 });
});

test("buildSite: 404.html に noindex が無いと失敗する", async (t) => {
  const root = await fixtureSite(t);
  await put(root, "src/pages/404.html", "<!--\ntitle: Not found\ndescription: D\n-->\n<main>404</main>\n");
  await assert.rejects(buildSite({ root, fetchImpl: fakeFetch(`<p>Hi</p>${COUNTER}`) }), /404\.html.*noindex/);
});

test("buildSite: index.html 以外の名前のページは失敗する", async (t) => {
  const root = await fixtureSite(t);
  await put(root, "src/pages/contact.html", "<!--\ntitle: T\ndescription: D\n-->\n<main></main>\n");
  await assert.rejects(buildSite({ root, fetchImpl: fakeFetch(`<p>Hi</p>${COUNTER}`) }), /contact\.html.*index\.html/);
});

test("buildSite: src/pages に .html 以外があると失敗する", async (t) => {
  const root = await fixtureSite(t);
  await put(root, "src/pages/note.txt", "memo");
  await assert.rejects(buildSite({ root, fetchImpl: fakeFetch(`<p>Hi</p>${COUNTER}`) }), /note\.txt/);
});

test("buildSite: src/pages/about/ は生成される About と重なるので失敗する", async (t) => {
  const root = await fixtureSite(t);
  await put(root, "src/pages/about/index.html", "<!--\ntitle: T\ndescription: D\n-->\n<main></main>\n");
  await assert.rejects(buildSite({ root, fetchImpl: fakeFetch(`<p>Hi</p>${COUNTER}`) }), /collision.*about\/index\.html/);
});

test("buildSite: URL に使えない文字を含むページのパスは失敗する", async (t) => {
  const root = await fixtureSite(t);
  await put(root, "src/pages/Bad Name/index.html", "<!--\ntitle: T\ndescription: D\n-->\n<main></main>\n");
  await assert.rejects(buildSite({ root, fetchImpl: fakeFetch(`<p>Hi</p>${COUNTER}`) }), /Bad Name/);
});

test("buildSite: .DS_Store などのドットファイルは無視し、公開もしない", async (t) => {
  const root = await fixtureSite(t);
  await put(root, "src/pages/.DS_Store", "junk");
  await put(root, "static/.DS_Store", "junk");
  await put(root, "static/images/.DS_Store", "junk");
  await buildSite({ root, fetchImpl: fakeFetch(`<p>Hi</p>${COUNTER}`) });
  const out = await readdir(path.join(root, "dist"), { recursive: true });
  assert.ok(!out.some((p) => p.split(path.sep).pop().startsWith(".")), out.join(","));
});

test("CLI: 異常があれば終了コード 1 で止まり、理由を stderr に出す", async (t) => {
  const root = await fixtureSite(t);
  await put(root, "static/contact/index.html", "<p>stale</p>");
  const run = spawnSync(process.execPath, [BUILD_SCRIPT], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /static\/contact\/index\.html/);
});

// ---------- 追加: 最終レビュー反映（2026-09-27） ----------

test("buildSite: .well-known/ などのドットディレクトリは公開する", async (t) => {
  const root = await fixtureSite(t);
  await put(root, "static/.well-known/security.txt", "Contact: x");
  await buildSite({ root, fetchImpl: fakeFetch(`<p>Hi</p>${COUNTER}`) });
  assert.equal(await readFile(path.join(root, "dist/.well-known/security.txt"), "utf8"), "Contact: x");
});

test("buildSite: ドットで始まる HTML を static/ に置いても黙って消さず失敗する", async (t) => {
  const root = await fixtureSite(t);
  await put(root, "static/.old-page.html", "<p>old</p>");
  await assert.rejects(buildSite({ root, fetchImpl: fakeFetch(`<p>Hi</p>${COUNTER}`) }), /\.old-page\.html/);
});

test("buildSite: macOS の ._ ファイルも無視する", async (t) => {
  const root = await fixtureSite(t);
  await put(root, "src/pages/._index.html", "junk");
  await buildSite({ root, fetchImpl: fakeFetch(`<p>Hi</p>${COUNTER}`) });
  assert.ok(!(await readdir(path.join(root, "dist"))).includes("._index.html"));
});

test("aboutMain: タイムアウトは 30 秒", async (t) => {
  const timeout = t.mock.method(AbortSignal, "timeout");
  await aboutMain({ readme: "x", fetchImpl: fakeFetch(`<p>x</p>${COUNTER}`) });
  assert.deepEqual(timeout.mock.calls.map((c) => c.arguments), [[30_000]]);
});

test("CLI: 失敗時はスタックトレースも出す", async (t) => {
  const root = await fixtureSite(t);
  await put(root, "static/contact/index.html", "<p>stale</p>");
  const run = spawnSync(process.execPath, [BUILD_SCRIPT], { cwd: root, encoding: "utf8" });
  assert.match(run.stderr, /\n\s+at .*build\.mjs/);
});
