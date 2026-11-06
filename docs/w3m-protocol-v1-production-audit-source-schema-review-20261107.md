# W3M Protocol V1 — production Code Audit source schema review (2026-11-07)

## Scope and safety

This review used Supabase schema metadata only for the production project named `web3market` (Postgres 17, `eu-west-1`). It did not select application rows, user records, report contents, wallet data, or deal data. No SQL writes, DDL, migrations, deployments, or configuration changes were performed.

## Verified source tables

### `public.code_audits`

- Primary key: `id uuid`.
- Relevant columns present: `repo_url`, `repo_owner`, `repo_name`, `commit_sha`, `status`, `completed_at`, `engine_version`, `analysis_progress`, `files_scanned`, and severity counters.
- Foreign keys include `project_id -> projects(id)`, `requested_by -> auth.users(id)`, and `payment_order_id -> audit_payment_orders(id)`.
- The production table has a primary-key index on `id`; repository/commit and project/time indexes are also present.

### `public.code_audit_files`

- Primary key: `id uuid`.
- `audit_id uuid NOT NULL` references `code_audits(id)` with `ON DELETE CASCADE`.
- `path text NOT NULL`.
- Existing indexes include indexes on `audit_id`; there is no unique path constraint.

### `public.code_audit_findings`

- Primary key: `id uuid`.
- `audit_id uuid NOT NULL` references `code_audits(id)` with `ON DELETE CASCADE`.
- Relevant fields: `severity`, `category`, `title`, `file_path`, `line_start`, `line_end`, `status`, `created_at`.
- Existing indexes include `(audit_id)` and `(audit_id, severity)`; there is no unique natural-key constraint on findings.

## Pagination conclusion

Both child tables have a real unique UUID primary key. Offset pagination must therefore use a stable, total order:
- Files: `path ASC, id ASC`.
- Findings: `file_path ASC, line_start ASC, severity ASC, category ASC, title ASC, id ASC`.

The final `id` order is the unique tie-breaker. Ordering only by `created_at` or by non-unique natural-key fields is insufficient to guarantee stable page boundaries when values tie.

The isolated branch adapter and its test were updated to apply and assert these orders. The manifest still performs its own locale-independent natural-key sorting and rejects duplicate normalized natural keys after all pages are loaded.

## Immutability and access-control observation

The production metadata currently shows:
- RLS enabled on all three source tables.
- Authenticated SELECT policies scoped to the audit owner or an admin.
- No non-internal triggers attached to these three tables at the time of this review.
- `service_role` has table-level SELECT, INSERT, UPDATE, and DELETE privileges on the source tables.

Consequently, the completed-audit immutability trigger migration present on the isolated protocol branch is **not active in production**. A protocol implementation must not assume that production source rows are immutable until that guard is separately reviewed, tested, and deliberately deployed. This review did not deploy it.

## Protocol deployment status

The production migration registry currently ends at `20261103065424` (`audit_v2_guest_checkout`). It does not contain the W3M Protocol V1 migrations dated 2026-11-06/07. A schema-only catalog check also returned no `public.w3m_*` base tables. The protocol work therefore remains isolated in GitHub and is not live in production.

## Next implementation requirements

1. Keep the stable primary-key tie-breaker on both paginated child-table reads.
2. Add tests for both page readers and run the isolated workflow to completion.
3. Preserve the completed-audit immutability guard as a required prerequisite for trusting a recomputed source manifest at signing/settlement boundaries.
4. Implement the independent pre-agreement deal audit snapshot registry using the verified source schema; the first deal must not depend on a previously issued acquisition report.
5. Keep all protocol migrations isolated and settlement disabled until separately reviewed and explicitly approved.
