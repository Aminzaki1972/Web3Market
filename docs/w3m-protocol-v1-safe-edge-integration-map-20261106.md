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

CI run `42138975440` on commit `958f94e8b69155b80ee3875ec25052b42f9607bd` completed successfully: all 46 job steps completed with zero failures, including the new canonical-block reader type-check and three mocked tests, all existing Deno suites, and disposable PostgreSQL migration/contract checks.

The next unresolved execution prerequisites remain unchanged: immutable buyer/seller agreement signatures bound to the canonical deal-terms hash; loading and cryptographically verifying the latest persisted W3M report/evidence/trusted signer bundle; and composing those with the live Safe facts and coordinator in a dedicated isolated EXECUTE handler. No existing production Safe handler is wired to W3M.


## 18. Immutable Deal Agreement signature scheme — proposal only — 2026-11-06

Added design proposal `docs/w3m-protocol-v1-deal-agreement-eip712-proposal-20261106.md`.

The proposal specifies EIP-712 typed-data acceptance by each verified buyer/seller wallet, domain-bound to BNB chain 56 and the deal's locked Safe address. The signed message binds deal, project, buyer, seller, canonical SHA-256 terms hash, monotonically increasing terms version, and party role. Server-side recovery must match the verified profile wallet; both parties must sign the exact same terms hash/version. The proposal explicitly separates agreement signatures from Safe owner transaction signatures.

This remains **design only**. No agreement table, RPC, browser wallet-signing flow, or production schema change has been created. The current W3M snapshot continues to block EXECUTE because timestamp-only legacy agreement rows cannot prove immutable terms acceptance. Implementation awaits approval of the exact EIP-712 payload and wallet-signing flow.

The canonical-block BNB Safe facts reader CI run `42138975440` is currently in progress; its final outcome is not yet claimed.


## 19. BNB JSON-RPC redirect hardening — 2026-11-06

The shared HTTPS/hostname-allowlisted BNB JSON-RPC client now sets Fetch `redirect: "error"`. This prevents an allowlisted endpoint from returning an HTTP redirect that causes the runtime to follow a different hostname and bypass the original hostname allowlist. HTTPS, no embedded URL credentials, and explicit hostname allowlisting remain required.

Added tests for redirect rejection mode and rejection of non-HTTPS/non-allowlisted endpoints. CI runs `42164163576` (implementation) and `42164173993` (tests) were started for these commits; final outcomes are pending in this document's current revision. No live RPC endpoint was contacted by the tests.


## 20. EXECUTE coordinator persistence-acknowledgement hardening — 2026-11-06

The isolated safe-execution-coordinator.ts now validates adapter acknowledgements instead of treating any resolved Promise as proof that a state transition was persisted:

- A claim response must contain a non-empty attempt ID, recognized state, boolean claimed and idempotentReplay; only a new CLAIMED attempt with claimed=true and idempotentReplay=false may proceed.
- After broadcast, the coordinator requires the hash-recording adapter to confirm recorded=true, a boolean replay marker, and state BROADCAST. A malformed, negative, or reconciliation-state response does not return BROADCAST_RECORDED; it enters reconciliation handling.
- Reconciliation is reported as persisted only when the adapter confirms updated=true, state RECONCILIATION_REQUIRED, and a boolean replay marker. A resolved-but-malformed response is not treated as success.
- Added regression tests for malformed claim acknowledgements, negative broadcast persistence acknowledgements, and malformed reconciliation acknowledgements.

The implementation and tests are on the isolated branch only. CI verification for these latest commits is pending/not yet confirmed. No broadcast, BNB RPC, database write, production function, migration deployment, or real fund movement was performed by this change.


## 21. EXECUTE coordinator acknowledgements — CI outcome — 2026-11-06

The coordinator hardening from section 20 has been verified by the later isolated workflow runs:

- Run 42164763940 — success; includes the malformed initial and pre-broadcast snapshot regressions.
- Run 42164755524 — success; includes fail-closed handling for malformed fresh snapshots.
- Run 42164703006 — success; includes corrected reconciliation acknowledgement coverage.
- Run 42164692543 — success; includes claim and broadcast persistence acknowledgement tests.

An earlier run, 42164680320, failed because its test file still used the pre-hardening adapter response shape. The subsequent test correction and later workflow runs above passed; the earlier run is superseded, not silently counted as passing.

## 22. Fresh Safe handler context composer — 2026-11-06

Added `fresh-safe-handler-context.ts` as the read-only composition boundary between the strict Safe database snapshot and the existing phase-aware W3M authorizer:

1. Loads one fresh service-role database snapshot for the exact deal.
2. Rejects every database blocker before making a BNB read, including missing immutable agreement-term binding.
3. Constructs the expected Safe transaction fields from stored server-side rows only.
4. Requires a supplied read function backed by `readCanonicalBnbSafeExecutionFacts`, so Safe facts are read at one BNB block and that block hash is rechecked after reads.
5. Rejects invalid chain, Safe address, owner set, threshold, version, nonce, or recomputed Safe transaction hash.
6. Returns only the fresh exact Deal Room reader context for the existing authorizer; it does not sign, claim, broadcast, or write.

Added tests for missing/malformed DB snapshots and invalid time. The workflow now type-checks and runs this composer test. CI outcome for the new composer commit is pending until its run completes.

The current isolated SQL snapshot deliberately returns `agreement_binding_supported=false`; therefore this composer blocks before chain reads for current schema snapshots. This is intentional until the buyer/seller same-terms consent mechanism is explicitly approved and implemented. The EIP-712 agreement flow remains proposal-only.

No production migration, deployed function, live website, live BNB call, or funds were changed by this work.


