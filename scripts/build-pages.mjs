#!/usr/bin/env node
//
// oblivious.jp のページ生成器（kaminogoya/oblivious.jp#3, #5）。
//
// JSON を正本に HTML を作る。**生成物はコミットする**（issue #3 の案 B1）。
//
//   help/help.json       → help/index.html
//   privacy/privacy.json → privacy/index.html
//   terms/terms.json     → terms/index.html
//
// 生成を選んだ理由は「JS が動かなくても本文が読めること」で、これは privacy / terms のために要る性質。
// help だけなら client-side でも足りていた（#5 でその前提を実際に使った）。
//
// 出力は**既存ページと同じ形**にしている — en を HTML に直書きし、ja を `__I18N_MESSAGES__` に置く。
// そうすることで `i18n.js` / `nav.js` / `style.css` の作りに乗ったままでいられる。
// ただし 1 点だけ足りず、`i18n.js` に `data-i18n-html`（innerHTML で差し替える口）を追加した。
// help の本文は `**強調**` を使うのに対し `data-i18n` は textContent 差し替えで markup を運べず、
// しかも en と ja で強調の並びが違う（en `a **film** is…` / ja `**film** は…`）ため、
// en から起こした DOM を ja が使い回せないため。
//
// **文書の形は 2 種類ある。** help は「質問と答え」の入れ子（section → topic → body）で、
// ポリシーは通し読みの平らな `blocks`。それぞれ `buildHelpNodes` / `buildPolicyNodes` が
// 共通のノード列へ落とし、そこから先は同じ経路で HTML になる。
//
//   使い方:  node scripts/build-pages.mjs          # 生成して書き出す
//            node scripts/build-pages.mjs --check  # 書き出さず、出力が最新かだけ見る（差分があれば exit 1）
//
// `--check` は「走らせ忘れ」の検出用。B1 の唯一の弱点がそこなので、手元で確認できるようにしてある。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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
          `JSON 側で書き換えるか、この生成器と HelpContentKit の両方を対応させること。`
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
// JSON → ノードの列
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

/// en の構造から DOM を起こし、ja は同じキーへ流し込む作り。ずれるとキーが噛み合わない。
function assertSameShape(en, ja, where) {
  if (blockShape(en) !== blockShape(ja)) {
    throw new Error(
      `${where}: en と ja でブロックの構成が違う（${blockShape(en)} / ${blockShape(ja)}）。` +
        `Web は en の構造に ja を流し込むので、種類と数はそろえること。`
    );
  }
}

// -----------------------------------------------------------------------------
// help.json
// -----------------------------------------------------------------------------

