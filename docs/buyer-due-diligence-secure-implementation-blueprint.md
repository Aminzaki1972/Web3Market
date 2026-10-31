# Buyer Due Diligence — Secure Implementation Blueprint

**Branch:** `prototype/w3m-buyer-due-diligence`  
**Stage:** design only — not deployed or applied to Supabase  
**Scope:** buyer dashboard feature, private reports

## 1. Proposed data model (logical, not migration SQL)

### `buyer_due_diligence_reports`
- `id` — generated UUID primary key.
- `buyer_id` — references the authenticated account identity; set by trusted server/database logic, never accepted from an untrusted browser payload.
- `listing_id` — references an eligible marketplace listing.
- `status` — constrained lifecycle such as `queued`, `collecting`, `ready`, `partial`, `failed`, `deleted`.
- `created_at`, `updated_at`, `completed_at`.
- `report_version` — version of the report format/collector.
- `source_snapshot_at` — when evidence was collected.
- `limitations` — structured list of unavailable checks and scope limitations.

### `buyer_due_diligence_evidence`
- `id`, `report_id`, `source_type`, `source_url`, `observed_at`.
- `evidence_class` — constrained values: `verified_public_fact`, `source_claim`, `candidate_only`, `unresolved`.
- `observation`, `content_hash`, `collector_version`, `metadata`.
- Keep source observations separate from model-generated summaries. Do not store secrets, private seller credentials or unrestricted scraped page dumps.

### `buyer_due_diligence_notes`
- `id`, `report_id`, `buyer_id`, `body`, `created_at`, `updated_at`.
- Notes are private to the report owner and must not be included in seller-facing views or shared exports by default.

### Audit linkage
Store a nullable reference to an existing saved Code Audit record only after verifying that the buyer is allowed to see the associated listing and audit result. Record the repository commit SHA shown by that audit. Do not duplicate or recalculate its score.

## 2. Authorization invariants

1. The authenticated identity is derived from a verified session; never trust a submitted `buyer_id`, role, or listing owner value.
2. A report is readable only by its owner. Seller, other buyer, anonymous visitor and ordinary support user have no report access by default.
3. Creating a report requires that the listing is currently visible to that buyer and that the requested sources are public or explicitly authorized.
4. Every read, insert, update, delete and export checks report ownership server-side.
5. Evidence and notes inherit the parent report's ownership. A child row cannot be accessed merely by guessing its UUID.
6. Update policies must prevent changing `buyer_id` or moving a report to another owner.
7. Report IDs are opaque identifiers, not access tokens.
8. No public report URL, public storage bucket, or unauthenticated export is created.
9. If an account is disabled or access is revoked, future requests must fail authorization. Consider session revocation and token lifetime for sensitive operations.
10. Any future explicit share flow must create a separate, narrowly scoped share object with expiry and revocation; it is not included now.

## 3. Supabase-specific safeguards for implementation stage

- Enable RLS on every exposed table before granting client access.
- Use `TO authenticated` plus a real ownership predicate; authentication alone is not authorization.
- Do not use editable user metadata as an authorization source.
- For updates, use both row visibility and new-row ownership checks so an owner cannot reassign a record.
- Review all views: ordinary views can bypass RLS unless configured with appropriate invoker security or kept out of exposed schemas.
- Avoid `SECURITY DEFINER` functions unless there is a documented necessity and a separate security review.
- Never expose service-role/secret keys in browser code.
- Verify Data API grants separately from RLS policies.
- Run database security advisors and test cross-account access with two distinct buyer accounts before any release.

These are implementation requirements, not confirmation that the current project already satisfies them.

## 4. Backend request flow

1. Browser submits a listing reference and report request from the signed-in buyer dashboard.
2. Server verifies the session and derives the buyer identity.
3. Server checks listing visibility and request limits.
4. Collector retrieves only approved public/authorized sources with SSRF defenses, redirect checks, response-size limits and timeouts.
5. Collector stores evidence provenance and creates a report state.
6. Report rendering queries only rows authorized for the current buyer.
7. Existing Code Audit data is linked by verified audit ID and commit SHA, never fetched by an arbitrary client-provided ID without authorization.

## 5. Minimum security test matrix

| Test | Expected result |
|---|---|
| Buyer A reads Buyer A report | Allow |
| Buyer B reads Buyer A report by guessed UUID | Deny |
| Seller reads buyer's private report | Deny |
| Anonymous visitor opens report URL | Deny |
| Buyer changes submitted `buyer_id` to another account | Reject |
| Buyer changes report owner on update | Reject |
| Buyer requests a listing they cannot view | Deny |
| Buyer reads a child evidence row from another report | Deny |
| Buyer exports another buyer's report | Deny |
| Revoked/disabled account requests report | Deny according to revocation policy |

## 6. Rollout gates

