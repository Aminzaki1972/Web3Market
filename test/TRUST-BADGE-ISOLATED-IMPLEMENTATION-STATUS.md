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
- The public read-only endpoint issues automatic Code Audit Verified for qualifying 80–89.99 scores and withholds scores 90–100 until an approval record exists.
- A separate `w3m-trust-badge-approve` Edge Function prototype now verifies the bearer token with `auth.getUser()`, requires AAL2 and `admin_users` membership, calls the independent read-only verifier, rechecks GitHub HEAD immediately before insert, and writes the approval through the service role. It is not deployed.
- Deno CI workflow added for type-checking and relevant unit tests.

## Deliberately not implemented

- The existing `admin_audit_log` is mutable and is not used as the authority for Premium approval. The new approval endpoint is a prototype only and still needs security review and CI validation.
- A dedicated Premium approval ledger migration has now been added to this feature branch only: `supabase/migrations/20261031000100_code_audit_badge_approvals.sql`. It binds each approval to one completed 90–100 audit, exact commit SHA, project, authorized `admin_users` actor, event ID, timestamp, and required rationale. Client roles have no table privileges; `service_role` is limited to SELECT/INSERT; row-level UPDATE/DELETE are blocked by a trigger.
- The migration has NOT been applied to any database. The trigger verifies admin membership and audit binding; the new Edge Function checks AAL2 after `auth.getUser()`. A database table/trigger alone cannot prove MFA assurance.
- No secret, production deployment, or live data was changed.
- No change to the production Supabase Edge Function or live data.

## Required next gate

The migration file is staged on this isolated branch and needs independent SQL review plus disposable-Postgres migration tests. A separate, explicitly approved step would be required to apply it to any Supabase database. The Premium approval Edge Function must pass CI and independent security review before any deployment; it enforces authenticated admin membership and AAL2, re-checks the current GitHub commit at approval time, and writes through the service role. The isolated endpoint must pass Deno CI before any deployment is considered.
