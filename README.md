# oblivious.jp

oblivious の Web サイト。素の HTML + CSS + JS で、GitHub Pages が `main` の root をそのまま配信する。

## ページ

| パス | 中身 |
| --- | --- |
| `/` | トップ |
| `/help/` | ヘルプ。**生成物** — 正本は `help/help.json` |
| `/support/` | 連絡手段（問い合わせ先） |
| `/privacy/` | プライバシーポリシー |
| `/terms/` | 利用規約 |

`/help/` は読み物、`/support/` は連絡手段、という役割分担。

## ヘルプ

`help/help.json` が本文の唯一の正本で、**iOS アプリと `/help/` の両方がこれを描く**
（アプリ側は取得してネイティブに描画する。kaminogoya/oblivious#801）。

本文を直したら、生成し直して**出力も一緒にコミットする**。

```sh
node scripts/build-pages.mjs          # help/index.html を生成
node scripts/build-pages.mjs --check  # 生成し直さず、出力が help.json と一致するかだけ見る
```

`help/index.html` は**手で編集しない**（次の生成で消える）。

生成にしてあるのは、JS が動かなくても本文が読めるようにするため。この先 privacy / terms を同じ仕組みに
載せる想定で、法的文書が JS 依存になるのは避けたい、という判断（kaminogoya/oblivious.jp#3）。

## i18n

en を HTML に直書きし、ja を各ページ内の `window.__I18N_MESSAGES__.ja` に置く。`i18n.js` が
`navigator.languages`（または言語セレクタの選択）を見て差し替える。

- `data-i18n="キー"` — `textContent` を差し替える。ほとんどのノードはこれ
- `data-i18n-html="キー"` — `innerHTML` を差し替える。本文に `<strong>` を含むときだけ使う。
  値はこのリポジトリ内で書いたものに限る（外部から来た文字列を入れない）