- [ ] Review the current marketplace listing access model and existing table policies.
- [ ] Inspect the existing Code Audit schema and its access rules before linking it.
- [ ] Confirm whether a separate isolated Supabase test project is available; do not use production for experiments.
- [ ] Prepare migration SQL only after the above reviews and current Supabase documentation checks.
- [ ] Apply changes only to the isolated test project after explicit approval.
- [ ] Run the full two-account authorization matrix and security advisors.
- [ ] Obtain separate explicit approval before any production migration, function deployment, or live UI integration.


## 7. Findings from read-only inspection of the current production project

**Inspection only:** current Supabase schema, RLS policy definitions and deployed function source were read. No rows were changed, no SQL DDL was executed, and no function was deployed.

### Existing marketplace listing access
- `projects` already has RLS enabled.
- The current public listing policy allows anonymous reads for `active` and `sold` projects, excluding the configured test-mode marker.
- The authenticated listing policy permits admins, listing owners, and public active/sold listings.
- Therefore the buyer flow can begin from a listing the buyer is already authorized to view, but the server must re-check this before every report request.

### Existing AI Due Diligence is a different workflow
The production project already contains `ai_due_diligence_reports` and `ai_due_diligence_evidence`. These are not automatically suitable for the new buyer-private feature:

- The deployed `ai-due-diligence` Edge Function currently checks that the caller owns the project (or is an admin) before creating a report. A buyer who is not the seller/project owner is rejected.
- The existing report SELECT policy allows the report requester, the project owner, and completed reports marked public for published projects to read. This is broader than the new requirement that a buyer's report and notes remain private to that buyer.
- The evidence SELECT policy also allows the report requester **or project owner** to read evidence.
- The existing report schema includes `requested_by`, `is_public`, score fields, findings and evidence JSON; it does not provide the complete buyer-owned report/notes access model described above.

**Decision:** do not connect the buyer dashboard to these tables or the existing Edge Function as-is. Keep the buyer-private report model separate unless a later, reviewed design proves a safe migration path. Do not flip `is_public` or alter existing policies as a shortcut.

### Existing W3M Code Audit access
- `code_audits`, `code_audit_files` and `code_audit_findings` have RLS enabled.
- Current SELECT policies restrict audit rows and their child file/finding rows to the audit requester or an admin.
- This means a buyer cannot automatically read a seller's existing audit just because the audit references a marketplace project.
- Future buyer integration should use a deliberately authorized, minimal report snapshot or a separately reviewed buyer-access policy. It must not expose the seller's private audit record, raw file inventory or unrelated audit history.

### Consequence for the implementation plan
1. Keep the new buyer-owned report and private-notes model separate from the existing seller-oriented AI Due Diligence records.
2. Define a narrow, explicit method to show a buyer only the technical audit summary/findings that are safe and authorized for that listing.
3. Preserve the current audit requester/admin privacy boundary unless the platform owner separately approves a carefully scoped change.
4. Build and test the new buyer-only policies in a separate Supabase test project; the current production project is not the test environment.

## Explicit non-actions in this stage

No Supabase table, policy, function, secret, storage bucket, production setting, Cloudflare deployment, public route, PR, merge or production file has been changed by this design document.


## 8. Code Audit integration contract — reviewed, not implemented

### Safe display boundary
- The buyer report must not query `code_audits`, `code_audit_files`, or `code_audit_findings` directly from the browser.
- Current production SELECT policies authorize the audit requester and admin; a listing being public does not grant the buyer access to the seller's audit record.
- Do not loosen those policies or expose a seller's raw file inventory, findings history, repository metadata, or audit ID as an authorization shortcut.
- Do not reuse the legacy `ai-due-diligence` function: its current ownership check is seller/project-owner oriented, and its report policies are broader than the buyer-private requirement.

### Proposed minimal buyer-safe snapshot
If product policy later authorizes a seller audit to be shown to a buyer, create a separately reviewed, minimal snapshot that is explicitly associated with a currently visible listing. The snapshot should contain only:
- source audit ID and repository commit SHA, retained as internal provenance;
- audit completion time and collector/version identifier;
- the existing score and risk label, with the original audit scope/coverage and limitations;
- only the finding summaries specifically approved for buyer disclosure;
- a clear indication when no audit exists, it is stale, incomplete, or not authorized for display.

Never silently rerun an audit, recalculate its score, or present missing results as a clean result. A snapshot is not a new certification and does not issue a Passport.

### Authorization requirements before any implementation
1. Authenticate the buyer and re-check that the listing is visible and eligible on the server.
2. Resolve the audit-to-listing relationship from trusted database state; never trust a client-submitted audit ID as proof of access.
3. Apply a narrowly scoped server-side disclosure rule for the minimal snapshot; do not make the seller's audit row readable to the buyer.
4. Keep the buyer report and notes owned by the requesting buyer, independent of the seller's audit permissions.
5. Test with two buyers, the seller, an anonymous session, and an admin in a separate isolated no-cost environment.
6. Log authorization denials without leaking private listing, audit, or account details.

### Current disposition
This section is a design contract only. No production table, policy, grant, Edge Function, secret, or API was changed. Implementation remains blocked until an isolated, verified no-cost test environment is available and the platform owner separately approves the test changes.
