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

- No Premium approval write path. The existing `admin_audit_log` is mutable and is not sufficient as the sole authority for Premium approval.
- No new table, migration, trigger, RLS policy, secret, or production deployment.
- No change to the production Supabase Edge Function or live data.

## Required next gate

A dedicated Premium approval ledger requires a reviewed database migration and access controls. This needs explicit approval before any migration is applied. The isolated endpoint must also pass Deno CI before any deployment is considered.
