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

The isolated repository does not contain authoritative DDL for `deals`, `deal_release_policies`, `deal_multisig_transactions`, or `deal_multisig_signers`, nor the definition of `validate_deal_release_policy`. A scan of the tracked SQL migrations found references/triggers for multisig transactions but no table creation or complete schema definition for these release tables.

The source-derived field map is not enough to safely author transactional SQL. Still unknown: column types/nullability/defaults, unique constraints, foreign keys, RLS, triggers, RPC behavior, transaction-row cardinality, and status transition rules.

**Therefore blocked:** an execution-claim RPC, atomic finalization RPC, and any Edge Function adapter that writes release state. Do not infer schema from PostgREST field names and do not query production rows to fill the gap.

## 5. Next safe engineering step

Obtain a read-only authoritative schema artifact (DDL/migration export) for the release tables, relevant indexes/constraints/triggers/RLS, and the exact `validate_deal_release_policy` function definition. Review it offline, then design isolated SQL for:
- atomic report-to-deal binding and version checks;
- one active execution attempt per exact deal + Safe transaction hash;
- persisted broadcast hash and retry reconciliation;
- one atomic finalization transition with receipt identity and audit event.

Only after the isolated SQL and adapter pass CI should a separate integration proposal be prepared. Production deployment remains a distinct approval step.

## 6. Safety record

- No production Edge Function edited, deployed or invoked.
- No production DB schema or row changed.
- No Safe, wallet, key, balance or transaction touched.
- No merge to `main`.
- All implementation remains on the isolated branch.
