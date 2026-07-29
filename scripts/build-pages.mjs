#!/usr/bin/env node
//
// oblivious.jp のページ生成器（kaminogoya/oblivious.jp#3）。
//
// `help/help.json` を正本に `help/index.html` を作る。**生成物はコミットする**（issue #3 の案 B1）。
// 生成を選んだ理由は「JS が動かなくても本文が読めること」で、これはこの先ここへ載せる
// privacy / terms のために要る性質。help だけなら client-side でも足りていた。
//
// 出力は**既存ページと同じ形**にしている — en を HTML に直書きし、ja を `__I18N_MESSAGES__` に置く。
// そうすることで `i18n.js` / `nav.js` / `style.css` の作りに乗ったままでいられる。
// ただし 1 点だけ足りず、`i18n.js` に `data-i18n-html`（innerHTML で差し替える口）を追加した。
// help の本文は `**強調**` を使うのに対し `data-i18n` は textContent 差し替えで markup を運べず、
// しかも en と ja で強調の並びが違う（en `a **film** is…` / ja `**film** は…`）ため、
// en から起こした DOM を ja が使い回せないため。
//
//   使い方:  node scripts/build-pages.mjs          # 生成して書き出す
//            node scripts/build-pages.mjs --check  # 書き出さず、出力が最新かだけ見る（差分があれば exit 1）
//
// `--check` は「走らせ忘れ」の検出用。B1 の唯一の弱点がそこなので、手元で確認できるようにしてある。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ページ側で先に使っている id。トピックの anchor と衝突すると、リンクが別物を指す。
const RESERVED_IDS = new Set(["help-title", "site-nav"]);

// -----------------------------------------------------------------------------
// 文字列
// -----------------------------------------------------------------------------

