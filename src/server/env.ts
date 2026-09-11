// import 順で最初に評価されるよう、他モジュールより前に import する
try { process.loadEnvFile('.env') } catch {}