function buildHelpNodes(doc, reservedIDs) {
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
      if (reservedIDs.has(topic.id)) {
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
      assertSameShape(en, ja, where);

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
// privacy.json / terms.json
// -----------------------------------------------------------------------------

/// ポリシー文書（issue #5）。help と違い**通しで読む**ものなので入れ子を持たず、`blocks` の平らな並び。
///
/// i18n キーは `{文書 id}_{直前の見出し id}_{通番}` で導く（例 `privacy_logs_b0`）。見出しより前は `lead`。
/// キーは生成側の内部名でしかないが、追いかけるとき本文のどこの話か分かる方がよい。
///
/// **未知の種類で中断する**のが help との一番の違い。help は読めない部分を飛ばして残りを出すが、
/// 条項が 1 つ黙って消えた法的文書を配る方が害が大きい。
function buildPolicyNodes(doc, reservedIDs) {
  const where = `${doc.id}`;
  const en = doc.blocks.en;
  const ja = doc.blocks.ja;
  assertSameShape(en, ja, where);

  const prefix = keyPart(doc.id);
  const nodes = [];
  const headingIDs = new Set();
  let section = "lead";
  let index = 0;

  en.forEach((block, i) => {
    const jaBlock = ja[i];
    const at = `${where} block ${i}`;

    if (block.type === "heading") {
      if (!block.id) throw new Error(`${at}: 見出しに id が無い。anchor とキーの導出に要る。`);
      if (headingIDs.has(block.id)) {
        throw new Error(`${at}: 見出し id "${block.id}" が重複している。anchor が先頭だけを指してしまう。`);
      }
      if (reservedIDs.has(block.id)) {
        throw new Error(`${at}: id "${block.id}" はページ側が使っている。anchor が別の要素を指してしまう。`);
      }
      if (jaBlock.id !== block.id) {
        throw new Error(`${at}: en と ja で見出し id が違う（${block.id} / ${jaBlock.id}）。`);
      }
      headingIDs.add(block.id);
      section = keyPart(block.id);
      index = 0;
      // 見出しの前で 1 行空ける。生成物とはいえ人が読むので、節の切れ目が見えた方がよい。
      if (nodes.length > 0) nodes.push({ kind: "blank" });
      nodes.push(textNode("h2", `${prefix}_${section}_t`, block.text, jaBlock.text, at, { id: block.id }));
      return;
    }

    const key = `${prefix}_${section}_b${index}`;
    index += 1;

    if (block.type === "paragraph") {
      nodes.push(textNode("p", key, block.text, jaBlock.text, at));
    } else if (block.type === "bullets") {
      const items = block.items.map((item, j) =>
        textNode("li", `${key}_${j}`, item, jaBlock.items[j], at)
      );
      nodes.push(node("ul", null, null, null, false, { items }));
    } else if (block.type === "contact") {
      const email = doc.contactEmail;
      if (!email?.user || !email?.domain) {
        throw new Error(`${at}: contact ブロックがあるのに contactEmail が無い。`);
      }
      nodes.push({
        kind: "contact",
        user: email.user,
        domain: email.domain,
        before: textNode("span", `${key}_pre`, block.before, jaBlock.before, `${at} before`),
        after: textNode("span", `${key}_post`, block.after, jaBlock.after, `${at} after`)
      });
    } else {
      throw new Error(
        `${at}: 未知のブロック種別 "${block.type}"。` +
          `法的文書なので、読めない部分を飛ばして残りを出すことはしない。生成器を対応させること。`
      );
    }
  });

  // 施行日と提供者は本文の外（JSON のトップレベル）にあり、どの文書でも末尾に同じ形で出る。
  nodes.push({ kind: "blank" });
  nodes.push(
    textNode("p", `${prefix}_effective`, doc.effectiveDate.en, doc.effectiveDate.ja, `${where} effectiveDate`)
  );
  nodes.push(textNode("p", `${prefix}_provider`, doc.provider.en, doc.provider.ja, `${where} provider`));

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
    if (item.kind === "blank") {
      lines.push("");
      continue;
    }
    if (item.kind === "ul") {
      lines.push(`          <ul class="policy-list">`);
      for (const li of item.items) {
        remember(li);
        lines.push(`            <li${attributes(li)}>${li.en}</li>`);
      }
      lines.push(`          </ul>`);
      continue;
    }
    if (item.kind === "contact") {
      // アドレスは `i18n.js` が user と domain から組み立てる。**JSON には平文で置かない**（issue #5）—
      // JSON は誰でも取得できるので、そこに完成したアドレスを置くと収集が一段楽になる。
      remember(item.before);
      remember(item.after);
      const address = `${item.user}@${item.domain}`;
      lines.push(`          <p class="hero-copy"><span${attributes(item.before)}>${item.before.en}</span><a`);
      lines.push(`              class="email-link"`);
      lines.push(`              href="#"`);
      lines.push(`              data-email-user="${escapeHTML(item.user)}"`);
      lines.push(`              data-email-domain="${escapeHTML(item.domain)}"`);
      lines.push(`              aria-label="${escapeHTML(address)}"`);
      lines.push(`            ></a><span${attributes(item.after)}>${item.after.en}</span></p>`);
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

/// 全ページ共通のナビ。
const NAV = [
  ["nav_home", "Home", "Home"],
  ["nav_help", "Help", "Help"],
  ["nav_support", "Support", "Support"],
  ["nav_privacy", "Privacy", "Privacy"],
  ["nav_terms", "Terms", "Terms"]
];

/// ページ自身が持つ文言。**題とナビだけ**に留める。
///
/// 本文の外に文言を足すと、JSON に無いものを生成器が 2 言語ぶん抱えることになり、
/// 1 ソースにした意味が薄れる。読者を support へ送る役目は nav が担う。
function chrome(page) {
  return [
    ["title", page.title.en, page.title.ja],
    ["metaDescription", page.description.en, page.description.ja],
    ...NAV,
    ["page_title", page.pageTitle.en, page.pageTitle.ja]
  ];
}

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

function renderPage(page, doc) {
  // 見出しの anchor がページ側の id とぶつかると、リンクが別物を指す。
  const reservedIDs = new Set(["site-nav", page.titleID]);
  const { body, messages } = renderNodes(page.build(doc, reservedIDs));

  const pageChrome = chrome(page);
  const chromeEN = Object.fromEntries(pageChrome.map(([key, en]) => [key, en]));
  const all = [...pageChrome.map(([key, , ja]) => [key, ja]), ...messages];
  const ja = all.map(([key, value]) => `        ${key}: ${jsString(value)},`).join("\n");

  return `<!doctype html>
<!-- 生成物。手で編集しない。正本は /${page.source} で、\`node scripts/build-pages.mjs\` が作る。 -->
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHTML(chromeEN.title)}</title>
    <meta name="description" content="${escapeHTML(chromeEN.metaDescription)}">
    <link href="${page.canonical}" rel="canonical">
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
        <section class="hero" aria-labelledby="${page.titleID}">
          <h1 class="page-title" id="${page.titleID}" data-i18n="page_title">${escapeHTML(chromeEN.page_title)}</h1>
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

const PAGES = [
  {
    source: "help/help.json",
    target: "help/index.html",
    titleID: "help-title",
    canonical: "https://oblivious.jp/help/",
    title: { en: "Help | oblivious film", ja: "ヘルプ | oblivious film" },
    description: { en: "Help for oblivious film.", ja: "oblivious film のヘルプ。" },
    pageTitle: { en: "Help", ja: "Help" },
    build: buildHelpNodes
  },
  {
    source: "privacy/privacy.json",
    target: "privacy/index.html",
    titleID: "privacy-title",
    canonical: "https://oblivious.jp/privacy/",
    title: { en: "Privacy | oblivious film", ja: "プライバシーポリシー | oblivious film" },
    description: { en: "Privacy policy for oblivious film.", ja: "oblivious film のプライバシーポリシー。" },
    pageTitle: { en: "Privacy", ja: "Privacy" },
    build: buildPolicyNodes
  },
  {
    source: "terms/terms.json",
    target: "terms/index.html",
    titleID: "terms-title",
    canonical: "https://oblivious.jp/terms/",
    title: { en: "Terms | oblivious film", ja: "利用規約 | oblivious film" },
    description: { en: "Terms of service for oblivious film.", ja: "oblivious film の利用規約。" },
    pageTitle: { en: "Terms", ja: "Terms" },
    build: buildPolicyNodes
  }
];

// -----------------------------------------------------------------------------
// 実行
// -----------------------------------------------------------------------------

const check = process.argv.includes("--check");
let stale = false;

for (const page of PAGES) {
  const doc = JSON.parse(readFileSync(join(ROOT, page.source), "utf8"));
  const html = renderPage(page, doc);
  const target = join(ROOT, page.target);

  if (!check) {
    writeFileSync(target, html);
    console.log(`${page.target} を書き出した（${html.length} bytes）。`);
    continue;
  }

  let current = null;
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // 未生成。下の比較で差分として出る。
  }
  if (current === html) {
    console.log(`${page.target} は ${page.source} と一致している。`);
  } else {
    console.error(`${page.target} が ${page.source} から生成した内容と違う。node scripts/build-pages.mjs を走らせること。`);
    stale = true;
  }
}

if (stale) process.exit(1);
