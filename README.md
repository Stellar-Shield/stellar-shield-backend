# ⛓️ StellarShield — Integration Engine

The backend is the glue between the Soroban smart contracts and the frontend dApp. It indexes on-chain events, converts WebAuthn signatures into the compact format the contracts expect, relays signed transactions to the network, and automates the Drips Wave reward cycle for contributors.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (dApp)                       │
│  Freighter Wallet · WebAuthn · Soroban JS SDK           │
└────────────────────────┬────────────────────────────────┘
                         │ REST API
┌────────────────────────▼────────────────────────────────┐
│               stellar-shield-backend                     │
│                                                          │
│  POST /auth/challenge   →  generate WebAuthn challenge   │
│  POST /auth/verify      →  DER → compact r||s (64 B)    │
│  GET  /guard/velocity   →  read GuardContract state      │
│  GET  /registry/drips   →  check trusted drip address    │
│  POST /tx/relay         →  submit signed XDR to network  │
│                                                          │
│  EventMonitor  (polls Soroban RPC every 10 s)           │
│  WaveAutomation (GitHub PR scan, Sunday 00:00 UTC)      │
│                                                          │
│  Redis  ←→  challenge store · event cache (60 s TTL)    │
└────────────────────────┬────────────────────────────────┘
                         │ Soroban RPC / Horizon
┌────────────────────────▼────────────────────────────────┐
│           stellar-shield-contract (Soroban)              │
│  GuardContract · RegistryContract · AuthContract        │
└─────────────────────────────────────────────────────────┘
```

---

## Key Services

### 1. WebAuthn Signature Bridge
WebAuthn authenticators return ECDSA signatures in ASN.1 DER format. `AuthContract::verify_sig` expects a raw 64-byte compact `r || s` buffer. The backend converts between the two so the frontend never has to touch binary parsing.

```typescript
// src/lib/webauthn.ts
export function derToCompact(der: Buffer): Buffer {
  let offset = 2; // skip 0x30 + total length
  if (der[1] & 0x80) offset += (der[1] & 0x7f);

  const rLen = der[offset + 1];
  let r = der.subarray(offset + 2, offset + 2 + rLen);
  offset += 2 + rLen;

  const sLen = der[offset + 1];
  let s = der.subarray(offset + 2, offset + 2 + sLen);

  if (r[0] === 0x00) r = r.subarray(1); // strip ASN.1 sign-padding
  if (s[0] === 0x00) s = s.subarray(1);

  return Buffer.concat([r, s]); // 64 bytes → AuthContract::verify_sig
}
```

### 2. Soroban RPC Client
Read-only contract calls are simulated (no fee, no signing) so the frontend can query velocity state without a wallet prompt.

```typescript
// src/lib/soroban.ts
export async function getVelocityState(userAddress: string) {
  const user = nativeToScVal(Address.fromString(userAddress), { type: 'address' });
  const [limit, spent] = await Promise.all([
    simulateContractCall(CONTRACT_IDS.guard, 'get_limit', [user]),
    simulateContractCall(CONTRACT_IDS.guard, 'get_spent', [user]),
  ]);
  return {
    limitXlm:     stroopsToXlm(BigInt(limit ?? 0)),
    spentXlm:     stroopsToXlm(BigInt(spent ?? 0)),
    remainingXlm: stroopsToXlm(BigInt(limit ?? 0) - BigInt(spent ?? 0)),
  };
}
```

### 3. Event Monitor
Polls Soroban RPC every 10 seconds and caches contract events in Redis. Logs a warning when a `VelocityExceeded` event is detected — the hook point for push notifications.

### 4. Wave Automation
Every Sunday at 00:00 UTC the service scans merged GitHub PRs labelled `StellarShield-Guard`, assigns points (1 000 for logic, 500 for docs), and logs the distribution. The `DripsClient.setPoints()` call is stubbed pending Drips SDK Soroban support.

---

## Project Structure

```
stellar-shield-backend/
├── src/
│   ├── index.ts                  # Express entry point
│   ├── lib/
│   │   ├── webauthn.ts           # DER → compact r||s · COSE → SEC1
│   │   ├── soroban.ts            # RPC client · relay · velocity · drip check
│   │   └── redis.ts              # Challenge store · event cache
│   ├── routes/
│   │   ├── auth.ts               # POST /auth/challenge  POST /auth/verify
│   │   ├── guard.ts              # GET  /guard/velocity
│   │   ├── registry.ts           # GET  /registry/drips  GET /registry/events
│   │   └── tx.ts                 # POST /tx/relay
│   └── services/
│       ├── eventMonitor.ts       # Soroban event poller
│       └── waveAutomation.ts     # Drips Wave cron
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js v20+ / TypeScript 5 |
| Framework | Express 4 |
| Blockchain | `@stellar/stellar-sdk` 12 |
| Cache | Redis via `ioredis` |
| Dev server | `ts-node-dev` |

---

## Setup

```bash
git clone https://github.com/Stellar-Shield/stellar-shield-backend
cd stellar-shield-backend
npm install
cp .env.example .env
# Fill in contract IDs after deploying stellar-shield-contract
npm run dev
```

**Required `.env` values:**

```
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
HORIZON_URL=https://horizon-testnet.stellar.org
GUARD_CONTRACT_ID=<deployed contract ID>
REGISTRY_CONTRACT_ID=<deployed contract ID>
AUTH_CONTRACT_ID=<deployed contract ID>
REDIS_URL=redis://localhost:6379
GITHUB_TOKEN=<read:org repo scopes>
GITHUB_REPO=Stellar-Shield/stellar-shield-contract
```

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/challenge` | Issue a random challenge for WebAuthn signing |
| `POST` | `/auth/verify` | Convert DER signature → compact `r\|\|s` |
| `GET` | `/guard/velocity` | Read daily spend state for a user address |
| `GET` | `/registry/drips` | Check if an address is a trusted drip |
| `GET` | `/registry/events` | Recent `add_trusted_drip` events (cached) |
| `POST` | `/tx/relay` | Submit a signed XDR envelope to the network |
| `GET` | `/health` | Liveness check |

---

## Related Repos

| Repo | Role |
|---|---|
| [`stellar-shield-contract`](https://github.com/Stellar-Shield/stellar-shield-contract) | Soroban smart contracts (Rust / WASM) |
| [`stellar-shield-backend`](https://github.com/Stellar-Shield/stellar-shield-backend) | This repo — off-chain API & event indexer |
| [`stellar-shield-frontend`](https://github.com/Stellar-Shield/stellar-shield-frontend) | Web dApp — passkey UI & transfer dashboard |
