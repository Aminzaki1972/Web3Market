# W3M Protocol V1 — Finalization-Time Acquisition Gate

Status: **OPEN / BLOCKING FOR RELEASE**
Scope: isolated branch `w3m-protocol-v1-isolated-20261105` only.
Production status: this document does not authorize deployment, migration, or Safe execution.

## Finding

The current Safe finalization path independently verifies the BNB receipt and exact Safe execution event/transfers, then calls `w3m_finalize_safe_execution_attempt`. The SQL finalizer locks the execution attempt, deal, Safe transaction, and release policy and checks their current state. It also binds the attempt's `report_id` into the audit log.

However, the finalizer does **not** currently reload and lock the referenced `w3m_acquisition_reports` row, confirm that its report version is still the latest for the deal, re-check its PASS/expiry/party/project binding, lock and re-check its trusted signer status, or revalidate the report's evidence rows at finalization time.

The claim RPC performs a report check earlier in the lifecycle. That earlier check is not a substitute for a finalization-time check: the report can expire, be superseded, or its signer can be revoked between claim and finalization. The service-side persisted-report guard exists, but the current Safe finalization composition does not invoke it.

## Required invariant

A Safe attempt may transition to `CONFIRMED` only if, within the same database transaction that finalizes the deal:

1. The attempt's `report_id` and `report_version` still identify the exact report pinned at claim time.
2. The report belongs to the attempt's deal and the deal's current project, buyer, and seller.
3. The report is `PASS`, unexpired at database transaction time, and remains the latest report version for that deal.
4. The signer key is still trusted and not revoked under the protocol's current revocation policy.
5. The persisted evidence set still matches the signed report's evidence manifest, with every mandatory item passing and unexpired.
6. The immutable deal-terms hash in the report still matches the exact immutable terms version bound to the Safe attempt/package.
7. No dispute or other settlement-blocking state has appeared.
8. The above facts are protected against concurrent changes until the atomic finalization commits.

## Implementation approach

Do not rely on a TypeScript preflight alone. It leaves a time-of-check/time-of-use gap.

The finalization service should freshly load the report bundle and run the existing cryptographic persisted-report guard. It should then pass a compact, typed report attestation to a revised atomic finalization RPC. Inside one transaction, the RPC must lock the attempt, deal, policy, report, trusted signer row, immutable terms version, and relevant evidence rows; compare every attested identity/version/hash/count against the locked rows; independently enforce current status, expiry, latest-version, revocation, dispute, and party bindings; and only then perform the existing all-or-nothing state updates.

The report/evidence registry is intended to be append-only. Enforce that invariant at the database layer for report and evidence rows (including service_role), not merely by convention. If a source record can change, its current version/hash must be compared with the report's pinned source version/hash before settlement.

## Required regression tests

- Report expires after claim but before finalization: blocked, no state changes.
- A newer report supersedes the pinned report after claim: blocked.
- Trusted signer is revoked after claim: blocked.
- Evidence row is altered, removed, or added after claim: blocked.
- Mandatory evidence becomes stale/expired: blocked.
- Report/evidence hash or immutable deal-terms version differs from the attempt: blocked.
- Deal dispute opens after claim: blocked.
- Concurrent report/evidence/signer mutation races finalization: one serializable/locked outcome; never a stale authorization.
- A fully valid, unchanged report/evidence/signature set plus canonical BNB receipt: finalizes once.
- Repeated finalization of the same confirmed attempt/hash remains idempotent; a different hash is rejected.

## Release gate

This item remains open until the atomic SQL enforcement, service composition, append-only protections, and disposable-PostgreSQL regression tests are implemented and pass. The current isolated CI run is not a release approval. Do not deploy any migration or Edge Function and do not use real funds or a live Safe while this item is open.


## Source-level audit — 2026-11-06

The current branch was re-read at commit `3678edd16801ff3f1563b4f12ed3b652c4600466`. The isolated workflow run `42193650935` completed successfully, including its `decision-engine-and-schema` job and disposable PostgreSQL migration/test steps. This is a CI result, not a release approval.

The source review confirms the blocker is still present:

