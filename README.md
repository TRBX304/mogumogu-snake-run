# MOGUMOGU SNAKE RUN

リンゴをもぐもぐ食べ続ける3レーンのスネークラン。バニラJS（ES Modules）・ビルド不要。

## ファイル構成

```
index.html
manifest.webmanifest / sw.js / _headers   … PWA・Cloudflare Pages 用
firestore.rules                           … Firestore セキュリティルール
css/style.css
icons/                                     … PWAアイコン（ドット絵）
js/
  main.js             … 画面遷移・入力・UI
  game.js             … ゲーム本体（固定ステップ120Hz・描画）
  course.js           … コース生成（先読みチャンク生成・毒リンゴ配置）
  config.js           … 速度カーブや判定などの調整値
  sprites.js          … ドット絵データ
  audio.js            … 効果音（WebAudio）
  ranking.js          … ランキング（Firebase / ローカル自動切替・キャッシュ）
  firebase-config.js  … Firebase の設定値（ここだけ書き換える）
```

## ローカルで動かす

ES Modules と Service Worker を使うので、ファイルを直接開くのではなくサーバー経由で開く。

```
python3 -m http.server 8000
# → http://localhost:8000
```

`firebase-config.js` が `null` のままなら「この端末だけ」のランキングで動く。

## Firebase の設定

1. Firebase コンソールでプロジェクトを作成し、ウェブアプリを追加
2. **Authentication** → ログイン方法 → **匿名** を有効化
3. **Firestore Database** を作成（ロケーションは `asia-northeast1` など）
4. **ルール** タブに `firestore.rules` の中身を貼って公開
5. 表示された設定値を `js/firebase-config.js` に貼る
6. Authentication → 設定 → **承認済みドメイン** に Cloudflare Pages のドメイン（`xxx.pages.dev` や独自ドメイン）を追加
7. （推奨）Google Cloud コンソール → 認証情報 → API キーに **HTTPリファラー制限** を付ける

ルールは公開前に、コンソールの「ルール プレイグラウンド」で次の点を確認しておくと安心:
- `games/{id}` の作成（`startedAt` = サーバー時刻、`used` = false）が通る
- `ranks/all/entries/{自分のuid}` を、他人のuidで書こうとすると拒否される

## Cloudflare Pages へのデプロイ

ビルド不要。リポジトリのルートをそのまま公開する（ビルドコマンド: なし / 出力ディレクトリ: `/`）。
`_headers` で `sw.js` がキャッシュされないようにしてある。

**更新するときは `sw.js` の `VERSION` を上げる**と、古いキャッシュが確実に入れ替わる。

## ランキングの仕組み

- 端末ごとに匿名認証のUIDを発行（ログイン画面なし）
- ゲーム開始時に `games/{gameId}` を作成し、サーバー時刻で開始時刻を記録
- スコア送信は「gameを使用済みにする」＋「自己ベストを更新」を1回のバッチで行い、ルールで以下を検査
  - 本人のgameか / 未使用か（同じgameIdの使い回し不可）
  - 開始からの経過時間に対してスコアが上限以内か（`maxScore`）
  - 期間キー（週・月）がサーバー時刻と一致するか / 自己ベストより高いか
- 週は日本時間の月曜0時区切り、月は日本時間の暦月
- 読み取り節約: ランキングは sessionStorage に3分キャッシュ。自分の送信結果は再取得せずキャッシュに差し込む。スマホは表示中のタブだけ読み込む
- ニックネームを変えると、今期（週・月・全期間）のランキング上の表示名もまとめて変わる

`js/config.js` の速度カーブを速くする方向に変えた場合は、`firestore.rules` の `maxScore` も合わせて見直すこと。

## デバッグ

URL の末尾に `#debug` を付けると、コンソールから `window.__msr.game` を触れる。
