# Buyer Due Diligence — implementation status

Updated: 2026-10-30

## Current work branch

- Branch: `feature/buyer-dd-clean-production-prep`
- Base: current production `main` commit `2a2abcf467622d06106459de03a3fddc58023a0d`
- Review: Draft PR #129
- Scope currently contains only six added design/preview/documentation files.
- Branch comparison: 6 commits ahead, 0 behind; 6 files added, no existing files modified or deleted.

## Isolated Supabase test project

- Project: `w3m-buyer-dd-test`
- Project ref: `nizguzhmyjodujdmoygl`
- Region: EU Central (`eu-central-1`)
- Current project health: ACTIVE_HEALTHY (last checked)
- The test schema has RLS enabled on `buyer_dd_reports` and `buyer_dd_private_notes`.
- Anonymous role has no SELECT grant on either table; authenticated role has SELECT subject to RLS.
- Ownership policies require `auth.uid() = buyer_id`; note access also verifies ownership of the parent report.
- A real authenticated test identity successfully created one fictional report and one private note.
- Latest read-only count check: 1 fictional report, 1 private note; the report is explicitly marked `audit_source_status = missing`.
- No production data or credentials are used by this project.

## Test limitation

A second real buyer identity has not yet been registered because Supabase Auth returned `email rate limit exceeded` after earlier email-send attempts. Therefore cross-account isolation has **not** been proven end-to-end with two real accounts. Existing RLS policy inspection and earlier simulated-role checks are useful but do not replace that test.

## Implementation decisions

1. Keep the buyer-private report tables separate from legacy seller-oriented `ai_due_diligence_reports`.
2. Do not query seller-owned `code_audits`, `code_audit_files`, or `code_audit_findings` directly from the buyer browser.
3. Do not loosen existing Code Audit RLS policies.
4. A future buyer-safe Code Audit summary must be a narrowly scoped server-generated snapshot tied to a currently visible listing, with provenance, commit SHA, timestamp, scope, coverage and limitations.
5. Missing, stale, incomplete or unauthorized audit data must never be represented as a clean result.
6. No public report links, public exports, AI Passport issuance, or seller-visible private notes.

## Next release gates

- [ ] Allow the Auth email rate limit to recover; create a second real test buyer without bypassing Auth protections.
- [ ] Verify Buyer B cannot read Buyer A's report or note by direct API access and guessed UUID.
- [ ] Verify seller and anonymous sessions cannot read either resource.
- [ ] Run Supabase Security Advisor and address the test project's leaked-password-protection warning only after a separate decision.
- [ ] Implement and test the server-side report API and minimal audit-disclosure boundary in the isolated project.
- [ ] Review the final production migration and function source.
- [ ] Obtain explicit approval before any production schema, RLS, Edge Function, secrets, Cloudflare, or live UI change.

## Explicit non-actions

No production database, RLS policy, Edge Function, secret, Cloudflare setting, live dashboard, or production deployment has been changed as part of this status update. PR #129 remains Draft and must not be merged in its current design-only state.
