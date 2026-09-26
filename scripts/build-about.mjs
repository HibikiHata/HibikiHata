// README.md を GitHub の Markdown API で HTML に変換し、public/about/index.html を生成する。
// README が About の唯一の正本。失敗時は非ゼロ終了し、Vercel は直前のデプロイを配信し続ける。
import { mkdir, readFile, writeFile } from "node:fs/promises";

const readme = await readFile("README.md", "utf8");

const headers = {
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
  "User-Agent": "hibikihata.com-build",
};
// 未認証は IP あたり 60 回/時。ビルド環境の IP は共有なので、設定があればトークンを使う
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const res = await fetch("https://api.github.com/markdown", {
  method: "POST",
  headers,
  body: JSON.stringify({ text: readme, mode: "gfm", context: "HibikiHata/HibikiHata" }),
});
if (!res.ok) {
  console.error(`GitHub Markdown API: HTTP ${res.status}`);
  process.exit(1);
}
let body = await res.text();

// 訪問者カウンターを除去する。README 側の書式が変わって見つからなくなったら、黙って残さず失敗させる
const counter = /<a [^>]*>\s*<img [^>]*komarev\.com[^>]*>\s*<\/a>/g;
if ((body.match(counter) || []).length !== 1) {
  console.error("visitor counter not found exactly once; update the filter");
  process.exit(1);
}
body = body.replace(counter, "");
if (body.includes("komarev.com")) {
  console.error("visitor counter reference remains");
  process.exit(1);
}

// 相対パスの画像は /about/ 配下では解決できないため、リポジトリの raw URL に置き換える
body = body.replaceAll(
  /(src|href)="assets\//g,
  '$1="https://raw.githubusercontent.com/HibikiHata/HibikiHata/main/assets/',
);

if (/<script/i.test(body)) {
  console.error("rendered README contains <script>");
  process.exit(1);
}

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>About — Hibiki Hata</title>
<meta name="description" content="Who Hibiki Hata is and what Hibiki Hata builds, mirrored from the GitHub profile.">
<link rel="stylesheet" href="/github-markdown.css">
<link rel="stylesheet" href="/style.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>
<script defer src="/_vercel/insights/script.js"></script>
</head>
<body>
<header>
  <a href="/">Hibiki Hata</a>
  <nav aria-label="Site"><a href="/about/">About</a> · <a href="/contact/">Contact</a></nav>
</header>
<main>
  <h1>About</h1>
  <article class="markdown-body">
${body}
  </article>
</main>
<footer>
  <small>© 2026 Hibiki Hata · <a href="/privacy/">Privacy</a></small>
</footer>
</body>
</html>
`;
// public/about/ は生成物しか置かないため Git に追跡されず、クリーンなチェックアウトには存在しない
await mkdir("public/about", { recursive: true });
await writeFile("public/about/index.html", page);
console.log(`public/about/index.html: ${page.length} bytes`);
