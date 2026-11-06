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

## 10. Authoritative project repository comparison boundary (2026-11-06)

The pure Code Audit binding module now exports `assertDealCodeAuditMatchesProjectRepository`. It compares the selected audit's normalized owner/repository identity against a repository URL supplied by the trusted server-side project loader. It rejects missing URLs, non-HTTPS URLs, non-GitHub hosts, credentials, ports, query strings, fragments, encoded paths, extra path segments, and owner/repository mismatches. A single trailing slash and the conventional `.git` suffix are normalized.

This helper does not load the project row and does not make caller-supplied URLs authoritative. The future server loader must read the project's `github_url` directly from the authoritative project record, call this comparison before producing evidence or signed terms, and fail closed on any mismatch.

The new tests cover exact matches, normalized URL forms, different owners/repositories, deceptive hosts, credentials, non-HTTPS URLs, encoded paths, query strings, and extra path segments. This closes the pure comparison boundary only; it is not yet wired into the agreement signing service, SQL canonical terms, or report issuer runtime.


## 11. Agreement implementation map and schema verification (2026-11-06)

The isolated branch source review has now identified the actual agreement hash and SQL enforcement points:

- TypeScript canonical terms and hash: `supabase/functions/w3m-acquisition-verification/deal-terms-hash.ts` (`DealTermsSnapshot`, `computeDealTermsHash`).
- Trusted agreement loader and both prepare/accept paths: `deal-agreement-service.ts`, function `loadSigningContext`, which reads only the service-role RPC `w3m_read_deal_agreement_signing_snapshot` before calculating and registering the canonical terms.
- SQL canonical mirror and stale-signature guard: migration `20261107040000_w3m_protocol_v1_deal_agreement_acceptances.sql`, function `w3m_current_deal_terms_json`; both registration and acceptance compare the submitted canonical JSON against this database-generated value.
- Signing snapshot currently returns project identity/owner/status but not the project's GitHub URL or an explicitly selected audit row.

The authoritative project repository column is confirmed by existing application code as `public.projects.github_url`. Existing project-detail code reads `projects.id,github_url,status`; existing project review code reads `projects.id,owner_id,github_url`. The pure URL comparison helper must therefore receive `project.github_url` from the trusted server snapshot, not a browser value.

The exact audit selection mechanism is not yet established. The audit V2 migration test fixture only declares a minimal `code_audits` table with `id`, `requested_by`, `project_id`, `status`, and `engine_version`; it is intentionally not a complete production schema contract. Application code and the Buyer Due Diligence review confirm that audit rows also expose fields such as `repo_url`, `commit_sha`, `completed_at`, `overall_score`, `risk_level`, and `analysis_method`/engine provenance in relevant paths, but a single authoritative full DDL definition for these columns has not yet been located in the repository migrations reviewed. Do not write a selector RPC against assumed columns or silently choose the newest audit.

### Safe next implementation sequence

1. Locate and verify the complete deployed-origin DDL/schema contract for `code_audits` and the exact evidence columns needed by the selector.
2. Add a server-owned per-deal explicit audit selection, with no direct client table access and no automatic latest-audit fallback. The server must load `projects.github_url`, the exact audit row by ID, and compare project ID, normalized repository identity, completion status, commit SHA, audit scope, provenance, score/risk and freshness before accepting the selection.
3. Extend `DealTermsSnapshot` and `computeDealTermsHash` with a required, validated audit binding. Do not make it optional for the acquisition V1 signing path: a missing selection must fail closed.
4. Extend the SQL signing snapshot to return the selected audit binding and `projects.github_url`; extend `w3m_current_deal_terms_json` to emit the exact same nested JSON keys and canonical values as TypeScript. Registration and acceptance already compare against the SQL canonical JSON, so mismatch must reject.
5. Add parity tests proving TypeScript and SQL canonical JSON match, and changing audit ID or commit changes the terms hash/version. Confirm old buyer/seller signatures cannot authorize the changed terms.
6. Keep report evidence and settlement-time persisted-report verification tied to that same signed audit ID, commit and evidence hash. Do not treat the agreement binding alone as proof that the repository remains unchanged or that the report is still fresh.

This section records source findings and the implementation sequence only. No migration, production schema read, runtime function patch, deployment, or production data change was performed.


## 12. Audit source-field verification (2026-11-06)

