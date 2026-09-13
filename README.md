# orchat

[![ci](https://github.com/ikumasudo/orchat/actions/workflows/ci.yml/badge.svg)](https://github.com/ikumasudo/orchat/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Self-hosted, OpenRouter-only team chat for small companies. SSO (OIDC), per-user cost tracking, one container. Documentation is in Japanese.

---

**中小企業が自社内で動かせる、シンプルな社内向けチャット AI。**

モデルは [OpenRouter](https://openrouter.ai) 1 本に絞っています。API キーは 1 本だけ、プロバイダごとの契約・実装は不要で、OpenRouter 側のアカウント設定で**ゼロデータリテンション (ZDR) のプロバイダのみに制限**できます。会話とコストは自社の Postgres に残り、ログインは既存の Entra ID などの OIDC でそのまま行えます。

- **導入が 1 コンテナ** — `docker compose up -d` (app + Postgres) だけ。イメージは `ghcr.io/ikumasudo/orchat`
- **SSO** — OIDC (Microsoft Entra ID で動作確認済み)。社員の追加・削除は IdP 側だけで完結
- **コストの可視化** — メッセージ単位で OpenRouter の課金額を記録し、`/usage` で月別・ユーザー別に集計
- **使うモデルを管理者が固定** — `MODELS` に許可するモデル id を並べるだけ (空なら全モデル)

## 機能

- OpenRouter **Responses API** (`/api/v1/responses`) をそのまま通す設計。input/output items を抽象化せず保存・返送する
- reasoning (thinking) のストリーム表示と、会話往復での保持 (署名/暗号化ごと保存して返送)
- OpenRouter server tools: Web検索 / Web取得 / シェル (サンドボックス実行、コマンドと stdout を表示) / 日時。一覧は `src/shared/types.ts` の `serverTools`
- ブランチ (編集・再生成)、画像/PDF 添付、Markdown/数式/シンタックスハイライト

## 構成

| | |
|---|---|
| サーバー (`src/server`) | Hono + [oRPC](https://orpc.unnoq.com) + Drizzle ORM / Postgres 17 |
| クライアント (`src/client`) | React 19 + Vite + TanStack Router/Query、Tailwind v4 + shadcn/ui + [AI Elements](https://elements.ai-sdk.dev/) |
| 共有 (`src/shared`) | Responses API の型、ツール定義、クライアント・サーバー共通ロジック |

```
src/server/  index.ts (Hono) / router.ts (oRPC) / runs.ts (ストリーム) / openrouter.ts / auth.ts / tools.ts / tree.ts / db/
src/client/  routes/{chat,usage}.tsx / components/{ui,ai-elements} (shadcn・AI Elements の取り込みコピー)
drizzle/     migration (サーバー起動時に自動適用)
test/        node:test の純粋なユニットテスト
```

ビルド成果物は Vite の静的ファイル + tsc 出力のサーバーで、1 つの Node プロセスが両方を配信します (`Dockerfile`)。

## デプロイ

必要なもの: Docker / OpenRouter の API キー / OIDC の IdP (Entra ID など)。

```sh
git clone https://github.com/ikumasudo/orchat.git && cd orchat
cp .env.example .env      # OPENROUTER_API_KEY と OIDC_* を設定、DEV_USER は空に
docker compose up -d      # 公開イメージ ghcr.io/ikumasudo/orchat:latest を pull (app + Postgres)
```

`docker compose up -d --build` で自分でビルドもできます。app は 3000 番で待ち受けるので、TLS 終端のリバースプロキシを前段に置いてください。

### Entra ID (OIDC) の設定

1. Entra 管理センターでアプリ登録 → リダイレクト URI に `https://<公開ホスト>/callback`
2. クライアントシークレットを発行し `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` に設定
3. `OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0`
4. `OIDC_SCOPES` に `offline_access` を含める (refresh token 用)
5. リバースプロキシ配下では `OIDC_AUTH_EXTERNAL_URL=https://<公開ホスト>` を設定

### 環境変数

| env | 用途 |
|---|---|
| `OPENROUTER_API_KEY` | 共通キー 1 本 |
| `DATABASE_URL` | Postgres の接続先 |
| `BASE_URL` | 公開 URL。OpenRouter への `HTTP-Referer` に使う |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_AUTH_SECRET` / `OIDC_SCOPES` | OIDC。`OIDC_AUTH_SECRET` は 32 文字以上のランダム文字列 |
| `OIDC_AUTH_EXTERNAL_URL` / `OIDC_REDIRECT_URI` | リバースプロキシ・dev サーバー配下での公開 URL |
| `MODELS` | 表示するモデル id のカンマ区切り。空なら全モデル |
| `TITLE_MODEL` | チャットタイトルの生成に使うモデル。空なら `openrouter/auto` (安価な帯に自動ルーティング、`MODELS` とは独立) |
| `ADMIN_EMAILS` | `/usage` で全員分を見られるユーザー (カンマ区切り) |
| `DEV_USER` | 開発時のみ。OIDC をスキップしてこのメールでログイン (production では無効) |

### アップグレード

```sh
docker compose pull && docker compose up -d
```

migration はサーバー起動時に自動適用されます。リリースは [Releases](https://github.com/ikumasudo/orchat/releases) を参照。

## 開発

```sh
cp .env.example .env      # OPENROUTER_API_KEY, DEV_USER=you@example.com (DEV_USER で OIDC をスキップ)
docker compose up -d db
pnpm install
pnpm dev                  # API :3000 (PORT で変更可), Web :5174
pnpm check                # tsc + tests (唯一の品質ゲート)
```

- スキーマ変更: `src/server/db/schema.ts` を編集 → `pnpm db:generate`
- `pnpm spike`: OpenRouter の生ストリームを `test/fixtures` に保存 (仕様確認用)
- ログインまで含めて試す場合はローカル mock IdP を使えます:

```sh
./dev/mock-oidc/gen-cert.sh                       # 自己署名証明書 (oidc-auth は issuer に https を要求する)
docker compose --profile dev up -d mock-oidc      # https://localhost:18443/entra
# .env: DEV_USER= (空) / OIDC_ISSUER=https://localhost:18443/entra / OIDC_CLIENT_ID=orchat
#       OIDC_CLIENT_SECRET=mock-secret / OIDC_AUTH_EXTERNAL_URL=http://localhost:5174
```

ブラウザで証明書警告を許可 → mock のログイン画面で任意のユーザー名 (= `sub`) と claims JSON (`{"email":"..."}`) を入力。[navikt/mock-oauth2-server](https://github.com/navikt/mock-oauth2-server) を使用 (設定: `dev/mock-oidc/config.json`)。

コントリビューションの前に [AGENTS.md](AGENTS.md) のリポジトリ規約を確認してください。脆弱性の報告は [SECURITY.md](SECURITY.md) の手順で。

## License

MIT