The composer now also exposes `authorizeSafeHandlerPhaseFromFreshSources(...)`, which feeds the fresh context into the existing phase-aware Safe authorizer. For PREPARE, SIGN, and EXECUTE, this creates one server-side entry point that reloads the database snapshot, validates canonical BNB Safe facts, and then invokes the persisted W3M report/evidence/signature gate. FINALIZE remains separately denied by this authorizer and must use the raw-receipt finalization path. A regression test confirms missing fresh database state blocks PREPARE before any Safe-facts read. The final wrapper/test commit is covered by workflow run 42165304790; outcome pending at documentation time.


## 23. Fresh Safe handler context composer — CI outcome — 2026-11-06

The fresh-context composer and phase wrapper from section 22 completed isolated CI successfully:

- Run 42165317668 — success; latest wrapper/test commit, including the phase-wrapper regression.
- Run 42165304790 — success; phase-wrapper implementation.
- Run 42165256940 — success; workflow/type-check integration.

These results confirm the automated Deno checks/tests and disposable PostgreSQL workflow steps in those runs. They do not mean the live Safe Edge handlers are wired to W3M. The agreement_binding_supported=false snapshot blocker remains active, so the fresh context intentionally refuses to authorize PREPARE/SIGN/EXECUTE until immutable same-terms buyer/seller consent is implemented. The EIP-712 agreement proposal remains unapproved and proposal-only.

No production deployment, production schema change, live BNB RPC call, Safe signature, broadcast, or fund movement occurred.


## 24. Exact phase/deal/Safe-hash binding and finalization separation — 2026-11-06

Additional hardening to the isolated phase boundary:

- `executeSafePhaseOnlyAfterW3M(...)` requires an exact non-empty deal ID for all pre-execution phases and an exact 32-byte Safe transaction hash for SIGN and EXECUTE.
- The fresh authorization must match the requested phase, exact deal ID, and (where required) the exact stored Safe transaction hash before the protected action can run.
- `authorizeSafeHandlerPhase(...)` now compares the caller's SIGN/EXECUTE hash against the freshly loaded database transaction row; a mismatch returns `W3M_SAFE_TRANSACTION_HASH_BINDING_MISMATCH`.
- FINALIZE is explicitly denied by this generic pre-execution boundary with `W3M_FINALIZE_REQUIRES_VERIFIED_RECEIPT_PATH`. It must use the separate raw BNB receipt verifier, fresh finalization snapshot, and atomic finalization RPC. This prevents a pre-execution report gate from being mistaken for proof of on-chain execution.
- Unknown runtime phase values are rejected before the authorization loader is called.
- Regression tests cover exact deal binding, SIGN/EXECUTE hash drift, FINALIZE separation, and unknown phases.

CI run 42165869470 completed successfully (46 steps) for the preceding exact deal/hash binding and authorizer update. The FINALIZE-separation and unknown-phase changes are newer; their latest workflow runs 42166372723, 42166434112, and 42166444653 were still in progress when this section was written and are not claimed as passed.

No live Safe Edge handler has been modified or wired, and no production deployment, migration, BNB RPC request, signature, broadcast, or fund movement occurred.


### Follow-up: phase-boundary type-check correction

The first CI attempts for the FINALIZE separation change exposed a TypeScript narrowing error: after FINALIZE was returned as denied, a redundant FINALIZE comparison remained in the hash-required expression. The expression was simplified to require hashes only for SIGN and EXECUTE. This is a compile-time correction, not a relaxation of the gate. The latest workflow for the corrected source is run 42166502907 and was still in progress at the time of this note; no pass is claimed yet.


## 25. EIP-712 immutable buyer/seller Deal Agreement — approved isolated implementation — 2026-11-06

The protocol owner approved the previously proposed EIP-712 design. The isolated branch now contains the first implementation slice:

- `deal-agreement-eip712.ts` builds standard EIP-712 typed data and independently computes the `0x1901` digest. Domain: `Web3Market Deal Agreement`, version `1`, BNB Chain ID `56`, intentionally no `verifyingContract`; the exact Safe address is an explicit signed message field. The typed struct binds hashed lowercase UUIDs for deal/project/buyer/seller, Safe address, the existing SHA-256 canonical terms hash, positive terms version, and party role (buyer=1, seller=2).
- Signature verification uses the existing pinned secp256k1/Keccak recovery adapter. It rejects malformed signatures, unsupported recovery IDs, high-S signatures, wrong wallet, wrong role, wrong chain/domain, wrong Safe, wrong terms hash, and wrong version.
- `deal-agreement-service.ts` loads current exact database terms through a service-role-only reader, recomputes the canonical terms hash, derives the signing role and wallet from the authenticated user plus verified profile, registers/reuses the immutable terms version, and verifies the signature again before persistence. Browser-supplied party IDs, wallet addresses, role, terms hash, or version are not accepted as authority.
- New isolated Edge Function `w3m-protocol-v1-deal-agreement` has two POST modes: `prepare` returns server-derived EIP-712 typed data; `accept` accepts only deal ID and signature, derives the actor from the bearer session, independently rebuilds and verifies the typed-data digest, then persists through a restricted RPC.
- Migration `20261107040000_w3m_protocol_v1_deal_agreement_acceptances.sql` creates append-only terms-version and party-acceptance ledgers, service-role-only RPCs, RLS, and a private signing snapshot reader. The RPC compares the submitted canonical terms JSON to freshly locked database deal/policy values before creating a version or acceptance. Exact duplicate submissions are idempotent; conflicting signatures for the same party/version are rejected. A changed canonical terms object creates a new version and prior signatures remain historical only.
- The Safe EXECUTE snapshot reader now exposes the latest terms version and both acceptance records. The strict TypeScript adapter independently recomputes the current terms hash and recovers both signatures against the current verified buyer/seller wallets before clearing the agreement blocker.
- Added deterministic cryptographic tests with test-only private keys, authenticated request-boundary tests, service tests, adapter tests, and disposable PostgreSQL tests for version reuse/rollover, exact duplicate idempotency, conflicting duplicate rejection, stale-term rejection, service-role-only RPC privileges, and snapshot exposure.

