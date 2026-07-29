# oblivious.jp

oblivious の Web サイト。素の HTML + CSS + JS で、GitHub Pages が `main` の root をそのまま配信する。

## ページ

| パス | 中身 |
| --- | --- |
| `/` | トップ |
| `/help/` | ヘルプ。**生成物** — 正本は `help/help.json` |
| `/support/` | 連絡手段（問い合わせ先） |
| `/privacy/` | プライバシーポリシー。**生成物** — 正本は `privacy/privacy.json` |
| `/terms/` | 利用規約。**生成物** — 正本は `terms/terms.json` |

`/help/` は読み物、`/support/` は連絡手段、という役割分担。

## 生成するページ

JSON が本文の唯一の正本で、**iOS アプリと Web の両方がこれを描く**（アプリ側は取得してネイティブに
描画する。ヘルプは kaminogoya/oblivious#801、ポリシーは kaminogoya/oblivious#810）。

本文を直したら、生成し直して**出力も一緒にコミットする**。

```sh
node scripts/build-pages.mjs          # 3 ページを生成
node scripts/build-pages.mjs --check  # 生成し直さず、出力が JSON と一致するかだけ見る
```

`help/index.html` などの生成物は**手で編集しない**（次の生成で消える）。

生成にしてあるのは、JS が動かなくても本文が読めるようにするため。法的文書が JS 依存になるのは避けたい、
という判断（kaminogoya/oblivious.jp#3）。

### 文書の形

2 種類ある。

- **help** — 質問と答えの入れ子（`sections` → `topics` → `body`）。ページでは開いて読む前提の並び
- **ポリシー** — 通し読みの平らな並び（`blocks`）。ブロックは `heading` / `paragraph` / `bullets` / `contact`、
  本文の外に `effectiveDate` / `provider` / `contactEmail` を持つ

共通の決まりごと。

- 本文に書ける装飾は `**強調**` だけ。それ以外は生成器が弾く（アプリ側と Web で解釈が食い違わないため）
- en と ja はブロックの種類・数・順番をそろえる。en の構造から DOM を起こし、ja を同じキーへ流し込むため
- 連絡先メールは JSON に平文で置かず、`contactEmail` の `user` と `domain` に分ける。組み立ては `i18n.js`
- **ポリシーは未知のブロック種別で生成を中断する**（help は飛ばして残りを出す）。条項が黙って消えた
  法的文書を配る方が、ヘルプの 1 項目が欠けるより害が大きいため

## i18n

en を HTML に直書きし、ja を各ページ内の `window.__I18N_MESSAGES__.ja` に置く。`i18n.js` が
`navigator.languages`（または言語セレクタの選択）を見て差し替える。

- `data-i18n="キー"` — `textContent` を差し替える。ほとんどのノードはこれ
- `data-i18n-html="キー"` — `innerHTML` を差し替える。本文に `<strong>` を含むときだけ使う。
  値はこのリポジトリ内で書いたものに限る（外部から来た文字列を入れない）
