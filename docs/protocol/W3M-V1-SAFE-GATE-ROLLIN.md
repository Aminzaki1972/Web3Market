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
- `finalize-safe-release`: before marking a release complete; it also independently blocks finalization when a dispute is open or dispute status cannot be verified.

Each function fails closed with HTTP 409 if the current W3M buyer/seller acceptance pair is absent, stale, incomplete, or cryptographically invalid. The static CI regression checks that the gate call appears before the corresponding sensitive action in all six staged sources. It also verifies dispute checks before Safe deployment, signature recording, and finalization; payment and buyer-approved delivery before signature recording/execution; locked release policy; and consistent Safe address, BNB chain, and configured BNB USDT asset before the settlement actions.

Latest branch CI at the verified code head: 107 Deno tests passed; the PostgreSQL migration/concurrency/privilege suite passed; CDN integrity, profile-guard migration, and modified JavaScript syntax checks passed. New protocol modules and the shared gate pass Deno type-check.

The new protocol modules and shared gate are included in Deno type-check. The six staged Safe entrypoints are covered by source-order regression checks rather than full Deno type-check because their existing legacy source contains unrelated typing errors around Safe Protocol Kit initialization, ethers dynamic contract methods, and implicit/unknown error types. Those typing issues are not changed by this V1 gate patch.

## Important deployment boundary

- These are branch snapshots, not live deployments.
- No production Edge Function has been updated.
- The SQL migration has only been exercised in disposable PostgreSQL CI.
- No Safe transaction, release, or financial transfer was executed. V1 uses Safe Wallet only; it does not introduce a separate escrow contract.
- Canonical acquisition terms remain unpublished until their authoritative content is approved; this patch does not invent governing law, inspection criteria, or dispute rules.


## Remaining V1 integration blockers — verified 2026-11-07

The source review found that the browser acceptance coordinator is not yet wired into the live Deal Room page:

- `js/w3m-deal-agreement-client.js` explicitly documents that it is not imported by the Deal Room.
- `js/deal-room.js` still loads and writes the legacy `deal_party_agreements` rows directly through an upsert when a participant clicks “I Agree to Deal Terms”.
- The new `w3m-acquisition-verification` Edge Function is not deployed in the production Supabase project, and its V1 acceptance-ledger migration is not applied there.
- The V1 preparation handler rejects acceptance when no published canonical acquisition terms exist. The protocol documentation intentionally leaves those terms unpublished until their authoritative content is approved.

Therefore the V1 acceptance path is tested in isolation but is **not yet the active Deal Room acceptance path**. Do not enable the new Safe finalization gates in production until the canonical terms are approved, the Deal Room displays the exact terms being signed, the browser client is integrated and tested, and the Edge Function plus migration are deployed in a separately approved release. This is a V1 completion dependency, not authorization to add scope or incur cost.

The migration source review also confirms that protocol RPC execution is revoked from `public`, `anon`, and `authenticated`, then granted only to `service_role`; private protocol tables have RLS enabled and direct client mutation is blocked by grants and immutability triggers. These are source-level findings; the migration remains unapplied to production.


## Safe-only wording clarification

The canonical-terms validator currently requires an `escrow` JSON section for funding condition, release condition, and dispute hold. In W3M V1 this section must be interpreted strictly as contractual descriptions of the **Safe Wallet multisig settlement process**. It must not identify, deploy, call, or imply a separate escrow smart contract. Payment method remains `safe_multisig` on BNB Smart Chain (56). Any user-facing terms renderer must say Safe Wallet / Safe multisig, not suggest that Web3Market operates an independent escrow contract.

## Canonical terms content still requiring approval

The validator intentionally rejects placeholder policy text. Before any real party can sign, the authoritative V1 terms must contain approved values for delivery checklist/deadline, inspection window and acceptance criteria, dispute procedure/version, Safe funding and release conditions, dispute hold, governing law or agreed process, venue, language, risk acknowledgements, and disclosures. These values must not be guessed or silently populated from UI copy. No canonical terms have been published by this branch.