CI run `42167929874` completed successfully: **52/52 workflow steps passed**, including EIP-712 cryptographic tests, authenticated request-boundary tests, agreement service tests, strict Safe execution snapshot adapter tests, and the full agreement registry plus Safe snapshot-binding migrations and SQL contract tests against disposable PostgreSQL only. Earlier failing runs (`42167605390`, `42167733877`, `42167765218`, `42167777228`) exposed migration/adapter integration defects and were superseded by the clean migration rebuild and subsequent successful run. The latest successful run is [42167929874](https://github.com/Aminzaki1972/Web3Market/actions/runs/42167929874).

**Not yet complete:** the production Deal Room UI is not wired to request typed data or call the new isolated endpoint; no deployed function or production migration exists. The Safe EXECUTE snapshot now returns the latest immutable EIP-712 terms version and acceptance rows through the follow-on isolated migration `20261107050000_w3m_protocol_v1_safe_snapshot_agreement_binding.sql`; the adapter verifies both signatures against the currently verified buyer/seller wallets and the recomputed canonical terms hash. CI exercises this end-to-end in disposable PostgreSQL with deterministic test signatures. The new signing endpoint remains isolated and not deployed. No wallet has been asked to sign, no real signature has been submitted, and no Safe transaction or funds are involved. A separate browser-side coordinator `js/w3m-deal-agreement-client.js` has now been added on the isolated branch. It requests server-generated typed data, compares the connected wallet to the server-verified wallet before prompting, calls the injected wallet signer, then submits only the signature; it rejects domain substitution, malformed signatures, and acceptance responses whose deal/role/version differ from what was signed. It is not imported into `js/deal-room.js` and is not live-wired. Its new Deno regression suite is under CI run `42168398354` (pending at the time of this update).


## 26. Immutable agreement binding in Safe phase authorization — CI verified — 2026-11-06

The latest isolated changes close the agreement-data path from the database snapshot into the pre-execution authorization boundary:

- The strict Safe execution snapshot reader returns the current immutable terms-version record and the two party-acceptance rows. Its adapter recomputes the canonical terms hash and independently recovers both EIP-712 signatures against the currently verified buyer and seller wallets.
- `immutableAgreementBindingFromSnapshot(...)` extracts only the verified binding: terms-version ID and number, canonical terms hash, buyer/seller acceptance IDs, and their typed-data digests. It rejects missing/ambiguous rows, wrong party roles, mismatched deal/version/hash, duplicate acceptance IDs, and duplicate digests.
- The fresh Safe handler context carries that exact immutable binding forward from the strict snapshot. It is not accepted from browser input.
- The phase authorizer requires the verified buyer/seller agreement pair for SIGN and EXECUTE. Missing or malformed binding returns `W3M_IMMUTABLE_PARTY_AGREEMENT_REQUIRED`.
- The EXECUTE coordinator compares the complete agreement binding between its initial fresh authorization snapshot and the second fresh snapshot immediately before broadcast. A changed seller acceptance (or any other binding drift) blocks broadcast; missing binding blocks before an execution claim.
- Regression tests cover missing binding, distinct party acceptances, altered acceptance after claim, and the Safe transaction hash mismatch path with valid agreement fixtures.

CI run [42170223076](https://github.com/Aminzaki1972/Web3Market/actions/runs/42170223076) completed successfully: **53/53 workflow steps passed** on commit `8dc386f1650dfbba639e722d9797adc33fd10395`. This includes the full Deno suite and disposable PostgreSQL migration/contract checks. The earlier failed authorizer runs were superseded by this successful run.

**Boundary remains explicit:** this verifies the isolated W3M phase-authorizer and execution-coordinator components. It does not mean the existing deployed Safe Edge handlers have been wired to call them. The old handlers remain unchanged; the production Deal Room UI and production database/functions remain unmodified. No wallet signing, live BNB RPC request, Safe broadcast, deployment, or fund movement occurred.


## 27. Safe handler integration readiness matrix — 2026-11-06

This section distinguishes isolated authorization components from the still-unmodified Safe handlers. It is a wiring contract, not a claim of live integration.

| Existing handler | Required W3M boundary | Side effect that must remain behind the boundary | Current state |
| --- | --- | --- | --- |
| `prepare-deal-release` | Fresh PREPARE authorization before locking/upserting release policy | Policy lock and release preparation writes | Source reviewed; not wired |
| `prepare-safe-release-tx` | Fresh PREPARE authorization before transaction reuse/rebuild; validate the exact proposed MultiSend payload before storing it | Clearing old hash/signatures, deleting signer rows, storing a replacement Safe transaction, updating policy nonce | Payload validators exist; not wired |
| `record-safe-release-signature` | Fresh SIGN authorization bound to the exact current `safe_tx_hash`, plus current verified buyer/seller EIP-712 agreement pair | Signer-row upsert and transaction confirmation update | Phase authorizer and exact-hash boundary exist; not wired |
| `execute-safe-release` | Full EXECUTE coordinator: fresh report/evidence/signature checks, atomic attempt claim, fresh recheck, current Safe owner/threshold/nonce/hash and stored signature recovery, then one broadcast and hash persistence | `execTransaction` broadcast | Coordinator and adapters exist; not wired |
| `finalize-safe-release` | Dedicated raw BNB receipt verifier and atomic finalization endpoint | Confirm transaction, release policy, deal/project state and audit event | Isolated finalizer endpoint exists; old handler unchanged |

### PREPARE has a separate snapshot requirement

The strict Safe execution snapshot adapter intentionally requires exactly one already-signed release transaction, a valid stored Safe transaction hash, and matching transaction/policy nonce. That is correct for SIGN/EXECUTE authorization but is too strict to serve as the only data source before `prepare-safe-release-tx` creates or rebuilds the Safe transaction.

The exact Deal Room terms reader (`w3m_read_dealroom_terms_snapshot`) already supplies the locked deal/policy values and exact decimal strings needed for the pre-transaction gate. The remaining PREPARE-specific adapter must pair that snapshot with a read-only, canonical-block Safe configuration snapshot (chain, deployed code, owners, threshold, version and nonce) without requiring a pre-existing Safe transaction hash. It must also verify that the existing transaction row is the unique expected release row and is not submitted/confirmed before allowing any rebuild. The W3M gate must run before the old handler clears signatures or signer rows.

This distinction prevents an unsafe shortcut: the EXECUTE snapshot must not be weakened merely to make PREPARE fit. PREPARE and EXECUTE need separate strict snapshot contracts.

### Integration acceptance criteria

1. Each handler loads authoritative state server-side; no browser-supplied report status, wallet, Safe facts, nonce, amount, recipient or transaction hash is trusted.
2. The W3M gate runs before the first write or chain side effect in that handler.
3. The exact deal ID and, for SIGN/EXECUTE, exact Safe transaction hash are bound through the entire request.
4. PREPARE validates the final proposed MultiSend payload before storing it; SIGN validates the same stored payload and exact Safe hash; EXECUTE independently repeats both validations immediately before broadcast.
5. SIGN and EXECUTE require two distinct immutable EIP-712 acceptances over the same current canonical terms version/hash, recovered against currently verified buyer/seller wallets.
6. EXECUTE uses the idempotent attempt lifecycle and never automatically rebroadcasts after an uncertain result.
7. FINALIZE uses only independently verified BNB receipt/log evidence and one atomic database finalization RPC.
8. Any failed authorization, stale snapshot, mismatch, unavailable dependency, malformed acknowledgement or uncertain state fails closed.
9. Integration tests must run against isolated handler copies/adapters and disposable PostgreSQL. The existing deployed handlers and production environment remain untouched until a separately approved deployment plan exists.

**Current readiness:** the reusable SIGN/EXECUTE authorization and execution components are CI-verified, and the finalization endpoint is CI-verified. The PREPARE-specific pre-transaction snapshot is the next implementation item. None of the five existing deployed Safe handlers is currently wired to W3M.


### PREPARE follow-up: post-lock pre-transaction gate components — 2026-11-06

A first PREPARE-specific read path has now been added without weakening the strict EXECUTE snapshot:

- `w3m_read_dealroom_terms_snapshot` now exposes exact buyer/seller wallet addresses, wallet verification flags/timestamps, project owner/status, deal terms and locked policy values.
- `safe-live-configuration-facts.ts` validates BNB chain 56, deployed Safe code, exact three-owner set, threshold 2, Safe version 1.4.1 and expected nonce without requiring a Safe transaction hash.
- `bnb-safe-configuration-facts-reader.ts` pins all Safe reads to one BNB block and rechecks its hash to reject a reorg during the read.
- `fresh-safe-prepare-context.ts` composes the exact Deal Room row with the canonical Safe configuration and W3M PREPARE gate. It checks project owner equals seller, both party wallets are verified and distinct, verification timestamps are not in the future, seller wallet matches the locked policy, and platform wallet matches the configured platform wallet.
- The Deal Room row evaluator was split so the gate consumes the same exact database row used to derive the Safe facts; it does not silently reread a different row after the chain snapshot.

**Important placement limitation:** this new context requires the release policy and pending release transaction row created by the earlier `prepare-deal-release` handler. It is designed to gate `prepare-safe-release-tx` before transaction rebuild/clearing old signatures/storing a new Safe hash. It does **not yet** gate the initial policy lock and pending-row writes inside `prepare-deal-release`. That pre-lock gate still needs a separate exact snapshot plus the server-computed, read-only release-policy validation result; it must not trust browser-supplied fee or wallet values.

The pre-lock boundary's focused denial-path test and full isolated CI suite passed in run [42173333599](https://github.com/Aminzaki1972/Web3Market/actions/runs/42173333599), 59/59 steps. This run includes the USDT denomination and canonical 32-byte BNB payment-hash regression tests. Canonical BNB block-quantity checks also passed in [42173043965](https://github.com/Aminzaki1972/Web3Market/actions/runs/42173043965), 59/59 steps. A final defensive refinement now binds the commit boundary to the exact requested deal ID and an empty PREPARE issue list; run [42173508958](https://github.com/Aminzaki1972/Web3Market/actions/runs/42173508958) completed successfully: **58/58 steps passed**. No deployed Safe handler is wired, and no production migration or function has been deployed.


## 28. Pre-lock PREPARE gate — implementation and initial CI verification — 2026-11-06

The separate pre-lock path has now been implemented, rather than relying on the post-lock Safe transaction snapshot:

- New service-role-only RPC `w3m_read_validated_release_policy(uuid)` wraps the existing `validate_deal_release_policy` database validator and returns `valid`, deal amount, fee percent, fee amount and seller net as exact text. It performs no policy or transaction writes. A disposable PostgreSQL fixture verifies numeric JSONB values retain all decimal digits through `->>`.
- `authorizePrelockSafePrepare(...)` reads one exact Deal Room snapshot and one validated policy result. It derives buyer/seller identities and verified wallets from the database, verifies project ownership, requires verified distinct party wallets with non-future verification timestamps, checks the BNB Safe configuration at one canonical block, captures the current Safe nonce, and runs the persisted W3M PREPARE report/evidence gate using the server-derived policy values.
- The pre-lock helper returns the exact `dealTermsHash` and `safeNonce` only when authorization succeeds. The caller must persist that exact nonce into the locked policy; it must not substitute a separately read or browser-supplied nonce.
- The helper is read-only. It is designed to be called after the existing server-side policy validator and before the `deal_release_policies` upsert, pending `deal_multisig_transactions` insert/update, or audit write in `prepare-deal-release`.
- The separate post-lock PREPARE context remains responsible for revalidating the stored policy nonce and current Safe configuration before `prepare-safe-release-tx` rebuilds/stores calldata. This preserves a second check if the Safe nonce changes after the policy lock.
- The workflow includes the new pre-lock gate tests and disposable SQL reader contract test. Run [42171604906](https://github.com/Aminzaki1972/Web3Market/actions/runs/42171604906) completed successfully: **56/56 steps passed**, including Deno checks/tests and disposable PostgreSQL migrations/contracts.

A follow-up hardening now also binds the pre-lock gate to releasable deal statuses (`funded` or `in_progress`), BNB chain ID 56, and the approved BNB USDT token contract. Those newest status/token refinements are in the current isolated CI queue and are not claimed passed until their run completes.

**Still not wired:** the existing deployed `prepare-deal-release` and `prepare-safe-release-tx` handlers have not been changed. The pre-lock and post-lock helpers are ready for an isolated handler integration step, but production remains untouched.


### PREPARE boundary separation and latest CI result — 2026-11-06

To prevent accidental use of the EXECUTE snapshot for PREPARE, the generic `authorizeSafeHandlerPhase(...)` now explicitly refuses `PREPARE` with `W3M_PREPARE_REQUIRES_PREPARE_SNAPSHOT_PATH`. Its underlying Safe execution snapshot requires an already-signed transaction and therefore is reserved for SIGN/EXECUTE. PREPARE must use the dedicated pre-lock or post-lock reader paths above.

The exact Deal Room reader also now blocks deal statuses outside `funded`/`in_progress` and any token other than the approved BNB USDT contract. Regression tests cover the generic PREPARE refusal, releasable status, BNB chain and token binding.

CI run [42172206694](https://github.com/Aminzaki1972/Web3Market/actions/runs/42172206694) completed successfully: **57/57 steps passed**. The final follow-up run [42172312612](https://github.com/Aminzaki1972/Web3Market/actions/runs/42172312612) also completed successfully: **57/57 steps passed**, including the final token-mismatch regression, full Deno suite and disposable PostgreSQL checks.

No old Safe handler is wired or changed. The dedicated PREPARE paths are still isolated integration components; deployment remains out of scope.


## 29. PREPARE write boundary wrapper — isolated implementation — 2026-11-06

Added `prelock-safe-prepare-boundary.ts` as the mandatory composition point for the pre-lock stage:

- It invokes the fresh pre-lock gate first.
- It refuses to invoke the caller's policy/pending-transaction write callback unless the gate returns `authorized=true`, a 32-byte terms hash, a canonical decimal Safe nonce, and a canonical BNB block number/hash.
- On denial or malformed authorization output, it returns the exact gate denial and performs no callback/write.
- The callback receives only the server-derived deal ID, terms hash, Safe nonce and canonical block binding; no browser-provided terms, nonce, or authorization booleans are accepted.
- A focused test asserts that a database/snapshot failure produces a denial and the write callback count remains zero.

CI run [42172312612](https://github.com/Aminzaki1972/Web3Market/actions/runs/42172312612) completed successfully after the latest token/status refinements. The new boundary wrapper and its test are in the current isolated CI queue (latest relevant runs: [42172893422](https://github.com/Aminzaki1972/Web3Market/actions/runs/42172893422), [42172888436](https://github.com/Aminzaki1972/Web3Market/actions/runs/42172888436)); their outcome is not yet known.

**Important:** this wrapper is not yet called by the legacy `prepare-deal-release` handler. It establishes and tests the safe side-effect boundary, but does not itself protect the live endpoint until a separately reviewed handler integration uses it. No deployed function, production database, wallet, Safe, or funds were changed.


## 30. Read-only production PREPARE handler and schema review — 2026-11-06

The production Supabase project was inspected read-only. No database SQL was executed and no Edge Function was deployed or changed.

**Captured live function identities**
- `prepare-deal-release`: version 43, source SHA-256 `6c670d08fbb55fdc61a10c39b5f32062d311934228df59ce23096d337ba52e18`.
- `prepare-safe-release-tx`: version 37, source SHA-256 `f4248dde096a3532befca8dbd894cdb3bb6511bdf2d6a70c8e253b9587b01dfe`.

**Verified production table shapes**
- `deals`: UUID identity/parties/project; numeric amount; currency; status; chain/Safe/token; payment status and tx hash; delivery status and buyer acceptance timestamp; dispute status; release tx hash.
- `deal_release_policies`: numeric deal/fee/seller amounts; seller/platform wallets; Safe/token/chain; status; Safe nonce; lock/release timestamps.
- `deal_multisig_transactions`: amount/token/chain/Safe; transaction hash/data/operation/gas/nonce; signature JSON; confirmation count and status.
- `deal_multisig_signers`: signer role/user/wallet, Safe transaction hash, signature and signature status.
- `deal_audit_logs`: deal, actor, action, old/new status, JSON metadata and timestamp.
- `deal_disputes`: deal and dispute status. All inspected tables have RLS enabled.

**Exact insertion points and existing risks**
1. In `prepare-deal-release`, after authentication/participant/deal reads and before the existing release-transaction fast path, run the W3M pre-lock gate. The current function checks payment hash only for non-empty text, then validates the fee policy, then may return `already_prepared` or write the policy, pending multisig row, and audit log separately.
2. The three writes at the end of `prepare-deal-release` are separate PostgREST operations. If a later write fails, an earlier policy/transaction write can remain. The final integration must replace them with one atomic server-side commit operation; do not wrap the current three REST calls in the generic callback and call that atomic.
3. In `prepare-safe-release-tx`, run the post-lock W3M PREPARE context before the existing `already_prepared` fast path and before any mutation. The current fast path accepts structurally parseable MultiSend calldata based on destination/operation/length; it does not independently prove the exact two inner USDT transfers before returning.
4. The current rebuild path clears the old Safe hash/signatures and deletes signer rows before the full replacement transaction is rebuilt and validated. The W3M gate and semantic payload validator must run before this destructive reset; the reset and replacement write should be atomic or use a recoverable attempt record.
5. Both live handlers currently use nonempty payment-hash checks; the isolated W3M path now requires a canonical 32-byte transaction hash and USDT denomination.

**Next implementation dependency:** the exact live schema is now known, but an atomic SQL persistence RPC has not yet been authored or tested. The Supabase CLI is not available in the current execution environment, so no migration filename or SQL deployment is being guessed. This remains isolated until a proper migration-generation/test path is available.

This source/schema review makes the next integration target precise, but **does not mean W3M is protecting live Deal Room operations**. The live handlers remain unchanged.


## 31. Remaining four live Safe handler versions — read-only review — 2026-11-06

Additional production Edge Function reads were completed without changing any function:

| Live handler | Version | SHA-256 |
|---|---:|---|
| `create-safe` | 56 | `d888f48d48c87563e20e43318f9187c0f02d9a46fbe5e037cadbb5520b918e07` |
| `record-safe-release-signature` | 24 | `fb4fedf2c17245b52d2920d3ac13c426b02a49d176dc96e75237c599840d5d01` |
| `execute-safe-release` | 28 | `e51aa4f2dffe259292a627b0ab1c3663c5f2ef46b7792cd96c156c452eb65d22` |
| `finalize-safe-release` | 25 | `4f39f60122f79198fd8b2051cefd172d600f1c1d3a5d48310b40620957efd5ce` |

**Source-derived integration findings**
- `create-safe` authenticates and authorizes deal participants/admin, deploys a 2-of-3 Safe and writes deal Safe fields plus a pending release policy in separate database operations. It is a setup stage, not the settlement PREPARE gate.
- `record-safe-release-signature` recomputes the Safe EIP-712 typed-data digest and verifies the recovered signer against the verified wallet and current Safe owners. W3M's immutable buyer/seller EIP-712 deal agreement must be checked before this legacy SIGN path records a signature.
- `execute-safe-release` checks two stored signers are current Safe owners and recomputes the Safe transaction hash, but it does not independently recover each stored ECDSA signature from the exact Safe digest at execution time. It then broadcasts through the configured executor and updates the multisig row separately.
- `finalize-safe-release` already checks the mined receipt, successful receipt status, exact Safe `ExecutionSuccess` event for the stored Safe transaction hash, and exact Safe-to-seller plus Safe-to-platform USDT transfer amounts. However, it updates the multisig row, release policy, deal, project and audit log as separate writes; the audit insert result is not checked.
- The isolated W3M EXECUTE path therefore retains its stricter per-signature recovery, agreement binding, fresh pre-broadcast authorization and atomic attempt claim. The isolated W3M FINALIZE endpoint retains its receipt verifier and atomic finalizer. These must replace/guard the corresponding legacy paths before any production protection can be claimed.

This completes the read-only source inventory of all six live Safe handlers. The integration work remaining is now bounded to connecting the isolated PREPARE/SIGN/EXECUTE/FINALIZE gates to those exact handler entry points and introducing the required atomic database persistence operations. No live function or database object was changed.


### Additional read-only database constraints and validator findings

- `deal_release_policies.deal_id` has a unique index, so policy upsert by `deal_id` is supported.
- `deal_multisig_transactions` has **no unique index on (deal_id, action)**. It has a non-unique deal index and a partial unique index on non-null `safe_tx_hash`. An atomic commit RPC must lock the parent deal and explicitly select/update-or-insert the release row; it must not assume `ON CONFLICT (deal_id, action)` exists.
- `deal_multisig_signers` has unique `(deal_id, signer_role)` and partial unique `(deal_id, wallet_address, safe_tx_hash)` indexes.
- The live `validate_deal_release_policy(uuid)` function is SECURITY DEFINER and currently checks payment status/hash presence, delivery acceptance, BNB chain/Safe/token configuration, and locked-policy consistency. It calculates the platform fee with PostgreSQL `round(amount * 7.5 / 100, 8)`.
- W3M's canonical terms hasher independently computes fee rounding at 8 and 18 decimal places and blocks the deal unless both results match the persisted fee. This is intentionally stricter than simply accepting a fee rounded at 8 decimals; it prevents a precision mismatch from being signed or settled.
- The legacy validator allows dispute status `none` or `resolved`, while the isolated W3M adapter currently requires exact `none`. This is deliberately fail-closed pending a precise policy for `resolved_buyer` versus `resolved_seller`; no resolved dispute is silently treated as clear.

These details are based on read-only schema/index/function-definition queries. They are recorded to prevent an incorrect future atomic RPC or an assumed uniqueness constraint.


## 31. Read-only live CREATE / SIGN / FINALIZE review — 2026-11-06

Additional live Edge Functions were fetched directly from the production Supabase project for source review only. No function was updated or deployed.

**Exact live identities**
- `create-safe`: version 56; SHA-256 `d888f48d48c87563e20e43318f9187c0f02d9a46fbe5e037cadbb5520b918e07`.
- `record-safe-release-signature`: version 24; SHA-256 `fb4fedf2c17245b52d2920d3ac13c426b02a49d176dc96e75237c599840d5d01`.
- `finalize-safe-release`: version 25; SHA-256 `4f39f60122f79198fd8b2051cefd172d600f1c1d3a5d48310b40620957efd5ce`.

**CREATE**
- Authenticates the caller and checks deal participation/admin role, accepted deal status, BNB chain 56, verified buyer/seller wallets, distinct Safe owners, and a separate deployer.
- Deploys/attaches to a 2-of-3 Safe and verifies owners/threshold on-chain.
- After deployment, updates `deals` and upserts `deal_release_policies` as separate database operations.
- No W3M report/evidence/agreement gate is called before deployment. The final integration must decide whether CREATE is an allowed preparatory action before W3M PASS, or whether policy creation and any release preparation must remain gated. The latter must never be confused with authorization to release funds.

**SIGN**
- Existing handler does cryptographically recover the EIP-712 SafeTx signature and checks it against the verified profile wallet, current Safe owners, threshold, nonce, and stored Safe transaction hash.
- It upserts the signer's row, then separately reads all signatures and updates the multisig transaction's signatures/count/status. These writes are not one atomic operation.
- It does not yet require the W3M immutable deal-agreement binding before accepting a Safe signature. The isolated authorizer already requires the exact buyer/seller EIP-712 deal agreement for SIGN and EXECUTE, but that authorizer is not wired to this live handler.

**FINALIZE**
- Existing handler verifies a mined successful BNB receipt, configured Safe destination, recomputed Safe transaction hash, Safe ExecutionSuccess event, and exact Safe→seller and Safe→platform USDT transfer amounts.
- It then updates the multisig transaction, release policy, deal, project sold status, and audit log as separate writes. The audit insert result is ignored. A later failure can therefore leave partially finalized database state.
- The isolated W3M finalizer already uses a separate receipt-verification path and atomic finalization RPC. It is not deployed and is not connected to this live handler.

**Current implementation sequence**
1. Preserve CREATE as a Safe custody setup action, but do not let it imply release authorization; bind its policy creation to verified immutable deal terms and atomic persistence.
2. Wire the exact immutable agreement and W3M report gate into SIGN before any signature row is persisted.
3. Wire the fresh pre-broadcast W3M authorization into EXECUTE and keep the existing Safe hash/signature/nonce checks.
4. Replace FINALIZE's multi-write sequence with the isolated receipt-proof + atomic finalization path.
5. Convert PREPARE's policy/transaction/audit writes into one database RPC, then wire the pre-lock boundary before the existing fast path and before any mutation.

No live function was modified. The six previously captured source snapshots remain historical snapshots; these version/hash identities above are the latest read-only production fetches from this review.


## 32. Atomic PREPARE persistence schema findings — 2026-11-06

A second read-only catalog inspection checked the actual production constraints and indexes.

- `deal_release_policies.deal_id` has a unique constraint; an atomic policy upsert can target this key.
- `deal_multisig_signers` has unique `(deal_id, signer_role)` and a partial unique `(deal_id, wallet_address, safe_tx_hash)`.
- `deal_multisig_transactions` has **no unique constraint on (deal_id, action)**. It has a unique partial index on `safe_tx_hash`, and a non-unique deal index. Therefore an RPC must not assume `ON CONFLICT (deal_id, action)` is available. It must lock the parent deal row (or use a per-deal/action advisory transaction lock), select the exact release row, and apply a deterministic insert/update policy under that lock.
- The live constraints require action in `deposit | release_to_seller | refund_to_buyer`, status in `awaiting_signatures | signed | submitted | confirmed | cancelled`, and exactly two required signatures. Release policy enforces the platform wallet, fee math rounded to 18 decimals, valid fee range, and permitted policy status.
- Existing Safe transaction signer and release records are distinct tables and must not be conflated.

**Atomic PREPARE RPC design gate:** the function must lock the deal row; verify the deal is still eligible and bound to the exact W3M-authorized deal/terms; validate the policy math and BNB/USDT/Safe bindings; update or insert exactly one intended `release_to_seller` transaction without overwriting a submitted/confirmed/cancelled record; and write the audit row in the same PostgreSQL transaction. Any failed condition must raise and roll back all writes. The service-role-only grant must be explicit, with execute revoked from PUBLIC, anon, and authenticated.

This is a schema discovery and design constraint only. No production DDL, data changes, or migrations were executed. The isolated atomic RPC is not yet authored; it will be added only with a disposable PostgreSQL test covering concurrency, rollback, existing transaction state, and exact field validation.


## 33. PREPARE write-path and trigger semantics — read-only production source review — 2026-11-06

The complete live `prepare-deal-release` v43 source was fetched again and compared with the exact production table definitions and trigger/function catalog. This is still read-only.

**Exact legacy PREPARE behavior**
- It authenticates a deal participant, checks the dispute table, accepts deal status `funded` or `in_progress`, requires confirmed payment and a non-empty payment hash, BNB chain 56, configured Safe/token, verified distinct buyer/seller wallets, and an on-chain 2-of-3 Safe owner/threshold/nonce snapshot.
- It calls `validate_deal_release_policy`, then looks up the `release_to_seller` transaction using `maybeSingle()`. Since the database has no uniqueness constraint on `(deal_id, action)`, duplicate legacy rows can make this lookup fail rather than being silently resolved.
- The existing-transaction fast path returns without writes if a Safe hash, transaction hash, or signed/submitted/confirmed status exists.
- Otherwise it performs three separate REST writes: policy upsert to `locked`, release multisig transaction insert/update, then `deal_audit_logs` insert. Each failure can occur after earlier writes have committed.

**Additional database trigger constraints**
- `deal_release_policies` has a BEFORE UPDATE immutability trigger. Once status is `locked`, `ready`, or `released`, deal amount, fee values, seller/platform wallets, Safe, token, chain, and Safe nonce cannot change. A retry that observes a different on-chain Safe nonce cannot simply overwrite the locked policy; it must fail closed and require an explicit recovery path.
- `deals` has BEFORE UPDATE fee-lock, state-transition, and sensitive-field protection triggers, plus fee synchronization/consistency triggers. The PREPARE atomic RPC should avoid changing the parent deal row beyond using `SELECT ... FOR UPDATE` as its concurrency lock.
- `deal_multisig_transactions` has an AFTER INSERT/UPDATE/DELETE audit trigger which writes to `admin_audit_log` when relevant transaction lifecycle fields change. This trigger side effect participates in the same PostgreSQL transaction as the multisig row write.
- `deals` lifecycle audit triggers also write to `admin_audit_log` for selected lifecycle changes. `deal_release_policies` has no trigger in the inspected catalog other than its immutability guard.
- The existing validator `validate_deal_release_policy(uuid)` returns JSONB. It checks payment confirmation/hash presence, accepted delivery and buyer approval, chain/Safe/token configuration, dispute status, and locked-policy consistency. Its fee computation is rounded to 8 decimals, while the release-policy table constraint requires fee amount rounded to 18 decimals. W3M's stricter canonical fee agreement must remain authoritative; a `valid=true` response from this legacy function is not by itself sufficient.

**Atomic RPC requirements refined**
1. Lock the parent deal row with `FOR UPDATE`, then re-read the relevant deal and release-policy values under that lock. Do not update the deal row merely to obtain a lock, because its triggers have unrelated business/audit effects.
2. Reject duplicate `release_to_seller` rows explicitly; do not use `maybeSingle()` semantics as a substitute for a uniqueness guarantee.
3. Preserve the legacy fast-path invariant: never rewrite rows with a Safe transaction hash, transaction hash, or status `signed`, `submitted`, or `confirmed`; preserve `cancelled` as terminal too. A locked policy with changed nonce or changed immutable binding must be rejected, not silently replaced.
4. Insert/update the release policy, exactly one release transaction, and explicit `deal_audit_logs` entry in one transaction. Any trigger or constraint failure must roll back all three writes and the multisig audit-trigger side effect.
5. Keep RPC execution restricted to `service_role`; validate actor is one of the deal participants and bind every supplied field to the exact W3M-authorized snapshot rather than trusting arbitrary client JSON.
6. Do not treat the legacy 8-decimal validator as the W3M canonical fee proof. Validate exact decimal text, 18-decimal policy constraint, BNB chain 56, the configured USDT denomination/token address, Safe address, verified party wallets, payment hash, and current Safe nonce/block facts before persistence.

**Important correction to earlier design notes:** the release-policy immutability trigger makes a naive `upsert(... onConflict: deal_id)` unsafe for a locked policy if the nonce or any immutable routing/financial field changes. The atomic RPC must explicitly distinguish an idempotent identical retry from a changed binding that requires a hard denial. No SQL migration has been authored or deployed yet; no production object or data was changed.


## 34. Atomic PREPARE RPC draft — isolated implementation — 2026-11-06

Added `supabase/migrations/20261107070000_w3m_protocol_v1_atomic_safe_prepare.sql` and a disposable PostgreSQL test script `supabase/tests/w3m-protocol-v1-atomic-safe-prepare.test.sql`. The isolated workflow now includes the migration and test.

The RPC is service-role-only and serializes per-deal PREPARE using `SELECT ... FOR UPDATE` on the parent deal row, without updating that row. It rebinds the actor to a buyer/seller participant, payment and delivery state, dispute state, BNB chain 56, USDT denomination, Safe/token addresses, verified profile wallets, the 2-of-3 Safe owner set, canonical Safe nonce/block facts, exact 18-decimal fee arithmetic, and a current deal-bound W3M PASS authorization envelope.

Within one PostgreSQL transaction it inserts/updates the release policy, exactly one `release_to_seller` transaction, and the explicit deal audit row. Any database/trigger failure aborts the transaction. It rejects duplicate release rows, preserves signed/submitted/confirmed/cancelled transaction rows, allows only an identical locked-policy retry, and rejects changed nonce or financial/routing binding after lock. It does not assume a nonexistent unique `(deal_id, action)` constraint.

The new SQL test covers first commit, exact idempotent replay, signed-row preservation, changed-nonce denial, service-role-only grants, and forced audit-write failure with rollback assertions. The workflow runs it only against its disposable PostgreSQL service.

**Important precision finding:** production `validate_deal_release_policy(uuid)` computes the fee rounded to 8 decimals and can reject an otherwise valid locked policy whose canonical fee uses 18 decimals. The atomic W3M RPC therefore does not call that legacy validator; it independently rechecks the underlying payment, delivery, buyer-approval, dispute, chain, Safe, token, party-wallet and exact fee conditions. This avoids allowing the old 8-decimal fee calculation to veto or redefine the W3M 18-decimal agreement.

**Status:** migration and SQL test are committed to the isolated branch, but this turn has not yet established a successful CI run for the new files. The RPC is not wired into the live `prepare-deal-release` or `prepare-safe-release-tx` handlers, has not been deployed, and does not protect production transactions yet.


**Implementation refinements after the first draft**
- The exact production validator source was inspected. It uses `round(amount * 7.5 / 100, 8)`, so calling it from the atomic RPC would break the intended 18-decimal policy on some amounts and could also reject an idempotent retry. The RPC now performs its own database-state checks and deliberately does not call that legacy fee validator.
- The persisted deal amount and `deals.platform_fee_percent` are now both required to equal the authorized exact policy values; BNB chain comparison is null-safe.
- The SQL test fixture's deal identifiers were corrected to use explicit PL/pgSQL variable names.
- Latest code refinement commit: `53c7faf765d70023f4205f340b9ea5380574f480`. The newest test commit is `66046f42e9cab503bac04a389636807f3f1d059a`. No successful CI result has been verified for these new SQL files yet.
