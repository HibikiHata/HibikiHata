// static/style.css の余白・文字サイズが :root のトークンだけで決まっていることを検証する。実行: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = (await readFile(path.join(REPO, "static/style.css"), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");

// 最初の :root { ... } をトークン定義とみなす
const rootMatch = css.match(/:root\s*\{([^}]*)\}/);
const tokens = Object.fromEntries(
  [...(rootMatch?.[1] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]),
);
const px = (name) => {
  const m = /^([\d.]+)rem$/.exec(tokens[name] ?? "");
  assert.ok(m, `${name} must be defined in rem in :root (got ${tokens[name]})`);
  return Number(m[1]) * 16;
};

test("style.css: 赤の系列（16/φ^n と 16·φ^n を 4px 格子に丸めた値）が定義されている", () => {
  const red = [4, 8, 12, 16, 24, 40, 68, 108];
  red.forEach((v, i) => assert.equal(px(`--space-r${i + 1}`), v, `--space-r${i + 1}`));
});

test("style.css: 青の系列（赤の 2 倍を 4px 格子に丸めた値）が定義されている", () => {
  const blue = [8, 12, 20, 32, 52, 84];
  blue.forEach((v, i) => assert.equal(px(`--space-b${i + 1}`), v, `--space-b${i + 1}`));
});

test("style.css: 本文は 1.25 倍、見出し用の数字は φ 倍の文字サイズが定義されている", () => {
  assert.equal(px("--text-0"), 16);
  assert.equal(px("--text-1"), 20);
  assert.equal(px("--text-2"), 25);
  assert.ok(Math.abs(px("--text-3") - 31.25) < 0.01);
  assert.equal(px("--text-small"), 12.8);
  assert.equal(px("--display-0"), 16);
  assert.equal(px("--display-1"), 26);
  assert.equal(px("--display-2"), 42);
});

test("style.css: 余白と文字サイズの宣言はトークン以外の生の値を使わない", () => {
  const body = css.replace(/:root\s*\{[^}]*\}/, "");
  const PROPS = /^(margin|padding|gap|row-gap|column-gap|font-size)(-[a-z-]+)?$/;
  // html の font-size: 100% は利用者のブラウザ設定を尊重するための基準値なので許す
  const ALLOWED = new Set(["0", "auto", "inherit", "100%"]);
  const bad = [];
  for (const [, prop, value] of body.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)) {
    if (!PROPS.test(prop)) continue;
    for (const part of value.trim().split(/\s+(?![^(]*\))/)) {
      if (ALLOWED.has(part) || /^var\(--(space|text|display)-[\w-]+\)$/.test(part)) continue;
      bad.push(`${prop}: ${value.trim()}`);
      break;
    }
  }
  assert.deepEqual(bad, []);
});
