#!/bin/sh
# ローカル mock OIDC 用の自己署名証明書。@hono/oidc-auth (oauth4webapi) は issuer に https を要求するため必要
cd "$(dirname "$0")"
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" -keyout key.pem -out cert.pem 2>/dev/null
openssl pkcs12 -export -inkey key.pem -in cert.pem -out keystore.p12 -passout pass:changeit
chmod 644 keystore.p12 cert.pem  # コンテナ内の非 root ユーザーが読めるように
echo "generated cert.pem / keystore.p12"