- `safe-finalization-snapshot-adapter.ts` reads only `w3m_read_safe_finalization_snapshot`; its returned expectation contains no report version, report hash, evidence manifest, signer key, or terms version.
- `bnb-safe-receipt-verifier.ts` composes fresh Safe snapshot -> BNB receipt verification -> atomic finalizer. It does not call `loadCurrentW3MReportBundle` or `evaluatePersistedW3MReport`.
- `persisted-report-loader.ts` and `persisted-report-guard.ts` do exist. The guard checks latest report version, expiry, party/project binding, canonical report hash, evidence manifest recomputation, current terms hash, and EIP-712 trusted signer verification. Their existence does not protect finalization until this guard is wired into the finalization flow and its result is bound to the SQL transaction.
- `w3m_finalize_safe_execution_attempt` locks the attempt, deal, Safe transaction, and release policy. It does not select or lock `w3m_acquisition_reports`, `w3m_acquisition_evidence`, signer status/events, or immutable terms rows. It currently trusts the earlier claim-time report check and records only the pinned `report_id` in the audit log.
- `w3m_read_safe_finalization_snapshot` also omits report/evidence/signer/terms data. Its current role is a Safe execution snapshot, not an acquisition revalidation snapshot.
- The evidence-registry migration revokes direct table writes and exposes a SECURITY DEFINER batch-insert RPC, but it does not install UPDATE/DELETE rejection triggers on the report or evidence tables. Add database-level immutability protections and test privileged mutation paths before treating those rows as immutable.
- The trusted signer registry derives status from append-only activation/revocation events, but the finalizer does not lock/re-read the signer key and latest event in its transaction. Revocation-after-claim therefore remains a release-blocking race.
- The current runtime report loader correctly targets `w3m_acquisition_reports` and `w3m_acquisition_evidence`. A separate older migration also defines `acquisition_reports` / `acquisition_evidence`; do not mix those legacy tables into the W3M finalization path.

### Safe next implementation sequence

1. Define a versioned finalization attestation containing report ID/version/hash, evidence manifest hash/count, signer key ID and verified signer identity, deal-terms version/hash, and exact deal/project/party bindings.
2. Wire the persisted report loader and cryptographic guard into the isolated finalization service. Fail closed if any row is missing, duplicated, malformed, stale, superseded, expired, or mismatched.
3. Extend the atomic SQL finalizer to lock the exact report, all evidence rows, signer key plus latest revocation event, deal-terms version, and dispute state. Compare every attested identifier/hash/version/count with the locked database rows before any settlement update.
4. Add append-only triggers for report/evidence rows and verify that ordinary roles, service_role, and SECURITY DEFINER paths cannot mutate or delete issued records.
5. Add the listed race/regression cases to disposable PostgreSQL CI, including a revocation or evidence mutation racing the finalizer.

No SQL or runtime code was changed as part of this audit because the present interfaces do not yet carry a complete report attestation into the atomic RPC. Guessing at that contract would risk creating a false security boundary.

## Append-only protection increment — 2026-11-06

An isolated migration and regression test were added:

- `supabase/migrations/20261107110000_w3m_protocol_v1_append_only_registry.sql`
- `supabase/tests/w3m-protocol-v1-append-only-registry.test.sql`

The migration installs statement-level UPDATE/DELETE/TRUNCATE rejection triggers on the W3M acquisition report, evidence, report-event, trusted-signer-key, and trusted-signer-event registries. It does not grant additional write privileges; the service role remains read-only on these tables and writes continue through the existing SECURITY DEFINER registry RPCs. The SQL regression test checks the triggers and verifies that report/evidence/event/signer mutation attempts are rejected.

The isolated CI workflow was updated to apply this migration only to its disposable PostgreSQL service and execute the new test. Run `42197764274` on commit `7650efd` subsequently completed successfully. Its disposable PostgreSQL migration/test step passed, validating the five acquisition/signer registry triggers. This run predates the agreement-history migration and signer-revocation lock added below.

This closes the direct row-mutation gap for these five registries only if CI passes and the database owner does not disable triggers. It does **not** close the finalization-time revalidation gap. Deal-terms version/acceptance immutability and signer-revocation serialization with finalization still require explicit handling, and the atomic finalizer still does not lock/revalidate the acquisition report/evidence/signer/terms bundle.