A second source review confirmed the following audit-row fields are consumed by existing server-side application code:

- Identity and scope: `id`, `project_id`, `repo_url`, `repo_owner`, `repo_name`, `branch`, `audit_type`.
- Immutable source revision: `commit_sha`.
- Completion/provenance: `status`, `completed_at`, `engine_version`, and structured `analysis_progress`.
- Result metadata: `overall_score`, `risk_level`, `files_scanned`, `coverage_score`, severity counts.

These fields are confirmed by `w3m-trust-badge/index.ts`, `buyer-dd-create/index.ts`, `guest-audit-access/index.ts`, and `w3m-audit-autofix-pr/index.ts`. The audit V2 migration adds `audit_type`; it does not define the original `code_audits` table. The complete original DDL and every production column constraint are still not present in the reviewed migration history. Therefore the above is an application-consumed field inventory, not a claim that this is a complete schema contract.

Important distinction: `analysis_progress` carries structured scan evidence (including evidence version, batch stats, persisted-file count, and truncation flags), but the repository review has not established a canonical, immutable, persisted SHA-256 digest for the complete audit report plus all file and finding rows. A deal binding must not label a hash of a partial metadata subset as a full audit evidence hash. Before writing the selector migration, define a deterministic server-side audit manifest over the exact persisted audit row, all paginated `code_audit_files` rows and all paginated `code_audit_findings` rows, with stable ordering and a versioned canonical encoding; store its digest in an append-only deal selection record and recompute it before final settlement. If the source rows change, recomputation must fail closed.

No SQL migration or TypeScript agreement hash was changed in this step. The implementation is intentionally gated on this manifest contract so that the protocol does not cryptographically bind a misleading or incomplete audit fingerprint.


## 13. Audit Manifest V1 pure implementation (2026-11-06)

Added an isolated pure implementation:

- `supabase/functions/w3m-acquisition-verification/audit-manifest.ts`
- `supabase/functions/w3m-acquisition-verification/audit-manifest.test.ts`

The manifest uses version tag `w3m-audit-manifest-v1` and hashes a canonical payload containing the complete supplied audit row, all supplied file rows, all supplied finding rows, and explicit file/finding counts. File and finding rows are sorted by their stable `id`; missing or duplicate IDs, non-JSON values, non-finite numbers, and excessive nesting are rejected. Tests cover order independence and digest changes when any audit/file/finding content changes.

Critical loader contract: this helper does not query the database and cannot prove that the caller supplied every row. The future trusted server loader must fetch the audit row and every page of file/finding rows, preserve the complete selected row payloads (not partial projections), verify pagination completion and expected counts, and then call this helper. The resulting digest must be persisted with an append-only deal/audit selection and recomputed from fresh rows before settlement. A matching digest proves equality to the supplied snapshot, not source authenticity or completeness by itself.

The manifest is not yet integrated into `DealTermsSnapshot`, SQL canonical agreement terms, signing, or settlement. No migration, database write, production access, deployment, or merge was performed. CI for the implementation and tests is pending at this commit.


## 14. Audit Manifest V1 completeness hardening (2026-11-06)

The first helper draft was tightened after reviewing the actual audit writer and trust-badge reader:

- File natural identity is `path`; the writer persists `audit_id,path,line_count,size_bytes,selected_tier` and the trust-badge reader independently paginates persisted file rows.
- Finding natural identity is `file_path,line_start,severity,category,title`; these fields are the writer's persisted finding identity. Severity is restricted to `critical|high|medium|low|info`.
- Every file and finding row must carry the selected `audit_id`.
- The audit must be completed, have a 40-character commit SHA, repository owner/name, completion timestamp, engine version, and structured evidence version `w3m-audit-evidence-v1` with `tree_truncated=false`.
- File row count must equal both `code_audits.files_scanned` and `analysis_progress.persisted_file_count`.
- Finding row count must equal the sum of the five persisted severity counters written at audit completion.
- Sorting now uses locale-independent code-point comparison, not locale-sensitive collation.

These checks make incomplete pagination and cross-audit row mixing fail closed, assuming the trusted loader actually fetches all pages and selects complete rows. The base DDL for the original `code_audits`, `code_audit_files`, and `code_audit_findings` tables remains unlocated in the repository migration history reviewed here; the field contract above is grounded in the current audit writer/reader code, not claimed as a complete database DDL specification. CI for the latest hardening commit is pending.
