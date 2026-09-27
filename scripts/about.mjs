// README.md を GitHub の Markdown API で HTML に変換し、/about/ の <main> を作る。
// README が About の唯一の正本。異常時は例外を投げ、ビルド全体を失敗させる（Vercel は直前のデプロイを配信し続ける）。

// 訪問者カウンター。About では数えたくないので除去する
const COUNTER = /<a [^>]*>\s*<img [^>]*komarev\.com[^>]*>\s*<\/a>/g;

export async function aboutMain({ readme, fetchImpl, token }) {
  const headers = {
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "hibikihata.com-build",
  };
  // 未認証は IP あたり 60 回/時。ビルド環境の IP は共有なので、設定があればトークンを使う
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetchImpl("https://api.github.com/markdown", {
    method: "POST",
    headers,
    body: JSON.stringify({ text: readme, mode: "gfm", context: "HibikiHata/HibikiHata" }),
  });
  if (!res.ok) throw new Error(`GitHub Markdown API: HTTP ${res.status}`);
  let body = await res.text();

  // README 側の書式が変わって見つからなくなったら、黙って残さず失敗させる
  if ((body.match(COUNTER) || []).length !== 1) {
    throw new Error("visitor counter not found exactly once; update the filter");
  }
  body = body.replace(COUNTER, "");
  if (body.includes("komarev.com")) throw new Error("visitor counter reference remains");

  // 相対パスの画像は /about/ 配下では解決できないため、リポジトリの raw URL に置き換える
  body = body.replaceAll(
    /(src|href)="assets\//g,
    '$1="https://raw.githubusercontent.com/HibikiHata/HibikiHata/main/assets/',
  );

  if (/<script/i.test(body)) throw new Error("rendered README contains <script>");

  return `<main>\n  <h1>About</h1>\n  <article class="markdown-body">\n${body}\n  </article>\n</main>`;
}
