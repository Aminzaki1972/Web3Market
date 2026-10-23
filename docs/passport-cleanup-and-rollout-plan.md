# W3M Passport Reset — Cleanup and Rollout Plan

Status: implementation branch only. No production records have been deleted and no Edge Function has been deployed by this change.

## Goal

Retire public external-only Passport issuance. Official Passport pages and the directory should represent approved Web3Market marketplace projects only. A project URL is stable and tied to the marketplace project UUID; selling or withdrawing a listing must not erase its project identity or technical audit history.

## Read-only production inventory checked on 2026-10-23

- `external_passports`: 41 rows
- `external_passport_snapshots`: 52 rows
- `external_passport_changes`: 0 rows
- `external_passport_monitors`: 0 rows
- `project_identities`: 36 rows
- `project_identity_aliases`: 100 rows
- `saved_searches`: 0 rows
- `projects`: 6 rows
- `code_audits`: 22 rows
- `code_audit_files`: 553 rows
- `code_audit_findings`: 73 rows

Three project identities are directly referenced by marketplace projects (Student Battle KHP, Web3Swap, Lumina). These identities must not be deleted. The existing external Passport rows do not currently reference those three identities. The `projects.w3m_identity_id` foreign key uses NO ACTION, so identity cleanup must never delete a linked identity.

## Proposed production cleanup, after a separate backup and validation

1. Export or otherwise back up the target rows and relevant identifiers before destructive operations.
2. Delete the 41 external-only Passport records. Their snapshots are configured to cascade from `external_passports`; verify the post-delete count rather than assuming the cascade.
3. Delete the 33 `project_identities` that are not referenced by `projects.w3m_identity_id`, only after checking all remaining foreign-key references. Their `project_identity_aliases` cascade on identity deletion. Do not delete the three identities linked to marketplace projects.
4. Confirm `saved_searches` remains empty; check whether any additional search traces exist in other tables before claiming all search history is removed.
5. The 21 legacy generated Passport pages, static registry JSON, registry generator, and sync/monitor workflows have been removed from this implementation branch. After merge/deploy, verify the public host no longer serves those old paths.
6. Keep all technical audit data and the independent code-audit service: `code_audits`, `code_audit_files`, and `code_audit_findings` are explicitly out of scope for deletion.
7. Keep marketplace project, seller, deal, verification, due-diligence, valuation, support, and transaction records unchanged.

## Application changes in this branch

- The AI Project Passport page no longer exposes a general external-search button.
- The new loader queries approved active/sold marketplace projects, excludes test-mode listings, and renders an official project record without calling the external Passport research/persistence endpoint.
- The directory is populated from approved marketplace projects rather than a hard-coded registry fallback. If the live query fails, it shows an error instead of resurrecting old external records.
- The technical code audit remains a separate service and is linked from the Passport page.
- The external persistence Edge Function is changed in source to return HTTP 410 for new external-only Passport persistence requests. This source change is not deployed by this branch.

## Verification checklist before merge/deployment

- Check query access against the production schema and confirm only approved, non-test active/sold projects appear.
- Verify exact-name search, UUID lookup, sold listing, no-match, ambiguous match, and database-unavailable states.
- Verify old static URLs do not leak old records after the public cleanup is approved.
- Confirm audit tables and existing project identities remain unchanged.
- Deploy the Edge Function only through the repository's reviewed deployment workflow after merge; do not run direct production SQL as part of the code PR.