## Immutable agreement-history increment — 2026-11-06

A follow-on isolated migration and SQL regression test now protect the two agreement-history tables after their schema migration has run:

- `supabase/migrations/20261107120000_w3m_protocol_v1_immutable_agreements.sql`
- `supabase/tests/w3m-protocol-v1-immutable-agreements.test.sql`

The migration installs the existing database-level append-only rejection trigger on `w3m_deal_terms_versions` and `w3m_deal_agreement_acceptances`. The CI workflow applies it only after `20261107040000_w3m_protocol_v1_deal_agreement_acceptances.sql`, then checks UPDATE, DELETE, and TRUNCATE rejection and verifies that authenticated/service roles do not have direct mutation paths. The trigger test also checks all three trigger operation bits, not just trigger presence.

This protects the immutable terms and signed-consent history from ordinary row mutation in the disposable CI schema. It does not yet serialize trusted-signer revocation against finalization, and it does not wire the persisted acquisition report/evidence/signer/terms guard into the atomic Safe finalizer. The finalization-time acquisition gate therefore remains OPEN / BLOCKING FOR RELEASE. CI must complete successfully on the new branch head before this increment is considered validated.


## Trusted signer revocation lock — 2026-11-06

The isolated trusted-signer revocation RPC now obtains `SELECT ... FOR UPDATE` on the signer-key row before appending the REVOKED event. Its SQL regression test asserts that the function definition contains this row lock, and the existing lifecycle test still verifies that revocation changes the derived signer status.

This establishes a shared serialization point for the next finalizer change: finalization must lock the same signer-key row and re-read the latest event in its own transaction. The lock added to revocation alone does not close the race until the atomic finalizer takes the matching lock and validates the signer status before committing.


### CI follow-up — 2026-11-06

The follow-on changes for immutable agreement history and signer-revocation row locking are included in isolated run `42198188037` (head commit `fca96858a257d88b22122d9fe94b96bd95ff791e`). At the latest check this run was still `in_progress`; its SQL migration and regression results are not yet validated. The later documentation-only commit does not change the code tested by that run.


## Report-version serialization increment — 2026-11-06

Added an isolated database serialization barrier for the latest-report race:

- `w3m_acquisition_reports` now has a BEFORE INSERT trigger that obtains a transaction advisory lock keyed by the report's `deal_id`.
- The atomic Safe finalizer obtains the same per-deal advisory lock immediately after locking the execution attempt.
- This creates a shared serialization point so a new report append cannot race past finalization's latest-report check once that check is wired into the finalizer.

Files:
- `supabase/migrations/20261107130000_w3m_protocol_v1_report_version_serialization.sql`
- `supabase/tests/w3m-protocol-v1-report-version-serialization.test.sql`

The first CI attempt for immutable agreement history exposed a test-harness issue: PostgreSQL rejects truncating the parent terms table alone while the acceptance table references it, before the expected trigger can run. The test was corrected to issue a single multi-table TRUNCATE for the parent/child pair. This was a test setup failure, not evidence that the append-only trigger failed.

The latest CI run after that correction is `42198620724` on `f7f31fd0ea4c46252585539c7b179881cb287914`; its result is pending. The report-version serialization barrier is groundwork only: the finalizer still needs to load and lock the pinned report, all evidence, signer key/latest event, immutable terms version and both acceptance rows, then compare the typed attestation before any settlement update. Release remains blocked.


The report append/finalizer advisory-lock implementation is now committed. The SQL regression test was strengthened to verify that both the report INSERT trigger and finalizer use `pg_advisory_xact_lock(hashtextextended(deal_id, 0))`, and that the finalizer obtains the lock before reading the deal. The immutable-agreement TRUNCATE test now truncates the referencing acceptance table and terms parent together so PostgreSQL's foreign-key precheck does not mask the trigger's expected rejection.

CI status: the earlier run `42198188037` failed only in the immutable-agreement TRUNCATE test setup (FK dependency); the failure was diagnosed from the PostgreSQL log and corrected. Run `42198620724` is validating the correction, and run `42198707586` was queued for the strengthened report-lock assertions. Neither is yet a successful validation of the latest branch head.
