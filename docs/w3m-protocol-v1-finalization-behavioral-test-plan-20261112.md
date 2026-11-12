# W3M Protocol V1 — finalization behavioral test plan

**Status:** implementation plan only; this document is not an executable test and does not establish that finalization is behaviorally verified.

**Scope and isolation**
- Target only `w3m-protocol-v1-isolated-20261105` through the open Draft PR #190.
- Execute only in the disposable PostgreSQL service used by the isolated GitHub Actions workflow.
- Never apply these fixtures or migrations to the production Supabase project.
- No live BNB RPC, Safe transaction, wallet signature, or token transfer is part of these database tests. Receipt facts are deterministic test inputs and must be described as simulated.
- Keep PR #190 Draft and unmerged until the behavioral suite and its CI run pass.

## 1. Fixture contract

Create a reusable SQL fixture helper that creates a completely independent deal graph for each test case. Use deterministic UUIDs in a reserved test range and roll the whole test transaction back.

Required graph, in dependency order:

1. Buyer and seller profiles with distinct verified BNB wallet addresses; project owned by the seller.
2. Funded deal with matching buyer/seller/project IDs, BNB Chain ID 56, BNB USDT token contract, confirmed payment marker, accepted delivery, no dispute, and the exact 7.5% platform fee.
3. A completed Code Audit row and its file/finding rows using the repository's actual Code Audit schema. Do not infer column names from the W3M migrations; inspect the canonical migration/schema first.
4. One immutable `w3m_deal_code_audit_snapshots` row matching the deal, project, repository, commit SHA, and manifest digest. The referenced Code Audit must satisfy `w3m_current_deal_code_audit_json`.
5. Locked `deal_release_policies` row with exact 7.5% fee arithmetic, seller net, platform fee, Safe, token, chain, wallets, and Safe nonce.
6. One signed `deal_multisig_transactions` release row matching the policy and Safe transaction hash.
7. One active trusted signer key and its ACTIVATED event.
8. One immutable terms version whose `canonical_terms` is obtained from `w3m_current_deal_terms_json(deal_id)`; do not hand-author a divergent terms object. Use a deterministic valid 64-hex test terms hash.
9. Exactly two acceptance rows (buyer and seller) bound to the same terms version/hash, with format-valid test digest/signature values. These are database fixtures, not cryptographically valid wallet signatures.
10. One signed PASS `w3m_acquisition_reports` row. Its payload must bind the deal, project, parties, report version, terms hash, selected audit ID, commit SHA, and exact evidence count. Use a format-valid test signature and report/evidence hashes; do not call them cryptographically verified.
11. The full evidence set referenced by `report_payload.evidenceCount`, including exactly one mandatory CODE_AUDIT row matching the snapshot and manifest details, plus the mandatory evidence required by the finalizer.
12. One `w3m_safe_execution_attempts` row in BROADCAST state with the exact report/version, transaction, Safe hash, recorded broadcast hash, participant package actor, and complete package timestamps/hash/payload. Let the attempt trigger populate the immutable report/evidence/signer/terms pins.

The fixture must fail loudly if any required schema/table/column is missing. It must not create shadow tables or simplified stand-ins for production W3M tables.

## 2. Receipt fixture

Build a helper that returns the complete deterministic JSON accepted by `w3m_finalize_safe_execution_attempt`:
- `chain_id=56`, matching outer transaction hash, `receipt_status=1`, `execution_success=true`, `execution_failure=false`, and a block timestamp inside the issued package window.
- Exact Safe address, Safe transaction hash, and BNB USDT token contract.
- Exactly two transfer entries: Safe to seller for seller net, and Safe to platform for the 7.5% fee.
- Acquisition attestation matching the pinned report ID/version/hash, evidence hash, signer key ID, terms version ID/version/hash, and recomputed evidence hash.

These are simulated database inputs only. The test must never query a live chain or claim that a transfer occurred.

## 3. Required behavioral cases

Run each rejection case against a fresh fixture and assert both the expected SQLSTATE/error and unchanged persisted state:

| Case | Mutation / invalid input | Expected result |
|---|---|---|
| Receipt binding | Wrong chain, transaction hash, receipt status, Safe address, Safe tx hash, or token contract | Reject; no settlement writes |
| Transfer integrity | Missing/extra transfer, wrong seller recipient/amount, wrong platform recipient/fee, duplicate destination | Reject; no settlement writes |
| Project ownership | Change project owner away from seller after attempt pinning | Reject; deal, project, policy, transaction, attempt unchanged |
| Dispute | Set deal dispute status active/null or insert an unresolved dispute after pinning | Reject; no settlement writes |
| Report freshness | Append a newer report version or expire/misbind the pinned report | Reject; no settlement writes |
| Evidence freshness | Mark mandatory evidence non-PASS/expired or alter evidence count/hash | Reject; no settlement writes |
| Signer revocation | Revoke the pinned signer after attempt pinning | Reject; no settlement writes |
| Terms integrity | Alter current policy/terms binding or remove one acceptance in a controlled test fixture | Reject; no settlement writes |
| Acquisition attestation | Alter each pinned report/evidence/signer/terms field independently | Reject; no settlement writes |
| Package window | Receipt timestamp before issue or after expiry | Reject; no settlement writes |
| Actor binding | Non-party actor or non-party package actor | Reject; no settlement writes |
| Transaction binding | Wrong Safe transaction hash/status/recipient/policy binding | Reject; no settlement writes |

Successful path:
1. Call the actual `w3m_finalize_safe_execution_attempt` with a complete matching fixture.
2. Assert exactly one confirmed Safe transaction, released policy, completed deal, sold project, CONFIRMED attempt, and one `safe_release_confirmed` audit row.
3. Replay with the same transaction hash; assert `idempotent_replay=true` and no duplicate audit/state rows.
4. Replay with a different transaction hash; assert rejection and no changes.
5. Inject a test-only failure at the audit-log insert inside a transaction; assert all preceding settlement updates roll back.

Concurrency path (separate PostgreSQL sessions, not sequential calls):
- Race finalization against signer revocation.
- Race finalization against dispute creation/status mutation.
- Race finalization against project ownership change and report/evidence append.
- Assert the documented lock ordering serializes each race into one safe outcome, with no partial settlement and no state that accepts both conflicting operations.

## 4. CI integration and acceptance criteria

- Use the existing `supabase/tests/w3m-safe-execution-attempts.test.sql` as the primary SQL behavioral suite and extend its real seeded fixture. Keep `w3m-protocol-v1-finalization-acquisition-revalidation.test.sql` as a separate source-definition/structural contract test.
- Ensure the workflow applies the complete ordered isolated migrations to a disposable PostgreSQL instance before running the behavioral suite.
- Keep the existing source-definition test as a separate migration/contract guard.
- Add a test result summary that distinguishes SQL behavioral cases, TypeScript adapter tests, and workflow steps.
- Require two clean disposable database runs (normal migration apply and timestamp-sorted replay) before the PR can be considered ready.
- Preserve failing logs and report exact test names/counts; never describe workflow steps as test counts.

## 5. Current known gap

`supabase/tests/w3m-protocol-v1-finalization-acquisition-revalidation.test.sql` checks columns, trigger presence, privileges, and function-definition text; it remains a structural contract test.

A separate, more complete fixture already exists in `supabase/tests/w3m-safe-execution-attempts.test.sql`. It seeds the project, parties, deal, Code Audit snapshot, terms, both acceptances, signed report, evidence, Safe transaction, attempt, wallet package, and then calls the actual finalization RPC. Before the latest expansion it covered malformed receipt fields, seller-recipient substitution, package time bounds, an open dispute, successful finalization, exactly-once state assertions, same-hash idempotent replay, and changed-hash rejection.

Commit `3cf653c6f7a7f742f710ab86ae4b07c4b9520523` expands that behavioral test with signer revocation (inside a rollback savepoint), project-ownership drift, pinned-terms hash drift, wrong platform recipient/fee, post-pin evidence append rejection, and explicit no-partial-settlement assertions. These additions are **pending CI validation** until the workflow for that exact commit completes successfully.

Still outstanding after this expansion: stale/superseded report behavior at finalization, an explicit finalization-time expired-evidence case, injected failure during the finalizer audit-log write proving all four settlement updates roll back, and separate-session concurrency races. The canonical Code Audit and Deal Room schemas are documented in the repository's read-only schema reviews and must remain the authority for fixture inserts; no shadow tables or guessed schema are acceptable.
