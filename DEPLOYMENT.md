# Deployment

Frontend: https://stellar-shield-frontend.vercel.app
Backend:  https://stellar-shield-backend.vercel.app

The contracts are on Stellar testnet. The dashboard reads them directly over
Soroban RPC from the browser, so it works with no backend running. The backend
serves the WebAuthn endpoints, which need a shared challenge store: without
REDIS_URL set, /auth/* answers 503 and says so.

| contract | testnet address |
| --- | --- |
| guard | `CDHAOCU3SQ5FJK3K2TT76T74V7SYEQUN6GU2EXX3A7BZR7XYVPYUMB5T` |
| registry | `CAWXVQKWWGP62YNYQIQ6AYAPP7EYNPCUT4MB3LDSCEVWLSQRGYYP45AK` |
| auth | `CDRIB5FDB34NORXUP7SIVU3OF6BKKFBRVJLS23QFNWPTMG7QH3DYGMPL` |

Network: Test SDF Network ; September 2015
RPC: https://soroban-testnet.stellar.org