function escapeHTML(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/// JS の文字列リテラルにする。`<` を `<` へ逃がすことで、値に `</script>` が現れても
/// `<script>` ブロックが閉じない。実行時にはただの `<` に戻るので innerHTML にそのまま使える。
function jsString(value) {
  return JSON.stringify(value).replace(/</g, "\\u003C");
}

/// 本文が使ってよい markdown は `**強調**` だけ。それ以外を見つけたら止める。
///
/// アプリ側は `AttributedString(markdown:)` に通すのでリンクやコードも解釈してしまう。
/// ここで黙って素通しすると、同じ JSON からアプリと Web で別のものが出る。
function assertOnlySupportedMarkdown(plain, where) {
  const unsupported = [
    [/`/, "コードスパン（`）"],
    [/\]\(/, "リンク（[…](…)）"],
    [/~~/, "打ち消し（~~）"],
    [/\*/, "対になっていない、または単独の *"]
  ];
  for (const [pattern, label] of unsupported) {
    if (pattern.test(plain)) {
      throw new Error(
        `${where}: ${label} は Web 側の描画が対応していない。` +
          `help.json 側で書き換えるか、この生成器と HelpContentKit の両方を対応させること。`
      );
    }
  }
}

/// `**強調**` を `<strong>` にしつつ、それ以外をすべてエスケープする。
function renderInline(text, where) {
  let html = "";
  let plain = "";
  let index = 0;
  const pattern = /\*\*([^*]+)\*\*/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const before = text.slice(index, match.index);
    html += escapeHTML(before);
    plain += before;
    html += `<strong>${escapeHTML(match[1])}</strong>`;
    index = match.index + match[0].length;
  }
  const rest = text.slice(index);
  html += escapeHTML(rest);
  plain += rest;
  assertOnlySupportedMarkdown(plain, where);
  return html;
}

const hasEmphasis = (text) => /\*\*[^*]+\*\*/.test(text);

/// `data-i18n` のキーは JS の識別子として書きたいので、id の `-` を `_` に寄せる。
/// 寄せた結果がぶつかることはあり得るので、呼び出し側で全キーの一意性を確認する。
const keyPart = (id) => id.replace(/[^A-Za-z0-9]/g, "_");

// -----------------------------------------------------------------------------
// help.json → ノードの列
// -----------------------------------------------------------------------------

/// 生成する 1 ノード。`kind` は出力先のタグ、`key` は i18n のキー。
/// `html` が true なら `data-i18n-html`（innerHTML 差し替え）、false なら `data-i18n`（textContent 差し替え）。
///
/// `en` は必ず HTML として埋められる形にし、`ja` は差し替え方に合わせる —
/// textContent へ渡す値は生のまま（代入時にブラウザが扱う）、innerHTML へ渡す値は HTML。
function node(kind, key, en, ja, html, extra = {}) {
  return { kind, key, en, ja, html, ...extra };
}

/// 強調の有無を見て、片方の言語にでもあれば innerHTML 差し替えに倒す。
function textNode(kind, key, en, ja, where, extra = {}) {
  const html = hasEmphasis(en) || hasEmphasis(ja);
  if (html) {
    return node(kind, key, renderInline(en, `${where} en`), renderInline(ja, `${where} ja`), true, extra);
  }
  assertOnlySupportedMarkdown(en, `${where} en`);
  assertOnlySupportedMarkdown(ja, `${where} ja`);
  return node(kind, key, escapeHTML(en), ja, false, extra);
}

function blockShape(blocks) {
  return blocks
    .map((block) => (block.type === "bullets" ? `bullets:${block.items.length}` : block.type))
    .join("|");
}

function buildNodes(doc) {
  const nodes = [];
  const topicIDs = new Set();

  for (const section of doc.sections) {
    if (section.title) {
      // 現在のコンテンツは見出しのないセクション 1 枚だけ。将来セクションが分かれたときのため、
      // セクション見出しを h2 に、トピック見出しを h3 に落とす。
      nodes.push(
        textNode(
          "h2",
          `help_s_${keyPart(section.id)}_t`,
          section.title.en,
          section.title.ja,
          `section "${section.id}"`
        )
      );
    }
    const topicHeading = section.title ? "h3" : "h2";

    for (const topic of section.topics) {
      const where = `topic "${topic.id}"`;
      if (topicIDs.has(topic.id)) {
        throw new Error(`${where}: id が重複している。アプリ側は id の一意性を前提に開閉を覚えている。`);
      }
      if (RESERVED_IDS.has(topic.id)) {
        throw new Error(`${where}: この id はページ側が使っている。anchor が別の要素を指してしまう。`);
      }
      topicIDs.add(topic.id);

      // Web は全トピックを出す（issue #3）。プラットフォームが 2 つ以上になった時点で
      // 「出し分けるのか、対象を明記するのか」を決める必要があるので、そこで止める。
      if (topic.platforms && topic.platforms.join() !== "ios") {
        throw new Error(
          `${where}: platforms=${JSON.stringify(topic.platforms)}。` +
            `Web は全トピックを出す前提で、iOS 以外が現れたときの見せ方は未決（issue #3）。`
        );
      }

      const en = topic.body.en;
      const ja = topic.body.ja;
      if (blockShape(en) !== blockShape(ja)) {
        // en の構造から DOM を起こし、ja は同じキーへ流し込む作り。ずれるとキーが噛み合わない。
        throw new Error(
          `${where}: en と ja でブロックの構成が違う（${blockShape(en)} / ${blockShape(ja)}）。` +
            `Web は en の構造に ja を流し込むので、種類と数はそろえること。`
        );
      }

      const base = `help_${keyPart(topic.id)}`;
      nodes.push(
        textNode(topicHeading, `${base}_t`, topic.title.en, topic.title.ja, where, { id: topic.id })
      );

      en.forEach((block, i) => {
        const jaBlock = ja[i];
        if (block.type === "paragraph") {
          nodes.push(textNode("p", `${base}_b${i}`, block.text, jaBlock.text, where));
        } else if (block.type === "bullets") {
          const items = block.items.map((item, j) =>
            textNode("li", `${base}_b${i}_${j}`, item, jaBlock.items[j], where)
          );
          nodes.push(node("ul", null, null, null, false, { items }));
        } else {
          // 知らない種類は落とす。アプリ側も同じ構え（空にするより部分表示を採る）。
          console.warn(`${where}: 未知のブロック種別 "${block.type}" を飛ばした。`);
        }
      });
    }
  }

  return nodes;
}

// -----------------------------------------------------------------------------
// ノードの列 → HTML
// -----------------------------------------------------------------------------

function attributes(item) {
  const parts = [];
  if (item.id) parts.push(` id="${escapeHTML(item.id)}"`);
  parts.push(item.html ? ` data-i18n-html="${item.key}"` : ` data-i18n="${item.key}"`);
  return parts.join("");
}

function renderNodes(nodes) {
  const lines = [];
  const messages = [];
  const seen = new Set();

  const remember = (item) => {
    if (seen.has(item.key)) {
      throw new Error(`i18n キー "${item.key}" が重複している（id の記号を _ に寄せた結果ぶつかった可能性）。`);
    }
    seen.add(item.key);
    messages.push([item.key, item.ja]);
  };

  for (const item of nodes) {
    if (item.kind === "ul") {
      lines.push(`          <ul class="policy-list">`);
      for (const li of item.items) {
        remember(li);
        lines.push(`            <li${attributes(li)}>${li.en}</li>`);
      }
      lines.push(`          </ul>`);
      continue;
    }
    remember(item);
    const cls = item.kind === "p" ? "hero-copy" : "section-title";
    lines.push(`          <${item.kind} class="${cls}"${attributes(item)}>${item.en}</${item.kind}>`);
  }

  return { body: lines.join("\n"), messages };
}

// -----------------------------------------------------------------------------
// ページ
// -----------------------------------------------------------------------------

/// ページ自身が持つ文言。**題とナビだけ**に留める。
///
/// 本文の外に文言を足すと、`help.json` に無いものを生成器が 2 言語ぶん抱えることになり、
/// 1 ソースにした意味が薄れる。読者を support へ送る役目は nav が担う。
const CHROME = [
  ["title", "help | oblivious film", "ヘルプ | oblivious film"],
  ["metaDescription", "help for oblivious film.", "oblivious film のヘルプ。"],
  ["nav_home", "home", "home"],
  ["nav_help", "help", "help"],
  ["nav_support", "support", "support"],
  ["nav_privacy", "privacy", "privacy"],
  ["nav_terms", "terms", "terms"],
  ["page_title", "help", "help"]
];

const TYPEKIT = `      (function(d) {
        var config = {
          kitId: 'fxp6kgk',
          scriptTimeout: 3000,
          async: true
        },
        h = d.documentElement,
        t = setTimeout(function() {
          h.className = h.className.replace(/\\bwf-loading\\b/g, "") + " wf-inactive";
        }, config.scriptTimeout),
        tk = d.createElement("script"),
        f = false,
        s = d.getElementsByTagName("script")[0],
        a;
        h.className += " wf-loading";
        tk.src = "https://use.typekit.net/" + config.kitId + ".js";
        tk.async = true;
        tk.onload = tk.onreadystatechange = function() {
          a = this.readyState;
          if (f || a && a != "complete" && a != "loaded") return;
          f = true;
          clearTimeout(t);
          try { Typekit.load(config); } catch (e) {}
        };
        s.parentNode.insertBefore(tk, s);
      })(document);`;

function renderPage(doc) {
  const { body, messages } = renderNodes(buildNodes(doc));

  const chromeEN = Object.fromEntries(CHROME.map(([key, en]) => [key, en]));
  const all = [...CHROME.map(([key, , ja]) => [key, ja]), ...messages];
  const ja = all.map(([key, value]) => `        ${key}: ${jsString(value)},`).join("\n");

  return `<!doctype html>
<!-- 生成物。手で編集しない。正本は /help/help.json で、\`node scripts/build-pages.mjs\` が作る。 -->
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHTML(chromeEN.title)}</title>
    <meta name="description" content="${escapeHTML(chromeEN.metaDescription)}">
    <link href="https://oblivious.jp/help/" rel="canonical">
    <meta content="width=device-width, initial-scale=1" name="viewport">
    <script>
${TYPEKIT}
    </script>
    <script>
      window.__I18N_MESSAGES__ = {};
      window.__I18N_MESSAGES__.ja = {
${ja}
        footer_copy: "© KMNGY Inc."
      };
    </script>
    <script defer src="/i18n.js"></script>
    <script defer src="/nav.js"></script>
    <script defer src="/hero-canvas.js"></script>
    <link href="/style.css" rel="stylesheet">
  </head>
  <body>
    <canvas class="page-canvas" aria-hidden="true"></canvas>
    <div class="container">
      <header class="site-header">
        <a class="header-logo" href="/" aria-label="oblivious film">
          <img src="/logo-oblivious.svg" alt="oblivious film">
        </a>
        <div class="header-nav-area">
          <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="menu">
            <span class="nav-toggle-bar"></span>
            <span class="nav-toggle-bar"></span>
            <span class="nav-toggle-bar"></span>
          </button>
          <nav class="top-nav" id="site-nav" aria-label="Primary">
            <a href="/" data-i18n="nav_home">home</a>
            <a href="/help/" data-i18n="nav_help">help</a>
            <a href="/support/" data-i18n="nav_support">support</a>
            <a href="/privacy/" data-i18n="nav_privacy">privacy</a>
            <a href="/terms/" data-i18n="nav_terms">terms</a>
          </nav>
        </div>
      </header>

      <main>
        <section class="hero" aria-labelledby="help-title">
          <h1 class="page-title" id="help-title" data-i18n="page_title">${escapeHTML(chromeEN.page_title)}</h1>
          <select class="lang-select" data-lang-select aria-label="language">
            <option value="en">english</option>
            <option value="ja">日本語</option>
          </select>

${body}
        </section>
      </main>

      <footer>
        <p data-i18n="footer_copy">&copy; KMNGY Inc.</p>
      </footer>
    </div>
  </body>
</html>
`;
}

// -----------------------------------------------------------------------------
// 実行
// -----------------------------------------------------------------------------

const check = process.argv.includes("--check");
const source = join(ROOT, "help", "help.json");
const target = join(ROOT, "help", "index.html");

const doc = JSON.parse(readFileSync(source, "utf8"));
const page = renderPage(doc);

if (check) {
  let current = null;
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // 未生成。下の比較で差分として出る。
  }
  if (current === page) {
    console.log("help/index.html は help.json と一致している。");
  } else {
    console.error("help/index.html が help.json から生成した内容と違う。node scripts/build-pages.mjs を走らせること。");
    process.exit(1);
  }
} else {
  writeFileSync(target, page);
  console.log(`help/index.html を書き出した（${page.length} bytes）。`);
}
