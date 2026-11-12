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

Commit `3cf653c6f7a7f742f710ab86ae4b07c4b9520523` expands that behavioral test with signer revocation (inside a rollback savepoint), project-ownership drift, pinned-terms hash drift, wrong platform recipient/fee, post-pin evidence append rejection, and explicit no-partial-settlement assertions. Commit `aeddc6740f2d76d6b74c12f3388b9d70e556bb89` adds a newer version-2 BLOCKED report in a rollback savepoint and verifies that the finalizer rejects the previously pinned version-1 report as superseded. Commit `f7ee1f179c040a3fec5887473a492ce55465803d` adds a test-only trigger that fails the finalizer's final audit-log insert and asserts the transaction, policy, deal, project, and attempt all remain unchanged. The first CI attempt for that test (run 973, commit `f7ee1f179c040a3fec5887473a492ce55465803d`) failed because the injected-failure assertion ran after the fixture had already finalized; the test ordering was corrected in a later commit. Commit `b90310ad6d97421610e5ccb4a00e133bf82b91e2` adds an expired mandatory-evidence case by applying a temporary test-only mutation inside a rollback savepoint, then asserts the append-only row is restored. **Latest validation:** CI run 975 passed the behavioral suite and disposable PostgreSQL migration checks at commit `b90310ad6d97421610e5ccb4a00e133bf82b91e2`; CI run 976 passed the documentation-only follow-up at commit `44e20b5f712a24af79458b33f361910ada03ab72`. This confirms the latest test additions in those commits, not the separate-session concurrency matrix below.

### Concurrency implementation already present; behavioral proof still outstanding

The isolated SQL migrations already implement several serialization controls that the concurrency suite must exercise rather than replace:

- Finalization, acquisition-report insertion, and evidence append share a per-deal `pg_advisory_xact_lock`.
- Dispute insert/update/delete locks the parent `deals` row; finalization also locks that row and rejects non-terminal disputes.
- Finalization revalidates project ownership while holding a `FOR UPDATE` lock on the project row.
- Finalization locks the pinned trusted-signer row; signer revocation uses a conflicting row lock, so the two operations serialize.
- Finalization locks the exact report, evidence rows, terms version, and party acceptances before committing settlement.

### CI 984 — focused dispute/deal-row lock race (not finalizer E2E)

CI run [984](https://github.com/Aminzaki1972/Web3Market/actions/runs/43171778414) completed successfully on the isolated workflow, including the new `w3m-protocol-v1-dispute-concurrency.test.sh` invocation. The script opens two independent PostgreSQL sessions and exercises both lock orders against the disposable fixture: (1) a transaction holds the parent deal row, marks the deal completed, and a competing dispute insert must wait and then be rejected; (2) a dispute insert holds the parent deal row, and a competing settlement-side guard must wait, observe the committed open dispute, and fail closed.

**Interpretation limit:** this is a focused proof of the dispute trigger/parent-row lock contract only. The script performs a direct test update of `deals.status` and a separately authored guard query; it does **not** call `public.w3m_finalize_safe_execution_attempt`. The fixture is the disposable test schema, not a full production-schema migration. Therefore CI 984 does not close the separate-session finalizer E2E concurrency gap, and must not be described as proof of the finalizer's complete race behavior.

### Dispute terminal-state consistency correction

The finalizer previously required `deals.dispute_status='none'` even though the PREPARE path accepts both `none` and `closed`. This was a fail-closed mismatch: a deal whose dispute had been closed could pass PREPARE but be rejected at finalization. The isolated migration now accepts parent status `none` or `closed`, while still rejecting null/active/unclassified parent states and any child dispute not explicitly `resolved` or `closed`. The behavioral fixture keeps its active-dispute rejection, resolves that dispute, sets the parent to `closed`, and then requires successful finalization. This is a V1 consistency fix only; it does not bypass unresolved disputes.

Still outstanding: **separate-session behavioral proof** of those races. The test harness must hold one transaction at a controlled point, start the competing operation on a second PostgreSQL connection, prove it blocks or rejects as designed, then release/commit the first transaction and assert the final persisted state. Include both lock acquisition orders where meaningful. In particular, verify that a project-owner update waiting behind finalization cannot leave a completed/sold project with a mismatched owner, and that post-settlement dispute creation is rejected. Do not use sequential calls in one SQL session as a substitute for concurrency. The canonical Code Audit and Deal Room schemas remain authoritative for fixture inserts; no shadow tables or guessed schema are acceptable.
