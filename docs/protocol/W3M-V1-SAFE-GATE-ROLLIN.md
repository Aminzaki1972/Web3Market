# W3M V1 — Safe settlement gate integration

This is a **staged source patch only**. It does not change any deployed Supabase Edge Function.

The shared gate is `supabase/functions/_shared/w3m-v1-finalization-gate.ts`. It calls the service-only `w3m_get_deal_finalization_evidence` RPC, reloads the current deal, audit binding, fingerprint, current terms version, and persisted acceptance rows, then independently verifies the exact buyer/seller EIP-712 signatures using the V1 verifier.

The database now freezes acquisition terms after the first party acceptance. This prevents a later terms publication from invalidating or racing the accepted terms. The finalization evidence RPC returns normalized hashes and canonical UTC acceptance timestamps for independent signature verification.

## Staged Safe function snapshots

The following source files were retrieved read-only from the live Supabase project, then copied into this PR branch and patched to call the shared gate before their sensitive operation.

| Function | Live version at retrieval | Live source SHA-256 |
|---|---:|---|
| `create-safe` | 56 | `d888f48d48c87563e20e43318f9187c0f02d9a46fbe5e037cadbb5520b918e07` |
| `prepare-deal-release` | 43 | `6c670d08fbb55fdc61a10c39b5f32062d311934228df59ce23096d337ba52e18` |
| `prepare-safe-release-tx` | 37 | `f4248dde096a3532befca8dbd894cdb3bb6511bdf2d6a70c8e253b9587b01dfe` |
| `record-safe-release-signature` | 24 | `fb4fedf2c17245b52d2920d3ac13c426b02a49d176dc96e75237c599840d5d01` |
| `execute-safe-release` | 28 | `e51aa4f2dffe259292a627b0ab1c3663c5f2ef46b7792cd96c156c452eb65d22` |
| `finalize-safe-release` | 25 | `4f39f60122f79198fd8b2051cefd172d600f1c1d3a5d48310b40620957efd5ce` |

## Gate placement

- `create-safe`: before Safe deployment and database policy writes.
- `prepare-deal-release`: before release policy preparation.
- `prepare-safe-release-tx`: before Safe release transaction preparation.
- `record-safe-release-signature`: before recording Safe signatures.
- `execute-safe-release`: before the actual on-chain execution path (read-only/check mode remains available).
- `finalize-safe-release`: before marking a release complete.

Each function fails closed with HTTP 409 if the current W3M buyer/seller acceptance pair is absent, stale, incomplete, or cryptographically invalid. The static CI regression checks that the gate call appears before the corresponding sensitive action in all six staged sources.

## Important deployment boundary

- These are branch snapshots, not live deployments.
- No production Edge Function has been updated.
- The SQL migration has only been exercised in disposable PostgreSQL CI.
- No Safe transaction, escrow deployment, release, or financial transfer was executed.
- Canonical acquisition terms remain unpublished until their authoritative content is approved; this patch does not invent governing law, inspection criteria, or dispute rules.
