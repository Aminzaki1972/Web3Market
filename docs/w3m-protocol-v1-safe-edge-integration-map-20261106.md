# W3M Protocol V1 — Safe Edge Function Integration Map

**Captured:** 2026-11-06  
**Branch:** `w3m-protocol-v1-isolated-20261105`  
**Scope:** Source-derived integration plan only. No deployed function was changed or invoked.

## 1. Verified isolated CI result

The latest Safe-facts negative-test run `42130922902` completed with **success** on commit `69cb2f2ff827b5d201c7d05ca40f1e3c4fe9b532`. The run passed the Deno type-check/unit-test sequence and disposable PostgreSQL migration/contract tests. Added negative cases reject a mismatched BNB chain ID, Safe nonce, duplicate owner, threshold, or Safe version. This does not imply that the six deployed functions are integrated.


GitHub Actions run `42121162098`, commit `66d38c61da01b9ce5edf9544ab2f233c0b0b3071`, completed with **success**. The type-check, all listed Deno suites, both registry migrations, and both PostgreSQL schema-test scripts passed against the workflow's disposable PostgreSQL service.

This proves the isolated code and the two W3M registry migrations pass the current workflow. It does not prove production integration, live BNB behavior, or end-to-end settlement.

## 2. Function-by-function insertion map

The line references below refer to the captured source snapshots in `docs/w3m-protocol-v1-source-snapshot-20261106/`, not to a deployable source tree.

| Function | Existing source boundary | Required W3M control |
|---|---|---|
| `prepare-deal-release` v43 | Loads deal and checks dispute/payment/participant wallets; locks release policy and creates/updates release transaction (snapshot lines 32–56). | Load canonical deal/project/agreement/payment/dispute evidence; issue or load a current signed report; require W3M PASS before policy lock or transaction creation. Preserve all existing checks. |
| `prepare-safe-release-tx` v37 | Loads deal/policy; checks delivery acceptance, payment and dispute; existing transaction fast path at lines 91–100; constructs Safe MultiSend and updates tx/policy nonce at lines 112–148. | Validate the exact existing or newly built MultiSend payload against the locked policy before returning/reusing it and before persisting it. Require the same latest PASS report and unchanged terms/evidence. Do not clear signatures or rebuild if any state is unresolved. |
| `record-safe-release-signature` v24 | Loads deal/transaction/profile; verifies EIP-712 signature at line 45; upserts signer and updates signature summary at lines 52–57. | Re-load current report, terms and policy; validate exact persisted payload and recomputed Safe hash; recover signature; bind signer to current Safe owner and exact hash; persist only after all checks. |
| `execute-safe-release` v28 | Loads deal/tx/policy/signers; recomputes Safe hash around lines 96–106; broadcasts at lines 163–171; updates transaction at line 177. | Immediately before broadcast: re-load all canonical evidence and terms, verify report and trusted key status, decode payload, recompute live Safe hash, recover every signature, enforce unique current owners and threshold, then acquire an atomic idempotent execution claim. Persist/check broadcast hash and reconcile uncertain outcomes before retry. |
| `finalize-safe-release` v25 | Verifies receipt, Safe hash, ExecutionSuccess/Failure and exact USDT transfers; sequential DB updates at lines 51–60. | Bind receipt to the same report and execution attempt; preserve all chain checks; replace separate state updates with one narrowly scoped atomic finalization RPC and idempotent expected-state predicates. |
| `create-safe` v56 | Creates/deploys Safe and writes deployment/policy data. | Not a settlement gate. Keep separate. Do not invoke during protocol checks; never let report issuance or W3M verification deploy a Safe. |

## 3. Non-negotiable shared invariants

1. All evidence and policy inputs are loaded server-side. Browser booleans, hashes, amounts, wallet addresses, signer identities and status flags are never authoritative.
2. A report must be signed by a trusted, active W3M key and be the current non-superseded report for the exact deal/project/terms.
3. Mandatory evidence absence, stale evidence, changed deal terms, unresolved dispute, payment uncertainty, delivery uncertainty or any adapter error fails closed.
4. The exact persisted Safe payload is decoded and semantically checked at preparation, signature-recording and execution boundaries.
5. Every stored Safe signature is recovered again at EXECUTE against the freshly recomputed Safe EIP-712 transaction hash; recovered addresses must match unique stored signers and live Safe owners, and meet the live threshold.
6. Execution claim, broadcast tracking and finalization must be idempotent. A timeout is not permission to broadcast again.
7. Existing receipt/log verification in finalization must remain intact.
8. W3M report signature and Safe owner signature are separate cryptographic authorizations.

