#!/bin/sh
# ローカル mock OIDC 用の自己署名証明書。@hono/oidc-auth (oauth4webapi) は issuer に https を要求するため必要
cd "$(dirname "$0")"
san="DNS:localhost,IP:127.0.0.1"
# Tailscale 越しにブラウザから開く場合はその IP も SAN に入れる
ip=$(tailscale ip -4 2>/dev/null | head -1) && [ -n "$ip" ] && san="$san,IP:$ip"
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=localhost" -addext "subjectAltName=$san" -keyout key.pem -out cert.pem 2>/dev/null
openssl pkcs12 -export -inkey key.pem -in cert.pem -out keystore.p12 -passout pass:changeit
chmod 644 keystore.p12 cert.pem  # コンテナ内の非 root ユーザーが読めるように
echo "generated cert.pem / keystore.p12"
