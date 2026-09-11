# orchat

OpenRouter 前提の社内チャット。OpenRouter **Responses API** (`/api/v1/responses`) の input/output items を抽象化せずそのまま通し、そのまま保存する。

- reasoning (thinking) のストリーム表示と会話往復での保持 (reasoning item を署名/暗号化ごと保存・返送)
- OpenRouter server tools: Web検索 / Web取得 / シェル (`openrouter:shell`, サンドボックス実行、コマンドと stdout を表示) / 日時。`openrouter:bash` は Messages API 専用なので Responses API では shell を使う。一覧は `src/shared/types.ts` の `serverTools`
- assistant の応答は output items (reasoning → tool → message …) の配列として保存し、履歴にそのまま並べて送る
- ブランチ (編集・再生成)、画像/PDF 添付、メッセージ単位のコスト記録、Entra ID (OIDC) SSO

Hono + oRPC + Drizzle/Postgres / React + Vite + TanStack Router/Query。1 コンテナ。

## 開発

```sh
cp .env.example .env      # OPENROUTER_API_KEY, DEV_USER=you@example.com を設定 (DEV_USER で OIDC をスキップ)
docker compose up -d db
pnpm install
pnpm dev                  # API :3000 (PORT で変更可), Web :5173
pnpm check                # tsc + tests
pnpm spike                # OpenRouter の生ストリームを test/fixtures に保存 (仕様確認用)
```

### Entra ID の代わりにローカル mock IdP でログインを試す

```sh
./dev/mock-oidc/gen-cert.sh                       # 自己署名証明書 (oidc-auth は issuer に https を要求する)
docker compose --profile dev up -d mock-oidc      # https://localhost:18443/entra
# .env: DEV_USER= (空) / OIDC_ISSUER=https://localhost:18443/entra / OIDC_CLIENT_ID=orchat / OIDC_CLIENT_SECRET=mock-secret
#       OIDC_AUTH_EXTERNAL_URL=http://localhost:5173 / OIDC_REDIRECT_URI=http://localhost:5173/callback
pnpm dev                                          # dev script が NODE_EXTRA_CA_CERTS=dev/mock-oidc/cert.pem を渡す
```

ブラウザで証明書警告を許可 → mock のログイン画面で任意のユーザー名 (= `sub`) と claims JSON (`{"email":"...","name":"..."}`) を入力。
[navikt/mock-oauth2-server](https://github.com/navikt/mock-oauth2-server) を使用。設定は `dev/mock-oidc/config.json`。

スキーマ変更: `src/server/db/schema.ts` を編集 → `pnpm db:generate`。migration はサーバー起動時に自動適用。

## 本番

```sh
cp .env.example .env      # OIDC_* と OPENROUTER_API_KEY を設定、DEV_USER は空に
docker compose up -d --build
```

Entra ID 側: アプリ登録 → リダイレクト URI `https://<BASE_URL>/callback`、クライアントシークレット発行。
`OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0`、`OIDC_SCOPES` に `offline_access` を含める (refresh token 用)。
リバースプロキシ配下では `OIDC_AUTH_EXTERNAL_URL=https://<host>` を設定。

| env | 用途 |
|---|---|
| `OPENROUTER_API_KEY` | 共通キー 1 本 |
| `DATABASE_URL` | Postgres |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_AUTH_SECRET` / `OIDC_SCOPES` | Entra ID |
| `MODELS` | 表示するモデル id のカンマ区切り。空なら全モデル |
| `ADMIN_EMAILS` | `/usage` で全員分を見られるユーザー |
| `DEV_USER` | 開発時のみ。OIDC をスキップしてこのメールでログイン (production では無効) |