## 4. Current blockers before writing the server integration

A read-only production schema/catalog snapshot is now recorded in `docs/w3m-protocol-v1-production-deal-schema-readonly-20261106.md`. It confirms the relevant deal, release-policy, Safe transaction/signer, agreement, dispute, and audit fields, RLS metadata, constraints, triggers, and the current `validate_deal_release_policy` definition. No business rows were read and no production object was changed.

The snapshot is metadata and source inspection, not a complete deployable DDL export. The new atomic finalizer migration was authored against the confirmed column/behavior map and is tested against disposable fixture tables. Before any production migration, the fixture must be reconciled against an exact schema export or isolated staging database, including trigger side effects and foreign-key details.

Remaining blockers:
- The six deployed Safe Edge Functions still have no W3M integration. Captured versions remain create-safe v56, prepare-deal-release v43, prepare-safe-release-tx v37, record-safe-release-signature v24, execute-safe-release v28, and finalize-safe-release v25.
- The report issuer and server-side provider credential loading are not deployed or staging-wired. The isolated protocol service accepts already-loaded authoritative evidence and an injected protected signer; it does not fetch all live deal/provider inputs itself.
- The isolated RPC adapter now composes report registry persistence, claim, broadcast recording, reconciliation, and atomic finalization, but it has not been wired to the six Edge Functions.
- Fee precision differs between production constraints, validation function, and existing triggers. V1 does not write release policies; it relies on the existing validator and fails closed when the locked policy cannot satisfy both existing checks.
- The production dispute vocabulary and validator disagree. V1 only permits exact `dispute_status = 'none'` at claim time; all other values remain blocked.

## 5. Next safe engineering step

Prepare isolated patch copies of the six exact captured Edge Function versions, preserving existing authentication, payment, delivery, Safe hash, owner-signature, receipt, and transfer checks. Integrate the W3M service/RPC adapter at the documented boundaries, add Deno type checks and mocked Supabase/BNB provider tests, and keep all six patches non-deployable on the isolated branch. Then run a full isolated flow against disposable PostgreSQL and a BNB testnet Safe before discussing staging or production.




## 6. Reusable gate service now available in the isolated branch

The isolated branch now provides `dealroom-w3m-service.ts` as the single server-side entry point. A Safe Edge Function should:
1. Load the latest authoritative deal, parties, locked release policy, and current Safe facts.
2. Build a `DealTermsSnapshot` using exact numeric text values and call `checkDealRoomWithW3M`.
3. Stop immediately unless the returned `authorized` value is exactly true.
4. Call it at PREPARE before creating/rebuilding a Safe release transaction, and again at EXECUTE immediately before broadcast using freshly loaded rows and Safe owner/threshold/nonce/hash data.
5. After broadcast, reconcile the exact transaction hash. Once the server verifies receipt success, Safe ExecutionSuccess, and the two exact USDT Transfer events, call the atomic finalization RPC.

The report loader reads only the newest report version, its evidence rows, and the signer-status view through a server-only client. The persisted-report guard rebuilds the original evidence manifest using preserved source evidence IDs and original timestamps, recomputes the canonical report hash, checks current terms, and verifies the report signature against the trusted signer registry.

**Current boundary:** this is a tested reusable service, not yet wired into any of the six deployed Edge Functions. The snapshots remain read-only references. No function was deployed or invoked.

## 8. Exact Deal Room terms boundary and conservative fee precision

The isolated branch now includes:
- `w3m_read_dealroom_terms_snapshot(uuid)`, a read-only SECURITY DEFINER RPC returning the current deal and locked release-policy financial fields as exact PostgreSQL text, executable only by `service_role`;
- `dealroom-terms-reader.ts`, which loads exactly one snapshot, rejects missing/ambiguous results, maps it into the W3M gate, and fails closed on RPC errors;
- a strict row adapter that rejects financial values delivered as JavaScript numbers rather than exact decimal text;
- a fee-precision compatibility check that independently calculates the 7.5% fee at both 8 and 18 decimal places and blocks a deal unless the existing production validator and table constraint produce the same exact fee.

