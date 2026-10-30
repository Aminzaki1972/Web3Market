# Buyer Due Diligence production integration — review notes

## Scope in this PR
- Adds two dedicated buyer-owned tables for saved reports and private notes.
- Adds owner-only RLS for report reads and note CRUD.
- Adds an authenticated Edge Function that checks the caller's `profiles.role = buyer`, accepts only an active marketplace project, and saves a point-in-time snapshot of the latest completed linked public-repository code audit.
- Adds a Buyer Dashboard module to create and reopen saved reports and save private notes.

## Explicit exclusions
- No writes to existing production tables.
- No changes to `w3m-code-audit`, its quota tables, or existing Edge Functions.
- No public report/share URL, no seller-facing notes, no AI Passport creation.
- No raw source files, paths, code snippets, finding evidence, seller private data, or admin notes are disclosed.
- This first integration surfaces the audit summary and finding counts only. It does not yet collect website/domain/social evidence or run a new audit.

## Review findings / known limits
- Reports are tied to a marketplace `project_id` and the most recent completed `code_audits` row whose normalized public GitHub repository URL matches the listing's `github_url` (the current production audit rows have null `project_id`).
- Projects without a completed linked audit receive a saved `missing` status; absence of an audit is not a safety signal.
- The audit snapshot is point-in-time and does not update automatically when a newer audit is completed.
- The dashboard loads up to 200 active projects and displays the latest 30 saved reports.
- CORS allows the two production Web3Market origins. Before deployment, confirm the exact canonical origin and Supabase function configuration.
- The migration is additive but has not been applied. The function is source-only and has not been deployed.

## Required pre-merge validation
1. Apply the migration only to a disposable copy/staging project first.
2. Verify authenticated buyer A can create/read a report and save/read/update/delete their own note.
3. Verify buyer B cannot read A's reports or notes and cannot modify A's notes.
4. Verify seller-role and anonymous requests are rejected.
5. Verify a missing audit creates a clearly labeled report and no positive security conclusion.
6. Verify the function exposes only the documented snapshot fields and never file paths or finding evidence.
7. Verify mobile dashboard layout, session restoration, and the existing purchases/wallet panels.
8. Run SQL lint/type checks and inspect the full diff.

## Rollback
- Disable/remove the dashboard script include first to hide the feature without affecting the existing Buyer Center.
- Redeploy/disable `buyer-dd-create` if needed.
- The new tables can remain dormant; if removal is required, export/retain any buyer notes first, then drop only `buyer_due_diligence_private_notes` and `buyer_due_diligence_reports` in a separately approved cleanup migration.
- Do not roll back or modify existing audit/deal tables.
