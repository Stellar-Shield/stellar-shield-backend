# 🌊 StellarShield — Contribution Plan & Wave Program

StellarShield runs on the **Drips Wave** model: maintainers post scoped issues, contributors pick them up during sprint cycles, and merged work earns on-chain points that stream rewards automatically every Sunday.

---

## How the Wave Works

1. **Maintainers open a scoped issue** tagged `StellarShield-Guard` with a clear acceptance criteria and a point value.
2. **Contributors comment to claim** the issue. First to comment with a plan gets assigned.
3. **Work happens in a fork** — one PR per issue, branch named `feat/<issue-number>-short-description`.
4. **PR is reviewed and merged** — the Wave Automation service picks it up on Sunday, reads the label, assigns points, and pushes the distribution to the Drips reward contract.
5. **Points stream as XLM** to the contributor's Stellar address on file.

Point values are fixed:

| Work type | Points |
|---|---|
| New Guard module (logic) | 1 000 |
| Bug fix | 750 |
| New API route or service | 500 |
| Tests (unit or integration) | 500 |
| Documentation | 500 |

---

## Types of Work We Post

### 🔧 Bug Fixes
Issues where existing behaviour is wrong or unsafe. Examples:
- DER parser fails on non-standard length encodings from certain authenticators.
- Redis challenge TTL not being respected under high concurrency.
- Event monitor cursor not advancing after a Soroban RPC timeout.

Label: `bug` + `StellarShield-Guard` · Points: **750**

---

### ✨ New Features
New Guard modules that extend the security surface. Each module is a self-contained route + service pair. Examples:
- **IP-lock module** — reject transactions originating from IPs outside a user-defined allowlist.
- **Time-delay module** — queue large transfers for a 24-hour hold period before relay.
- **Multi-device passkey** — allow a user to register up to 5 passkeys and require M-of-N for high-value transfers.
- **Oracle price feed** — convert velocity limits from XLM to USDC in real time using a Stellar oracle.

Label: `enhancement` + `StellarShield-Guard` · Points: **1 000**

---

### 📄 Documentation
Clear, accurate docs reduce onboarding time and increase the contributor pool. Examples:
- Walkthrough of the full WebAuthn → contract signature flow with diagrams.
- Postman / Bruno collection covering every API endpoint.
- Inline JSDoc for all exported functions in `src/lib/`.
- Architecture decision records (ADRs) for key design choices.

Label: `documentation` + `StellarShield-Guard` · Points: **500**

---

### 🧪 Testing
The project currently has no test suite. Building one is high-priority. Examples:
- Unit tests for `derToCompact` covering edge cases (33-byte r, 33-byte s, both padded).
- Integration tests for `/auth/challenge` → `/auth/verify` round-trip using a mock authenticator.
- Contract simulation tests that mock Soroban RPC responses.
- Load tests for the event monitor under high ledger throughput.

Label: `testing` + `StellarShield-Guard` · Points: **500**

---

### 🔒 Security Hardening
Improvements that reduce attack surface without changing the public API. Examples:
- Rate-limit `/auth/challenge` per IP to prevent challenge flooding.
- Validate XDR envelope size before relaying to prevent oversized payload attacks.
- Add request signing between the frontend and backend (HMAC or JWT).
- Audit Redis key namespacing to prevent cross-user cache poisoning.

Label: `security` + `StellarShield-Guard` · Points: **750**

---

## Sprint Cadence

| Week | Focus |
|---|---|
| Sprint 1 | Contract deployment + backend smoke tests |
| Sprint 2 | WebAuthn full round-trip + frontend integration |
| Sprint 3 | Event monitor push notifications + IP-lock module |
| Sprint 4 | Test suite + Wave automation live on testnet |
| Sprint 5 | Mainnet prep + security audit |

---

## Claiming an Issue

1. Check [open issues](https://github.com/Stellar-Shield/stellar-shield-backend/issues) filtered by `StellarShield-Guard`.
2. Comment: *"Claiming — here's my approach: [2–3 sentences]"*
3. Wait for maintainer assignment (usually within 24 h).
4. Open a PR before the sprint ends (7 days from assignment).

PRs merged after the sprint deadline roll into the next Wave cycle.

---

## Getting Paid

Your Stellar address must be in your GitHub profile bio or linked in the PR description. The Wave Automation service reads it automatically. If no address is found, points are held for 30 days then redistributed.

Rewards are streamed via the Drips Network — you receive a continuous flow of XLM, not a lump sum, which means you start earning the moment the Wave cycle closes.
