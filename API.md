# The contract between the frontend and the backend

Written down because it was not, and the two halves had drifted apart on every
single endpoint. None of these calls could ever have reached the other side:

| what | frontend sent | backend expected |
| --- | --- | --- |
| challenge | `GET /auth/challenge?userId=` | `POST /auth/challenge` with a body |
| verify | `{ sessionId, assertion }` | `{ userId, derSignature }` |
| verify reply | read `compactSig`, `message` | returned `compactSignature`, `challenge` |
| velocity | expected `limitStroops` | called `get_limit`, a method the contract does not have |
| drips | `GET /registry/drips` expecting a list | one `?address=`, answering yes or no |
| relay | `{ signedXdr }` | `{ xdr }` |

The table below is now the agreed shape. Both repos carry this file.

## POST /auth/challenge

Request `{ "userId": "G..." }` → `{ "challenge": "<base64url, 32 bytes>" }`

A challenge is stored against the user for five minutes and can be spent once.
It is POST rather than GET because issuing one writes state.

The challenge is **base64url**, not standard base64. Decoding it with `atob`
alone yields the wrong bytes whenever it contains `-` or `_`, which is about
half the time, and the signature is then over something the server never sent.

## POST /auth/verify

Request:

```json
{ "userId": "G...", "derSignature": "<hex>", "cosePublicKey": "<hex, optional>" }
```

Response:

```json
{
  "challenge": "<the challenge that was consumed>",
  "compactSignature": "<hex, 64 bytes of r||s>",
  "uncompressedPublicKey": "<hex, 65 bytes, only if cosePublicKey was sent>"
}
```

`derSignature` is ASN.1 DER exactly as WebAuthn produces it. The conversion to
the contract's 64-byte `r||s` happens here, not in the browser.

## GET /guard/velocity?user=G...

```json
{
  "limitStroops": "5000000000",
  "spentStroops": "120000000",
  "limitXlm": "500",
  "spentXlm": "12",
  "remainingXlm": "488",
  "guarded": true
}
```

`limitStroops` is `null` when the user has set no limit. That is **not** the
same as a limit of zero, and the difference matters: no limit means nothing is
enforced. The endpoint used to return a confident `0` for both fields because
it called contract methods that do not exist and swallowed the errors.

## GET /registry/drips?address=G...

`{ "address": "G...", "trusted": false }`

One address per call. There is no list: the registry stores a flag per address
and Soroban cannot enumerate storage keys, so nothing can produce one.

## POST /tx/relay

Request `{ "xdr": "<base64 signed envelope>" }` (`signedXdr` is also accepted)
→ `{ "success": true, "result": { ... } }` — whatever Soroban RPC returned.

## Contract methods this backend calls

`limit_of`, `spent_today`, `is_trusted_drip`. If you rename one in
`stellar-shield-contract`, this file and `src/lib/soroban.ts` are what break.
