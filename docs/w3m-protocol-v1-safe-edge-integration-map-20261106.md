# W3M Protocol V1 — Safe Edge Function Integration Map

**Captured:** 2026-11-06  
**Branch:** `w3m-protocol-v1-isolated-20261105`  
**Scope:** Source-derived integration plan only. No deployed function was changed or invoked.

## 1. Verified isolated CI result

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