This deliberately narrows V1 eligibility. It does not change the production fee policy or repair the existing production trigger/function disagreement. It prevents W3M from approving a deal whose current database checks may disagree about the fee.

The reader migration and SQL contract test are included in the disposable PostgreSQL workflow only. They have not been applied to production.

## 9. Safety record

- No production Edge Function edited, deployed or invoked.
- No production DB schema or row changed.
- No Safe, wallet, key, balance or transaction touched.
- No merge to `main`.
- All implementation remains on the isolated branch.


## 10. Latest isolated CI verification — 2026-11-06

The Safe live-facts test interface mismatch was corrected in commit `0e242f8f3e7f69eed9d416786e0d09449966abdb` by updating `dealroom-terms-reader.test.ts` to supply a complete `safeFacts` object (BNB Chain 56, exact Safe address, three expected owners, threshold 2, Safe version 1.4.1, and exact nonce).

GitHub Actions run [42130649959](https://github.com/Aminzaki1972/Web3Market/actions/runs/42130649959) completed with **success** on that commit. Verified in this run:
- Deno type-check across the isolated W3M modules and Deal Room reader;
- all listed Deno test suites, including Safe payload validation/decoding, cryptographic signature recovery, trusted signer checks, persisted report verification, exact Deal Room snapshot loading, and the Supabase RPC adapter;
- all four W3M SQL migrations applied to the workflow's disposable PostgreSQL database;
- evidence registry, trusted signer registry, execution-attempt lifecycle, atomic finalizer, and exact Deal Room reader SQL contract tests passed.

This is the first green CI run after the live Safe facts interface change. It verifies the isolated branch's automated checks only. It does not change the integration boundary stated above: none of the six deployed Safe Edge Functions has been modified or wired to W3M, and no migration or function has been deployed to production.

## 7. Phase-aware integration boundary (isolated)

Added `safe-edge-w3m-boundary.ts` and `safe-edge-w3m-phase-boundary.ts` under the W3M verification function directory. The generic boundary denies protected actions when fresh authorization fails, is malformed, or reports any issue. The phase-aware wrapper additionally binds each call to one of `PREPARE`, `SIGN`, `EXECUTE`, or `FINALIZE`, requires a nonblank deal ID, and for EXECUTE/FINALIZE requires a 32-byte Safe transaction hash.

The generic boundary and its test suite passed CI in run `42131914382` (success), including Deno type-checks, the boundary test, and disposable PostgreSQL migration/contract tests. The phase-aware module and its five tests are in commits `3baa2ba740c223af5d8327aa549f81b1aa6ab6f0` and `98e0df219f48e13c7f0a5a944ace8af0eb3ada8f`; its CI run `42132090107` was still in progress at the time of this note.

**Integration limitation:** these are tested boundary contracts, not yet inserted into the five deployed Safe handlers or deployable copies of those handlers. Each handler still needs a separately reviewed isolated copy and a concrete fresh-state authorizer wired to its existing database/RPC/chain reads. Do not deploy or connect this helper to production until those adapters and end-to-end tests are complete.

## 8. Fresh handler authorization composition (isolated)

Added `safe-handler-w3m-authorizer.ts`. For PREPARE and SIGN it maps to the PREPARE gate; for EXECUTE it maps to the EXECUTE gate. On every invocation it calls an injected server-side loader for fresh Deal Room RPC input and live Safe facts, then calls `checkDealRoomFromExactSnapshot`, which reads the exact terms snapshot and current persisted W3M report/evidence/trusted signer rows. A cryptographic digest-recovery verifier is mandatory; the authorizer never accepts a browser-provided "verified" boolean. Any read, parsing, or verification error returns a denial.

FINALIZE is intentionally denied by this pre-execution authorizer with `W3M_FINALIZATION_REQUIRES_VERIFIED_RECEIPT`. It must use the separate chain receipt/log verifier and atomic `w3m_finalize_safe_execution_attempt` RPC path; passing a pre-execution gate alone is not sufficient proof that a Safe transaction succeeded.

Tests were added for fresh-read failure, phase binding, finalization denial, and missing deal context. CI runs `42132486155` (authorizer implementation) and `42132507852` (tests + workflow inclusion) were pending when this note was written. No deployed Safe handler source has been modified, and no production database/function/site was changed.

## 9. Verified-receipt finalization boundary (isolated)

Added `safe-finalization-guard.ts` and its test suite. This boundary requires a fresh receipt-verifier callback, then independently checks the normalized attestation fields against the locked attempt/policy values supplied by the server: BNB chain 56, exact broadcast transaction hash, successful receipt, Safe ExecutionSuccess with no ExecutionFailure, exact Safe address and Safe transaction hash, exact token contract, and exactly two Safe-originating transfers with exact seller-net and platform-fee recipients/amounts. Only after these checks does it call the service-role finalization RPC adapter. A verifier read failure or any mismatch blocks the RPC call.

The injected receipt verifier remains a critical trust boundary: its implementation must independently fetch the BNB receipt and logs, verify the Safe event emitter/topics and ERC-20 Transfer log contract/topics/data, and construct the normalized evidence. The guard does not itself connect to BNB RPC and does not claim that the verifier implementation is complete.

CI run `42132507852` passed the fresh Safe handler authorizer tests and type checks. Receipt guard runs `42132648424`, `42132662152`, and `42132686955` were pending when this note was recorded. No live function, production database, Safe, wallet, or funds were accessed or modified.

## 10. Raw BNB receipt reader and finalizer composition (isolated)

Added `bnb-safe-receipt-verifier.ts`. Unlike the earlier injectable-attestation boundary, this module reads raw JSON-RPC data itself through the injected read-only `JsonRpcClient` and performs these checks before producing the normalized receipt evidence:

- exact BNB mainnet chain ID 56;
- receipt exists, status is successful, transaction hash matches, and receipt block hash matches the canonical block returned by `eth_getBlockByNumber`;
- configured minimum confirmations are reached;
- token `decimals()` is read at the receipt block using `eth_call`, rather than trusted from a browser or caller-supplied decimal setting;
- Safe 1.4.1 `ExecutionSuccess(bytes32,uint256)` event is emitted by the expected Safe and indexed transaction hash matches the exact W3M attempt's Safe transaction hash; any matching `ExecutionFailure`, missing/duplicate success, or malformed event blocks;
- all Safe-originating ERC-20 Transfer logs in the receipt are collected, and a Safe-originating transfer from any token other than the pinned token blocks;
- exactly two Safe-originating token transfers are required; the existing finalization guard then compares their exact sender, recipients, and normalized decimal amounts to the locked seller-net and platform-fee amounts.

Added `finalizeBnbSafeReleaseAfterRpcVerification(...)` to compose the raw BNB reader, the fail-closed finalization guard, and the service-role atomic finalization RPC adapter. Tests use a mocked JSON-RPC client only; they do not connect to BNB mainnet, send transactions, or touch funds.

**Important limits:** the caller must still construct `expected` exclusively from a freshly loaded and locked execution-attempt/deal/policy snapshot, use an HTTPS allowlisted BNB RPC endpoint, and supply a server-only Supabase service-role client. This module is not wired into the live `finalize-safe-release` handler. The earlier syntax defect in the guard was caught by CI and corrected in commit `48d3818354a4e5ace219cd7c82728ff499340df0`; the CI run for that corrected tree is pending.

## 11. Fresh finalization snapshot reader (isolated)

Added migration `20261107020000_w3m_protocol_v1_safe_finalization_snapshot_reader.sql` with service-role-only, read-only RPC `w3m_read_safe_finalization_snapshot(uuid)`. It joins the exact execution attempt, deal, Safe transaction, and release policy, and returns immutable identifiers, Safe transaction hash, recorded broadcast hash, BNB chain, Safe/token addresses, seller/platform wallets, and financial amounts as text. It refuses any attempt that is not BROADCAST or RECONCILIATION_REQUIRED with a recorded hash, or whose transaction/policy/Safe/token bindings are no longer eligible.

Added `safe-finalization-snapshot-adapter.ts`, which rejects malformed RPC rows, nonparticipant actors, invalid addresses/hashes, numeric financial values, unexpected states, and non-BNB chain. It preserves the seller-net and platform-fee decimal strings exactly. The raw receipt module now also exposes `finalizeBnbSafeReleaseFromFreshSnapshot(...)`: fresh service-role snapshot -> read-only BNB receipt verifier -> exact receipt guard -> atomic finalization RPC. The finalizer still locks and rechecks current persisted rows, so a change between snapshot and finalization causes rejection.

The disposable SQL contract test now checks snapshot access is service-role-only and that exact identifiers, hashes, and numeric text survive the RPC. Deno adapter tests cover malformed snapshots, actor mismatch, state/chain mismatch, and numeric coercion rejection. CI for the corrected and extended tree is pending; earlier receipt-reader run `42134019528` correctly exposed a bad test fixture amount (0.75 vs 7.5) and an assertion expecting the inner verifier error rather than the fail-closed wrapper. Both test issues were corrected; no claim of a passing CI run is made yet.


## 11. Isolated finalization request endpoint — 2026-11-06

Added a separate, non-deployed function directory at `supabase/functions/w3m-protocol-v1-finalize-safe-release/`. It is intentionally distinct from the captured production `finalize-safe-release` handler and does not replace it.

The request boundary:
- accepts POST only and restricts browser origins to the two Web3Market HTTPS origins;
- derives the actor ID from a verified Supabase bearer session, never from request JSON;
- accepts only a W3M execution-attempt UUID from the request body;
- loads the fresh finalization snapshot server-side, verifies the BNB receipt/logs through the allowlisted read-only RPC client, applies the W3M receipt guard, and calls the atomic finalization RPC;
- does not accept a caller-supplied transaction hash, receipt, transfer list, wallet, amount, or authorization boolean.

A first CI run, `42135224575`, correctly exposed a bearer-header regular-expression escaping defect in the new request boundary: 2 of 5 tests passed and 3 failed because valid `Bearer <token>` headers were rejected. The defect was corrected in commit `9bdc80544dac579950df5b233b0bab56732b5daf`. The follow-up CI run `42135541989` was queued at the time of this update; do not treat the new endpoint as verified until that run completes successfully.

This is still an isolated endpoint only. It has not been deployed, has no production secrets configured, and has not been wired into the existing production `finalize-safe-release` function. No database migration was deployed and no live Safe transaction was touched.


## 12. Isolated EXECUTE coordinator — 2026-11-06

Added:
- `supabase/functions/w3m-acquisition-verification/safe-execution-coordinator.ts`
- `supabase/functions/w3m-acquisition-verification/safe-execution-coordinator.test.ts`

The coordinator is a pure orchestration boundary, not a deployable replacement for `execute-safe-release`. It composes the existing full `evaluateSafeExecutionGuard` with injected server-side adapters and enforces this sequence:

1. Load a fresh execution snapshot and validate deal, transaction, report ID/version, executor and idempotency bindings.
2. Run the complete W3M settlement + stored MultiSend payload + independently recomputed Safe hash + execution-time Safe signature-set guard.
3. Acquire the server-only atomic execution claim for the exact deal, transaction, report and Safe hash.
4. Load a second fresh snapshot after the claim and repeat the full guard immediately before the protected broadcast callback.
5. Require the second snapshot to retain the exact deal, transaction, report ID/version, Safe hash and idempotency key.
6. Call the protected broadcast callback once, validate the returned 32-byte transaction hash, then persist that exact hash through the broadcast RPC adapter.

Fail-closed behavior:
- initial gate failure does not claim or broadcast;
- any idempotent claim replay or already-advanced attempt is sent to reconciliation and is never rebroadcast;
- inability to reload state, changed bindings, failed second authorization, uncertain broadcast result, malformed hash, or failed hash persistence transitions the attempt to reconciliation-required (best effort) and never retries the broadcast;
- if the reconciliation transition itself fails, the active CLAIMED attempt remains blocking under the unique active-attempt constraint.

The coordinator deliberately does not load database rows, call BNB, derive transaction calldata, sign, or broadcast by itself. The eventual isolated `execute-safe-release` adapter must supply a fresh authoritative snapshot, the actual Safe transaction submission callback, and the RPC methods; it must not treat the coordinator's injected callback as permission to skip the existing Safe checks.

CI verification for this coordinator completed successfully in run `42136163614` on commit `45d86ece4a2bb269070da8ae8f7a42b7dbfdd851`: all 44 reported steps completed successfully, including the coordinator type-check, all eight coordinator behavior tests, the other Deno suites, and disposable PostgreSQL migration/contract checks. This verifies the isolated implementation and its mocked/injected boundary behavior only; it does not exercise a live Safe broadcast or prove production integration. All changes remain on the isolated branch; no production function or environment was changed.


## 13. Read-only live Safe execution facts adapter — 2026-11-06

Added `safe-live-execution-facts.ts` and its Deno tests. It defines a read-only provider contract and validates, on every fresh execution snapshot:
- BNB mainnet chain ID 56;
- exact expected Safe address and deployed bytecode;
- exact unique owner set (buyer, seller and platform wallets supplied by the trusted caller);
- threshold 2;
- Safe version 1.4.1 using the source-confirmed `VERSION()` contract read;
- exact current Safe nonce;
- recomputed Safe EIP-712 transaction hash against the persisted signed hash.

Malformed transaction fields, duplicate/changed owners, wrong chain/version/threshold/nonce, missing bytecode, provider errors and hash mismatch fail closed. This module has no built-in RPC URL or live provider connection; the eventual isolated execute handler must inject a read-only, allowlisted BNB client and must not use browser-supplied facts.

CI run `42136570158` (commit `19cb779300d5bbddecd82b64e1045130dbe90bcd`) completed successfully: all 44 reported steps passed, including the new live Safe facts type-check and its eight tests. This validates the injected read-only interface and fail-closed comparisons with mocked clients; it does not validate a real RPC provider or a live Safe. No live BNB RPC call or Safe transaction was performed.

### Next integration gate — authoritative EXECUTE snapshot

The next implementation must not guess the production schema. The checked-in migration history on this isolated branch contains the W3M-owned registry, signer, execution-attempt, finalizer, Deal Room terms-reader and Safe-finalization snapshot migrations, but it does not contain authoritative CREATE TABLE definitions for the existing `deals`, `deal_release_policies`, `deal_multisig_transactions`, or `deal_multisig_signers` tables. The source-derived field map is therefore not sufficient to safely author a new EXECUTE snapshot RPC or claim adapter. Before that adapter is written, obtain and inspect the authoritative schema/migration definitions and the exact `validate_deal_release_policy` function definition in an approved read-only schema-only export. Until then, the isolated coordinator remains injectable and is not connected to any production `execute-safe-release` handler. No production rows, secrets, migrations, or functions were accessed or changed for this step.


## 14. Authoritative production schema metadata review — read-only — 2026-11-06

A schema-only inspection was performed against the existing Web3Market Supabase project using catalog/information-schema metadata. The queries selected column definitions, nullability/defaults, constraints and the definition of `public.validate_deal_release_policy(uuid)`; no deal rows, user records, secrets, or transaction data were queried. No database writes, migrations, deployments, or function changes were made.

### Confirmed structure relevant to W3M EXECUTE

- `deals`: `id/project_id/buyer_id/seller_id` are UUID; `amount/expected_amount/platform_fee/platform_fee_percent/seller_net_amount/platform_fee_amount` are numeric; payment/delivery/dispute statuses and hashes are text; buyer/seller agreement timestamps exist on the deal row; `delivery_data` is JSONB.
- `deal_release_policies`: one row per deal is enforced by unique `deal_id`; financial fields are PostgreSQL numeric; `safe_nonce` and `chain_id` are bigint; policy status allows pending/locked/ready/blocked/released. The `release_policy_math` check computes fee amount rounded to 18 decimal places.
- `deal_multisig_transactions`: transaction rows include all Safe EIP-712 fields used by the source functions. `action` allows deposit/release_to_seller/refund_to_buyer; status allows awaiting_signatures/signed/submitted/confirmed/cancelled; required signatures is constrained to 2. There is no unique constraint on `(deal_id, action)` or `safe_tx_hash` in the inspected constraints.
- `deal_multisig_signers`: unique `(deal_id, signer_role)`; roles are buyer/seller/platform; signature status is pending/signed/rejected. Signer rows hold wallet, Safe hash and signature.
- `deal_party_agreements`: unique `(deal_id, party_role)`; roles buyer/seller; stores `party_id` and `agreed_at`, but the inspected table has no terms hash, terms version, or signed document digest.
- `deal_disputes`: at most one row per deal; statuses open/under_review/resolved/cancelled. The deal-level `dispute_status` check instead allows none/open/under_review/resolved_buyer/resolved_seller/closed. The status vocabularies are not identical.

### Exact existing policy validator behavior

The live function `public.validate_deal_release_policy(p_deal_id uuid)`:
- accepts deal-level dispute status only in `none` or `resolved`;
- requires `payment_status='confirmed'` and a non-null `payment_tx_hash`;
- requires `delivery_status='accepted'` and non-null `buyer_approved_at`;
- requires chain 56 and non-null Safe/token addresses;
- computes the 7.5% fee rounded to 8 decimal places;
- if a policy exists in locked/ready/released state, checks its amount, fee, seller net, Safe, token, chain and nonce.

**Compatibility issue:** the deal table's checked dispute values include `resolved_buyer`, `resolved_seller`, and `closed`, while the validator accepts `resolved` (which is not in the inspected deal-level check constraint). The W3M adapter currently accepts only exact `none`, which is intentionally more restrictive. This discrepancy must be resolved explicitly in a future protocol policy; do not silently map one vocabulary to another.

**Critical agreement gap:** the existing party-agreement table cannot prove that buyer and seller accepted the exact same immutable terms version/hash. A timestamp alone is not sufficient evidence for the W3M `DEAL_AGREEMENT` evidence type. Until a versioned agreement record or equivalent independently verifiable signed digest exists, the acquisition report must keep agreement evidence INCOMPLETE/BLOCKED and must not return settlement PASS.

**Fee precision gap:** the production policy constraint uses 18-decimal arithmetic while the existing validator uses 8-decimal rounding. The isolated W3M deal-terms adapter already fails closed when these results differ; this avoids silently accepting a policy that does not match both calculations. This is not a production fee calculation fix.

**Concurrency gap:** because the inspected Safe transaction table has no unique `(deal_id, action)` or `safe_tx_hash` constraint, an EXECUTE snapshot must reject zero or multiple candidate release rows and bind one exact transaction ID/hash. It must not use `maybeSingle` semantics or assume a unique row without a database-enforced invariant. The W3M execution-attempt table's own per-deal active-attempt uniqueness remains a separate guard and does not repair ambiguity in the legacy transaction table.

### Implementation consequence

The next isolated change should extend the exact Deal Room snapshot reader to expose agreement rows and complete dispute state as read-only evidence, but it must represent missing immutable agreement binding as an explicit blocker. Do not invent a terms hash from current row values and call it proof of prior consent. No schema change is authorized or implied by this metadata review. Any future agreement-schema enhancement must be proposed separately and remain isolated until explicit approval.

This review only inspected schema metadata and the validator definition. It did not query production deal/user rows, and it did not change production schema, data, functions, environment variables, or Safe state.


### Front-end acceptance path cross-check

A read-only source inspection of the isolated branch's current `js/deal-room.js` confirms that the “I Agree to Deal Terms” button currently upserts only `deal_id`, `party_role`, `party_id`, and a client-generated `agreed_at` timestamp into `deal_party_agreements`. The read path selects only `party_role,party_id,agreed_at`. No wallet signature, canonical terms digest, terms version, or signed payload is created or verified in this flow.

This means the current UI action is a recorded acknowledgement, not cryptographic proof of acceptance of an immutable agreement. The W3M Protocol must not elevate that timestamp to verified `DEAL_AGREEMENT` evidence. A future agreement upgrade needs a separately reviewed flow that binds both parties to one canonical terms digest/version and verifies each party's signature against the wallet associated with that party. The signature scheme and canonical typed payload must be specified before implementation; do not assume `personal_sign` or raw-digest signing without an explicit protocol decision.


## 15. Isolated Safe EXECUTE database snapshot reader — 2026-11-06

Added:
- `supabase/migrations/20261107030000_w3m_protocol_v1_safe_execution_snapshot_reader.sql`
- `supabase/functions/w3m-acquisition-verification/safe-execution-snapshot-adapter.ts`
- `supabase/functions/w3m-acquisition-verification/safe-execution-snapshot-adapter.test.ts`
- disposable SQL contract test `supabase/tests/w3m-safe-execution-snapshot-reader.test.sql`

The new service-role-only, read-only RPC `w3m_read_safe_execution_snapshot(uuid)` returns one consistent JSON snapshot of the exact deal, release policy, project, buyer/seller wallet verification metadata, all legacy `release_to_seller` transaction rows, signer rows, party-agreement acknowledgement rows, and dispute status. PostgreSQL numeric values are converted to exact text before leaving the database. The reader returns every release candidate rather than hiding duplicates; the adapter rejects zero or multiple candidates because the legacy table has no unique deal/action constraint.

The strict Deno adapter validates deal/project/participant bindings, exact decimal strings, BNB chain and Safe/token consistency, exact signed release transaction hash, signer hash binding and unique wallets, and the buyer/seller acknowledgement rows. It records explicit blockers for missing immutable agreement binding, any dispute record/non-`none` deal dispute status, unconfirmed payment, missing buyer delivery acceptance, unverified participant wallets, and seller-wallet/policy mismatch. It never authorizes, signs, broadcasts, or finalizes.

**Important:** `agreement_binding_supported` is deliberately false in this version because the current production agreement table and UI do not store a terms digest/version or wallet signature. Thus this snapshot adapter cannot produce an execution-ready result today; that is a safety property, not a temporary bypass. A separate, reviewed agreement-signing design is required before a future snapshot can clear that blocker.

CI:
- Run `42137826566` reached the disposable PostgreSQL stage and failed before applying the new migration because the test fixture attempted to add `token_symbol` twice. The fixture was corrected by removing duplicate additions; no SQL assertion or runtime behavior is claimed from the failed run.
- Follow-up run `42137916304` completed successfully: all 46 job steps completed with zero failures, including the new Deno adapter type-check and tests, application of the new migration to disposable PostgreSQL, and the SQL snapshot-reader contract test. This verifies the isolated reader and adapter contract only; it does not connect the RPC to production or authorize Safe execution.

All files remain on `w3m-protocol-v1-isolated-20261105`. No production function, database schema, data, secrets, Cloudflare configuration, Safe transaction, or funds were changed.


## 16. Concrete read-only BNB Safe RPC reader — 2026-11-06

Added `bnb-safe-live-read-client.ts` and its mocked RPC tests. It implements the existing `SafeLiveReadClient` interface using JSON-RPC only:
- `eth_chainId`, `eth_blockNumber`, `eth_getCode`;
- Safe `getOwners()`, `getThreshold()`, `nonce()`, and `VERSION()`;
- Safe `getTransactionHash(...)` with explicit ABI encoding of the dynamic `bytes data` argument.

The factory captures a BNB mainnet block tag (chain 56) and pins every subsequent Safe `eth_call` and `eth_getCode` request to that same block number. It validates ABI offsets, owner array bounds, address words, uint values, version string, and the returned bytes32 transaction hash. The code performs no transaction signing, submission, or broadcast. Tests use an injected mock JSON-RPC client; no live BNB RPC endpoint has been contacted.

CI run `42138329931` completed successfully with zero failed steps, including type-checking and all five mocked tests for the block-pinned reader. A later hardening pass added an execution-ready snapshot wrapper plus stricter nonce, signer, project-owner, wallet-verification, and platform-wallet checks. Follow-up run `42138582420` completed successfully: all 46 job steps completed with zero failures, including Deno type-checks/tests and the disposable PostgreSQL migration/contract checks. The concrete reader is not yet connected to an execution Edge Function or to any production Safe handler.


## 17. Canonical-block BNB Safe execution facts reader — 2026-11-06

Added:
- `supabase/functions/w3m-acquisition-verification/bnb-safe-execution-facts-reader.ts`
- `supabase/functions/w3m-acquisition-verification/bnb-safe-execution-facts-reader.test.ts`

This wrapper composes the existing read-only BNB Safe client with the Safe facts verifier. It captures BNB chain 56 and one fixed block number, reads that block's hash, performs the Safe contract reads and Safe transaction-hash recomputation at the pinned block, then reads the same block header again. If the block hash changed during the read window (reorg), it returns an invalid facts result with `SAFE_READ_BLOCK_NOT_CANONICAL`. Malformed or unavailable block headers fail closed.

The wrapper accepts an injected `JsonRpcClient`; it does not choose or contact a live RPC endpoint itself. The future Edge handler must construct that client with the existing HTTPS hostname allowlist. Tests use mocked JSON-RPC responses only; no live BNB endpoint, wallet, Safe transaction, or funds are touched.

CI run `42138975440` was created for commit `958f94e8b69155b80ee3875ec25052b42f9607bd`; its initial state was queued. The new helper and tests are included in the workflow's type-check and test steps. Final CI result will be recorded after completion.

The next unresolved execution prerequisites remain unchanged: immutable buyer/seller agreement signatures bound to the canonical deal-terms hash; loading and cryptographically verifying the latest persisted W3M report/evidence/trusted signer bundle; and composing those with the live Safe facts and coordinator in a dedicated isolated EXECUTE handler. No existing production Safe handler is wired to W3M.
