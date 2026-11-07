# W3M Protocol V1 — independent pre-agreement audit snapshot design

## Purpose

Break the first-deal circular dependency. A completed repository audit must be selected and cryptographically manifested before the buyer and seller sign the canonical deal terms. The selected audit snapshot must not depend on a previously issued acquisition report.

## Verified production source contract (schema only)

The read-only production review confirmed:
- `code_audits.id`, `code_audit_files.id`, and `code_audit_findings.id` are UUID primary keys.
- Both child tables reference `code_audits(id)` with `ON DELETE CASCADE`.
- `code_audit_files.path` is required; `code_audit_findings` has `file_path`, `line_start`, `severity`, `category`, and `title`.
- The child tables have no unique natural-key constraints. Their primary-key `id` is the correct final pagination tie-breaker.
- Production currently has no immutability triggers on these three tables and grants service_role UPDATE/DELETE. The isolated completed-audit immutability migration is therefore a required prerequisite, not a currently active production guarantee.

## Current implementation boundary (2026-11-07)

The isolated agreement migration `20261107040000_w3m_protocol_v1_deal_agreement_acceptances.sql` now creates the independent append-only `w3m_deal_code_audit_snapshots` registry, its restricted snapshot-creation RPC, and the trusted pre-agreement context RPC. The canonical `w3m_current_deal_code_audit_json` selector now reads the saved snapshot registry rather than an acquisition report, removing the first-report circular dependency at the SQL terms layer.

A server-only TypeScript persistence boundary exists at `deal-audit-snapshot-persistence.ts`. It accepts a recomputed Manifest V1 and strict audit binding, calls the snapshot RPC with only deal/audit identity and computed manifest facts, and validates the exact persisted response. The orchestration service `deal-audit-snapshot-service.ts` selects the audit through the trusted context RPC, loads the complete source manifest through the existing paginated loader, verifies the audit's project identity and repository URL against the authoritative project listing, then persists the snapshot. It does not query acquisition reports.

The public agreement service now also exposes `prepareDealAgreementAcceptanceWithAuditSnapshot` and `acceptDealAgreementWithAuditSnapshot`; these recompute and idempotently persist the snapshot before constructing or accepting EIP-712 terms. The SQL agreement registration and acceptance functions re-read the same current snapshot through `w3m_current_deal_terms_json`.
The trusted context RPC also receives the authenticated actor ID and rejects callers who are not the deal's buyer or seller before snapshot creation. The isolated Edge Function source `w3m-protocol-v1-deal-agreement/index.ts` is now wired to the service-role manifest source adapter and the snapshot-aware request-handler dependencies. This is source wiring only; the Edge Function has not been deployed or enabled.

A deferred database constraint trigger, `w3m_acquisition_report_requires_signed_deal_terms`, now blocks every acquisition report unless:
- the latest deal terms still match the current deal and saved Code Audit snapshot;
- both buyer and seller have accepted that exact terms version; and
- the report contains exactly one mandatory `CODE_AUDIT` evidence row matching the saved audit ID, commit, manifest version/hash, file/finding counts, score, risk level and analysis method.

The SQL regression test begins with zero acquisition reports, creates a completed source audit and snapshot, rejects both PASS and BLOCKED reports before signatures, accepts a PASS report after both signatures with matching audit evidence, and proves that a newer audit changes the current binding. It also checks snapshot idempotency and append-only protection. The deferred guard applies to UUID-backed W3M deals; the authenticated W3M report endpoint accepts UUID deal IDs only.

The code and migrations remain isolated on `w3m-protocol-v1-isolated-20261105`. Workflow run `42309795302` completed successfully with 79 steps, including the disposable PostgreSQL migration suite, the first-deal-from-zero-report test, Safe execution fixtures, and completed-audit immutability tests. A further SQL regression now attempts to issue a correctly signed report with a deliberately mismatched `CODE_AUDIT` manifest digest and requires rejection. The snapshot service and SQL context now also reject scores outside 0–100, with unit tests for both bounds. CI for these latest changes is pending. The agreement Edge Function and request handler are wired in isolated source and type-checked/tested, but are not deployed or enabled. The report issuance orchestration and request handler exist as modules, but a dedicated Edge Function that loads all authoritative report inputs and protected signer configuration is still a separate integration task. No W3M Protocol migration or snapshot RPC has been applied to production.

## Registry model

Introduce one server-only append-only registry, provisionally named `w3m_deal_code_audit_snapshots`, with:

| Field | Purpose |
|---|---|
| `id` | UUID primary key |
| `deal_id` | Exact deal |
| `project_id` | Exact project bound to the deal |
| `snapshot_version` | Monotonic version within a deal |
| `audit_id` | Exact completed `code_audits.id` |
| `repository_owner`, `repository_name`, `repository_url` | Repository identity derived from source audit and checked against `projects.github_url` |
| `commit_sha` | Exact 40-hex source commit |
| `audit_type` | `code`, `smart_contract`, or `complete` |
| `completed_at` | Source audit completion timestamp |
| `manifest_version` | `w3m-audit-manifest-v1` |
| `manifest_hash` | SHA-256 digest recomputed by the trusted server |
| `file_count`, `finding_count` | Recomputed manifest totals |
| `created_at` | Server timestamp |

Required constraints:
- Foreign keys to `deals(id)`, `projects(id)`, and `code_audits(id)`, using restrictive deletion behavior.
- Unique `(deal_id, snapshot_version)`.
- Unique `(deal_id, audit_id, manifest_version, manifest_hash)`.
- Check constraints for UUID relationships, SHA-1 commit, SHA-256 manifest, positive file count, non-negative finding count, supported audit type, and fixed manifest version.
- RLS enabled; revoke all direct access from `public`, `anon`, `authenticated`, and ordinary `service_role` table DML. Expose only narrowly scoped server-side RPC execution.
- Append-only trigger rejects UPDATE and DELETE.

## Trusted snapshot creation operation

The browser must submit only the deal identifier and, if the workflow explicitly permits choosing among completed audits, an audit identifier. It must never submit an authoritative digest, repository identity, commit SHA, counts, timestamp, or signer identity.

The trusted server operation must:
1. Load the deal and project from the database.
2. Load the project's authoritative `github_url`.
3. Resolve the selected audit against that exact project and its repository URL.
4. Require `status = 'completed'`, a valid commit SHA, the expected audit evidence version, complete repository-tree evidence, and consistent persisted file/finding totals.
5. Load all file/finding pages using deterministic orders:
   - files: `path ASC, id ASC`
   - findings: `file_path ASC, line_start ASC, severity ASC, category ASC, title ASC, id ASC`
6. Recompute the existing Audit Manifest V1 digest with `loadAuditManifest`; do not introduce another serializer.
7. Build/validate the compact binding with `deal-code-audit-binding.ts` and compare it to the authoritative project repository with `assertDealCodeAuditMatchesProjectRepository`.
8. Persist only the server-derived snapshot through a narrow RPC. The RPC rechecks deal/project/audit identity and prevents duplicate or conflicting versions.
9. Return the persisted snapshot to the trusted agreement reader. Never trust a client copy as the source of truth.

## Agreement and report lifecycle

- `w3m_current_deal_code_audit_json(deal_id)` must read the latest valid independent snapshot, not `w3m_acquisition_reports`.
- `w3m_current_deal_terms_json(deal_id)` embeds that snapshot before terms are hashed and signed.
- Both parties must accept the same canonical terms version and exact audit manifest binding.
- Report issuance happens only after both acceptances. It reuses the already-signed snapshot to write report-scoped `CODE_AUDIT` evidence and `DEAL_AGREEMENT` evidence.
- Before report issuance and before any future settlement authorization, the server recomputes the manifest and compares version, audit ID, digest, counts, commit, and repository identity with the persisted snapshot.
- If a new audit or repository identity is selected, a new snapshot version changes canonical terms; both parties must accept the new terms version. Old acceptances do not carry forward.
- A stale, missing, incomplete, mismatched, or unverified snapshot fails closed.

## Required concurrency and immutability guarantees

The completed-audit guard must be deployed and verified before the registry is treated as a durable source. It must serialize audit completion against child-row writes and reject later INSERT/UPDATE/DELETE of files/findings for completed audits, and reject UPDATE/DELETE of completed audit rows. The current production schema review found no such triggers; this is a deployment prerequisite, not an assumed property.

The snapshot insert RPC must serialize per-deal version allocation (for example, by locking the deal row) and enforce the unique constraints. No client-supplied version is authoritative.

## Regression tests

Start with a deal having zero acquisition reports and one completed, complete source audit:
1. Create the independent audit snapshot successfully.
2. Register canonical terms containing that exact snapshot.
3. Buyer acceptance alone does not authorize report issuance.
4. Seller acceptance of the same terms version completes the agreement.
5. Report issuance succeeds and references the same audit ID, commit, manifest version, digest, and counts.
6. Re-run with a new audit/commit and prove both parties must accept a new terms version.
7. Reject wrong project, wrong repository, wrong audit ID, wrong commit, unsupported audit type, malformed timestamp, wrong digest/counts, duplicate/conflicting snapshot, missing/stale snapshot, incomplete pagination, and post-completion source mutation.
8. Reject browser-supplied digest, counts, signer identity, or repository identity as authoritative inputs.

## Deployment boundary

This is a design contract only. No production DDL or data was changed during the read-only schema review. W3M Protocol V1 migrations are not present in the production migration registry; all implementation remains isolated. Settlement remains disabled (`settlementAuthorized: false`, `executionEnabled: false`) until separately reviewed and explicitly approved.
