# W3M Trust Badge — Existing Supabase Mapping & Implementation Plan

Status: read-only inspection notes and proposed design for the isolated prototype branch.
Date inspected: 2026-10-31.
No database, RLS, secrets, Edge Function, production data, or deployment changes were made.

## Existing schema facts observed

The production Supabase project currently has these relevant structures:

- `code_audits`: includes `id`, `project_id`, `requested_by`, `repo_url`, `repo_owner`, `repo_name`, `branch`, `commit_sha`, `status`, `files_scanned`, `coverage_score`, `overall_score`, `critical_count`, `high_count`, `completed_at`, and other score/progress fields.
- `code_audit_files`: includes `audit_id`, `path`, `sha`, and `scanned`.
- `code_audit_findings`: includes `audit_id`, `severity`, and `status`, as well as evidence and location fields.
- `admin_users`: contains `user_id` and `created_at`; RLS is enabled. Its observed policy permits an authenticated user to read only their own membership row.
- `admin_audit_log`: already exists with `actor_id`, `category`, `action`, `target_type`, `target_id`, `details`, `outcome`, and timestamps.

The audit tables have owner-or-admin SELECT policies. Finding severity is constrained to critical/high/medium/low/info and finding status to confirmed/likely/needs_verification; there is no resolved status. A read-only grouped inspection found Critical and High findings currently present, so the platform's strict zero-Critical/zero-High rule would block any audit containing them. The audit function currently performs an explicit Supabase user lookup using `auth.getUser()`, then creates/updates audit rows using its server-side service-role client. The deployed function metadata reported `verify_jwt=false`; the handler's explicit user verification is therefore an important existing control and must not be removed casually.

## Important unknowns — do not assume

1. The exact meaning and calculation guarantees of `coverage_score` must be confirmed from the audit completion path before it is accepted as the badge's 100% coverage value.
2. Finding status is constrained to `confirmed`, `likely`, and `needs_verification`; there is no `resolved` status in the current table constraint. Therefore every Critical or High finding currently blocks verification. Remediation should be demonstrated by a fresh completed audit, not by assuming a finding can be marked resolved in place.
3. The current project/listing-to-repository binding must be revalidated. A stored `project_id` alone does not prove that a later repository URL still belongs to that listing.
4. `admin_audit_log` has RLS enabled, but the inspection found no table policies and no non-internal triggers. This means ordinary client roles have no policy-based access, but it does not prove append-only behavior for privileged server/service-role writers. It is not yet suitable as the authoritative Premium approval ledger without inspecting grants and every privileged write path.
5. The current branch head must be fetched from GitHub at approval/read time. A saved audit commit SHA is an immutable historical snapshot, not proof that it is still the listing's current code.

## Proposed trusted eligibility calculation

The server should load the audit by ID and derive all eligibility values from stored records:

- audit belongs to the expected project/listing and its repository identity matches the listing's currently verified GitHub repository;
- audit status is exactly the canonical successful terminal status;
- score is finite and within 0..100;
- coverage is exactly 100 only after confirming the coverage denominator and skipped/unreadable file handling;
- unresolved Critical count = 0 and unresolved High count = 0, recomputed from findings using a documented canonical status allowlist;
- commit SHA is a full valid SHA and equals the current head SHA for the verified repository branch;
- audit has a completion timestamp and all required audit/file/finding persistence steps succeeded.

Do not trust client-supplied score, coverage, counts, current commit, project ID, approver ID, role, timestamp, badge name, or approval boolean.

## Proposed badge state machine

- `not_eligible`: failed/incomplete audit or any technical gate fails.
- `verified`: score 80..<90 and all standard technical gates pass.
- `premium_pending`: score 90..100 and all technical gates pass, but no valid admin approval exists.
- `premium_verified`: score 90..100, all gates pass, and a valid server-recorded admin approval exists for this exact audit + commit.
- `stale`: current GitHub branch head differs from the audit commit. Do not display either verified badge.
- `revoked`: an authorized server-side revocation event exists; retain the history rather than overwriting approval evidence.

The existing prototype's browser approval toggle is illustrative only and must never be connected directly to a production badge write.

## Recommended implementation sequence (not executed)

1. Confirm finding status constraints and the audit completion/persistence code path.
2. Confirm project repository binding and how approved listings are identified.
3. Inspect `admin_audit_log` write permissions and append-only guarantees.
4. Write a migration proposal for a dedicated approval/event record only if existing structures cannot safely meet the requirements. Include unique/idempotency constraints for one approval decision per audit/version.
5. Implement a narrowly scoped server endpoint that verifies the JWT with `auth.getUser()`, checks `admin_users` server-side, reloads all audit facts, recomputes eligibility, fetches current GitHub HEAD, and records the authenticated actor from the verified session.
6. Expose a read-only badge projection. Public reads must compare current HEAD and derive state; clients never write badge state.
7. Add automated negative tests before any rollout.

## Required security and regression tests

### Authentication and authorization
- no Authorization header / invalid JWT -> 401;
- authenticated non-admin -> 403;
- admin identity is taken from verified JWT subject and `admin_users`, never request JSON;
- forged `is_admin`, `role`, `actor_id`, `approved_by`, `approved_at` are ignored/rejected;
- service-role key never appears in browser assets, responses, logs, or client configuration.

### Audit eligibility and integrity
- nonexistent audit -> generic 404;
- audit owned by a different project/listing -> reject;
- incomplete, failed, paused, or queued audit -> reject;
- score 79.99 -> no standard badge; 80 -> standard badge; 89.99 -> standard badge;
- score 90 without approval -> Premium pending; 90 with valid approval -> Premium;
- score <0, >100, null, NaN-like or malformed values -> reject;
- coverage 99.99 -> reject; 100 -> eligible only if denominator and skipped-file rules pass;
- any unresolved Critical or High finding -> reject;
- unknown finding status -> fail closed until explicitly classified;
- missing/invalid commit SHA -> reject;
- current GitHub HEAD differs from audit SHA -> stale, no verified badge;
- repository URL changed or no longer matches the listing -> reject.

### Approval ledger and replay
- ordinary user cannot insert/update/delete approval events;
- admin approval event records server-derived actor, server timestamp, audit ID, project ID, commit SHA, decision and reason;
- repeated identical request is idempotent and does not create duplicate approvals;
- replay against a different audit/project/commit is rejected;
- revocation creates a new event and preserves previous approval history;
- failed database write means no Premium badge is returned.

## Release boundary

This document is a design plan only. No migration or endpoint has been created. Do not change production schema, RLS, secrets, Edge Functions, Cloudflare configuration, or deployment until the owner explicitly approves a reviewed implementation plan.
