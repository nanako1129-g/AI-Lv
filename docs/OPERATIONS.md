# DARS Demo 運用メモ

このドキュメントは、本番・準本番で安全に運用するための最小手順です。

## 1. 必須環境変数

- `GEMINI_API_KEY`: 必須
- `PUBLIC_ORIGIN`: 公開時は必須（例: `https://example.com`）
- `PORT`: 本番の待受ポート
- `TRUST_PROXY=1`: リバースプロキシ配下で実行する場合

補足:
- `LOG_EVAL_ERRORS=1` はデバッグ時のみ推奨（常時ONはログに依存情報を残しやすい）
- `BIND_ALL=1` はコンテナ等で必要な場合のみ使用

## 2. 画面切替（手動編集不要）

`VITE_APP_VARIANT` で表示画面を切り替えます。

- `dars`（既定）: DARS デモ画面
- `home`: プレースホルダーのホーム画面

例:

```bash
VITE_APP_VARIANT=home npm run dev
```

## 3. 起動コマンド

- 開発: `npm run dev`
- テスト: `npm test`
- 本番起動: `npm run build && npm start`

## 4. リリース前チェック

- `npm test` が通る
- `PUBLIC_ORIGIN` を設定した状態で UI から判定実行できる
- API キー未設定時に `503` を返すことを確認できる
- 入力が短すぎる場合に `400` を返すことを確認できる
- 不正な Origin で `403` が返ることを確認できる

## 5. 障害時の一次切り分け

1. API エラー時はまず `GEMINI_API_KEY` と `PUBLIC_ORIGIN` 設定を確認
2. 一時的な外部API不調は時間を置いて再試行
3. 必要時のみ `LOG_EVAL_ERRORS=1` で再現ログを採取し、復旧後に戻す

## 6. Vercel デプロイ

このリポジトリは `vercel.json` と `api/dars-evaluate.mjs` により Vercel へ直接デプロイできます。

- フロント: Vite ビルド（静的配信）
- API: Vercel Functions (`/api/dars-evaluate`)

### Vercel 側で設定する環境変数

- `GEMINI_API_KEY`（必須）
- `PUBLIC_ORIGIN`（必須。例: `https://your-app.vercel.app`）
- `GEMINI_MODEL`（任意）
- `LOG_EVAL_ERRORS`（通常は未設定。障害調査時のみ `1`）
- `VITE_APP_VARIANT`（任意。`dars` または `home`）

### CLI での最小手順

```bash
npm i -g vercel
vercel login
vercel
vercel env add GEMINI_API_KEY production
vercel env add PUBLIC_ORIGIN production
vercel --prod
```

補足:
- `PUBLIC_ORIGIN` は本番URLと完全一致させる（スキーム含む）
- プレビュー環境も使う場合は `preview` 用の環境変数も別途設定する
