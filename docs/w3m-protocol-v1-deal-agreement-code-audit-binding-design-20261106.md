# W3M Protocol V1 — deal agreement Code Audit binding design

Date: 2026-11-06
Status: design only; no migration or runtime implementation in this change.
Branch: `w3m-protocol-v1-isolated-20261105`

## 1. Problem to solve

The current versioned Deal Room terms bind the project, buyer, seller, exact financial terms, BNB chain, Safe, token and release policy. They do not yet bind the GitHub repository, immutable commit, or selected Code Audit ID.

A project-level `project_id` match is insufficient: a project may have multiple audits, a repository can change, and an audit can target a different commit. Automatically choosing the latest completed audit at report time would allow the evidence basis to change after the buyer and seller sign.

V1 must bind one explicit audit record and one immutable commit into the same canonical terms object both parties sign.

## 2. Proposed data shape

Add a server-owned per-deal Code Audit selection record, conceptually:

- `deal_id` — unique deal reference.
- `project_id` — exact project from the deal.
- `audit_id` — exact selected `code_audits.id`.
- `repository_url` — canonical repository URL read from the project row, not accepted as authoritative browser data.
- `commit_sha` — exact 40-character commit read from the selected audit row.
- `audit_type`, `completed_at`, `analysis_method` — copied only as a snapshot for diagnostics; the audit row remains the source of truth.
- `selected_by`, `selected_at`, `updated_at` — authenticated actor and server timestamps.

The selection is a pre-agreement draft input, not settlement authorization. The final immutable `w3m_deal_terms_versions.canonical_terms` must include a nested object with `auditId`, canonical `repositoryUrl`, `commitSha`, and `auditType`. The canonical terms hash therefore changes whenever the selected audit or commit changes.

The draft selection table may be updated before a new terms version is registered. Once a party has signed an earlier terms version, changing the selection makes that earlier version stale: the old signatures cannot authorize the new terms, and both parties must accept the new terms version.

## 3. Server-side selection contract

A trusted Edge Function must authenticate the caller and verify that the actor is the buyer or seller on the deal before invoking a service-role-only selection RPC.

The RPC must lock/read the deal and project, then load the exact requested audit by ID. It must reject unless all conditions hold:

1. Deal and project exist and the audit's `project_id` equals the deal's `project_id`.
2. The project has a valid GitHub repository URL; the audit's normalized owner/name and repository URL match that project repository.
3. Audit status is exactly `completed`.
4. Audit type is one of `code`, `smart_contract`, or `complete`.
5. `commit_sha` is a valid 40-character Git commit SHA and is read from the audit row.
6. `completed_at` is valid, not in the future, and within the V1 freshness window.
7. `analysis_method` and `risk_level` are non-empty persisted provenance fields.
8. `overall_score` is numeric and between 0 and 100.

No `latest` ordering or automatic audit selection is allowed. No browser-provided score, status, owner/name, commit, freshness result, or PASS flag is trusted.

The pure `selectCodeAuditEvidence` module remains the second validation layer. It receives the already loaded exact row plus the expected deal/project/repository/commit and emits mandatory `CODE_AUDIT` evidence only after revalidating the binding.

## 4. Agreement and report binding

The report issuer must read the selected audit ID from the server-owned selection row and include the matching evidence record:

- `sourceRecordId = audit_id`
- `sourceVersion = commit_sha`
- `projectId = deal.project_id`
- `dealId = deal.id`
- `contentHash` covers the normalized audit snapshot, including repository identity, commit, completion time, score, risk level and analysis method.

The canonical Deal Room terms must include the same audit ID, repository URL and commit SHA. Both buyer and seller sign the canonical terms hash. The persisted report verifier and execution gate must compare the report's Code Audit evidence to the signed terms; matching only the project ID is not enough.

If the project repository changes, a different audit is selected, the commit changes, or the audit freshness window expires, the report must become stale and settlement must fail closed until a new valid report and, where terms change, new bilateral acceptances exist.

## 5. Permissions and immutability

- Browser roles cannot read or mutate the server-owned selection table directly.
- The selection write RPC is service-role-only; the Edge Function is responsible for authentication and deal-party authorization before calling it.
- Immutable terms versions and party acceptances remain append-only.
- Selection updates must be audited. They must never overwrite an existing terms version or acceptance.
- No private signing key is needed for selecting the audit. The report-signing key remains a separate protected-custody requirement.
- Audit checkout payment records remain distinct from deal consideration and must not be treated as proof of project ownership or delivery.

## 6. Required isolated tests before runtime wiring

1. Reject audit ID from another project or deal.
2. Reject null project linkage and project repository mismatch.
3. Reject incomplete, unsupported, stale, future-dated or malformed audit rows.
4. Reject missing analysis method/risk level and out-of-range score.
5. Reject a commit that differs from the signed canonical terms.
6. Prove changing audit ID or commit changes canonical terms hash.
7. Prove both party signatures must match the new terms version after a selection change.
8. Prove an old persisted report cannot pass after selection/commit changes.
9. Prove no client role can directly read/write the selection table or execute the selection RPC.
10. Prove no automatic latest-audit fallback occurs.

## 7. Release boundary

This is a source-derived design proposal only. No migration, live database read, Edge Function patch, key configuration, deployment, or production change was performed. Implementation should begin only in the isolated branch after confirming the exact existing schema and adding disposable PostgreSQL contract tests.


## 8. Pure canonical binding boundary added (2026-11-06)

The isolated branch now contains:

- `supabase/functions/w3m-acquisition-verification/deal-code-audit-binding.ts`
- `supabase/functions/w3m-acquisition-verification/deal-code-audit-binding.test.ts`

The pure helper accepts only an already-selected mandatory `CODE_AUDIT` evidence object and validates its exact deal/project binding, audit record UUID, immutable 40-character commit, repository owner/name, supported audit scope, completion timestamp, and evidence SHA-256. It emits a deterministic compact object containing audit ID, canonical GitHub URL, commit SHA, audit scope, completion time, and evidence hash. It performs no I/O and cannot select an audit or mark one as passing.

This is a pre-integration contract, not yet part of `computeDealTermsHash`, `w3m_current_deal_terms_json`, or the live agreement-signing path. The remaining integration must load a server-owned selected audit ID, compare the project's authoritative GitHub URL, include the exact same binding in both TypeScript and SQL canonical terms, and test that changing the audit/commit creates a new terms version requiring both parties to sign again. No client-supplied repository or audit data may be authoritative.


## 9. Evidence validity interval hardening (2026-11-06)

The pure binding boundary now also requires all three temporal facts to be valid and ordered: audit completion must not occur after evidence observation, and the observation must be strictly earlier than the evidence validity deadline. Missing, malformed, or out-of-order validity timestamps are rejected. This checks the evidence interval itself; the upstream decision engine and server-side issuer must still compare the deadline against the trusted current issuance time to reject evidence that has since expired.
