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
