# PR プレビュー環境

`preview` ラベルを付けた PR ごとに、社内ホスト上へスタックを 1 つ立て、tailnet 内に
`https://orchat-pr-<PR番号>.<tailnet>.ts.net` として公開する。PR を閉じるかラベルを外すと撤去される。

```
GitHub (pull_request: labeled/synchronize/closed)
  └─ self-hosted runner (社内 Docker ホスト)
       └─ docker compose -p orchat-pr-<N>
            ├─ ts   tailscale/tailscale  … netns の持ち主。serve で 443 → 127.0.0.1:3000
            ├─ db   postgres:17-alpine   … PR ごとの空 DB (migration は app 起動時に自動適用)
            └─ app  Dockerfile をビルド   … NODE_ENV=preview + DEV_USER で自動ログイン
```

ホストにポートを公開しないので、PR が何本並んでもポート採番も衝突管理も不要。
tailnet から届くのは `serve.json` に書いた 443 だけで、5432 は userspace モードのため露出しない。

## 用意するもの

**1. ホスト (プレビュー専用 VM を推奨)**

AI が書いたコードをビルドして実行する場所なので、本番や社内ファイルサーバと同居させない。

```sh
sudo apt install -y docker.io docker-compose-v2 jq
sudo usermod -aG docker <runner-user>
```

**2. self-hosted runner**

リポジトリの Settings → Actions → Runners から追加し、ラベルに `preview` を付ける
(ワークフローは `runs-on: [self-hosted, preview]`)。systemd サービスとして常駐させる。

**3. tailnet**

- 管理画面で MagicDNS と HTTPS 証明書を有効化 (`tailscale serve` の前提)
- ACL に `tag:preview` を追加。プレビューからは何も触れない / 開発者からは 443 だけ届く形にする:

```jsonc
"tagOwners": { "tag:preview": ["autogroup:admin"] },
"acls": [
  { "action": "accept", "src": ["group:dev"], "dst": ["tag:preview:443"] },
  // tag:preview を src にした許可は書かない (= プレビューから tailnet 内へは出られない)
]
```

- 認証キーを発行: **reusable + ephemeral + pre-approved**、タグ `tag:preview`。
  ephemeral なので撤去時の `tailscale logout` でデバイスが自動的に消える。キーは最長 90 日で失効するので、
  期限管理を避けたければ OAuth クライアント (scope `auth_keys`) からデプロイ時に払い出す形に替える。

**4. GitHub の Secrets / Variables**

| 種別 | 名前 | 内容 |
|---|---|---|
| secret | `TS_AUTHKEY` | 上記の認証キー |
| secret | `OPENROUTER_PREVIEW_API_KEY` | **プレビュー専用**キー。OpenRouter 側でクレジット上限を設定する |
| variable | `TAILNET_DOMAIN` | `tailxxxx.ts.net` (ノード名解決に失敗したときのフォールバック表示用) |
| variable | `PREVIEW_USER` | 自動ログインするメールアドレス。省略時 `preview@example.com` |
| variable | `PREVIEW_MODELS` | 任意。プレビューで出すモデルを絞りたいとき (`MODELS` と同じ書式) |

**5. ラベル**

`preview` ラベルをリポジトリに作成する。

## 運用メモ

- **再デプロイ** — PR に push すると `app` だけ作り直される。`ts` は設定が変わらない限り再作成されないので、
  ノード identity と取得済みの TLS 証明書を維持する。ここを毎回作り直すと Let's Encrypt の
  「同一ホスト名の重複発行は週 5 回まで」に当たるため、`ts` の再作成は避けること。
- **DB** — PR ごとに空。データを引き継ぎたければ `pgdata` ボリュームに dump を流し込む。
- **撤去** — PR クローズ / ラベル除去で `down -v --rmi local`。取りこぼしは `preview-gc` が毎朝 04:00 JST に掃除する。
- **ディスク** — 1 スタックあたりイメージ + DB でおよそ 1.5〜2GB。`preview-gc` が `image prune` と
  `builder prune` まで行い、最後に `df -h` を出す。
- **compose の固定** — ワークフローは `deploy/preview` を base ブランチの内容に戻してからデプロイする。
  PR 側が compose を書き換えてホストのファイルをマウントする、といった経路を塞ぐため。
- **認証** — プレビューは `NODE_ENV=preview` で動くので `DEV_USER` の自動ログインが効く
  (本番イメージは `NODE_ENV=production` のままなのでこの経路は production では死んでいる)。
  URL を知っていれば tailnet 内の誰でも入れる前提で、ACL 側で絞る。
