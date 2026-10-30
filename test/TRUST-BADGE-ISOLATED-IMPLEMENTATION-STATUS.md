# Trust Badge isolated implementation status

Branch: `feature/trust-badge-isolated-20261031`
Base: current `main` commit at branch creation
Status: isolated prototype only; not deployed and not merged.

## Implemented on this branch

- Pure badge eligibility policy: 80–89.99 yields automatic Code Audit Verified; 90–100 requires an independently trusted Premium approval.
- Strict evidence aggregation for every resumable audit batch.
- Audit completion now stores structured evidence in the existing `code_audits.analysis_progress` JSONB field: evidence version, non-truncated tree marker, eligible/scanned/persisted file counts, oversized and unreadable totals, pre-skipped oversized count, batch count, and all batch statistics.
- The audit worker now re-reads persisted file rows before finalization and fails closed if per-batch scanned counts do not match persisted rows.
- Critical/High totals are now computed from persisted finding rows, not only the latest in-memory AI response.
- Public read-only badge endpoint validates active/sold listing, exact GitHub repository binding, latest completed audit, structured batch evidence, persisted file count, persisted findings, and current GitHub branch HEAD.
- The endpoint only issues automatic Code Audit Verified. Scores 90–100 remain withheld because a dedicated, server-controlled Premium approval ledger does not exist yet.
- Deno CI workflow added for type-checking and relevant unit tests.

## Deliberately not implemented

- No Premium approval write path or admin approval Edge Function yet. The existing `admin_audit_log` is mutable and is not sufficient as the sole authority for Premium approval.
- A dedicated Premium approval ledger migration has now been added to this feature branch only: `supabase/migrations/20261031000100_code_audit_badge_approvals.sql`. It binds each approval to one completed 90–100 audit, exact commit SHA, project, authorized `admin_users` actor, event ID, timestamp, and required rationale. Client roles have no table privileges; `service_role` is limited to SELECT/INSERT; row-level UPDATE/DELETE are blocked by a trigger.
- The migration has NOT been applied to any database. The trigger verifies admin membership and audit binding, but AAL2 must still be verified by the future Edge Function after `auth.getUser()`; a database table/trigger alone cannot prove MFA assurance.
- No secret, production deployment, or live data was changed.
- No change to the production Supabase Edge Function or live data.

## Required next gate

The migration file is staged on this isolated branch and needs independent SQL review plus disposable-Postgres migration tests. A separate, explicitly approved step would be required to apply it to any Supabase database. The Premium approval Edge Function must then enforce authenticated admin membership and AAL2, re-check the current GitHub commit at approval time, and write through the service role. The isolated endpoint must pass Deno CI before any deployment is considered.
