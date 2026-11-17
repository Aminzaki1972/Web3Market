# W3M Protocol V1 — Read-only Safe Edge Function Source Snapshot

Captured 2026-11-06 from the Supabase project named `web3market` by read-only Edge Function source retrieval.
Project ref: `hzhqlexnhtukfljcvnyd`.

IMPORTANT: These are source snapshots only, not deployable function directories. They are stored as `.txt` files under `docs/` to prevent accidental Supabase deployment. No function, database, secret, wallet, Safe, or production setting was changed.

Each file contains the function source as returned by Supabase. The version and `ezbr_sha256` below identify the exact deployed function version captured. These hashes are source package identifiers returned by Supabase, not independently recomputed hashes of the extracted text.

| Function | Deployed version | Source package SHA-256 |
|---|---:|---|
| `create-safe` | 56 | `d888f48d48c87563e20e43318f9187c0f02d9a46fbe5e037cadbb5520b918e07` |
| `prepare-deal-release` | 43 | `6c670d08fbb55fdc61a10c39b5f32062d311934228df59ce23096d337ba52e18` |
| `prepare-safe-release-tx` | 37 | `f4248dde096a3532befca8dbd894cdb3bb6511bdf2d6a70c8e253b9587b01dfe` |
| `record-safe-release-signature` | 24 | `fb4fedf2c17245b52d2920d3ac13c426b02a49d176dc96e75237c599840d5d01` |
| `execute-safe-release` | 28 | `e51aa4f2dffe259292a627b0ab1c3663c5f2ef46b7792cd96c156c452eb65d22` |
| `finalize-safe-release` | 25 | `4f39f60122f79198fd8b2051cefd172d600f1c1d3a5d48310b40620957efd5ce` |

## Scope and handling

- No environment variable values, API tokens, private keys, or database rows were requested or exported.
- Function source may contain public contract addresses and references to environment variable names; treat those as configuration details.
- The snapshots are evidence for static review only. Before any code is adapted, compare imports, schemas, RPC configuration, Safe policy, and transaction/signature formats.
- Do not deploy these `.txt` files. Do not merge the isolated branch into `main` without explicit approval.

## Known immediate review targets

- `execute-safe-release`: inspect whether signatures are cryptographically recovered again at execution, whether exact MultiSend calldata is validated before broadcast, whether W3M PREPARE/EXECUTE gates exist, and whether idempotency and post-broadcast DB errors are handled.
- `prepare-safe-release-tx`: inspect rebuild atomicity, existing signed transaction preservation, payload validation, and delivery/payment/dispute checks.
- `finalize-safe-release`: inspect transaction idempotency and atomic finalization of deal, policy, transaction, and listing state.
- `create-safe`: inspect deployer key custody and side effects; not a settlement authorization boundary.

## Explicit limitation

This snapshot does not establish that the function versions are safe, nor does it authorize any production change. Static review is not runtime verification.