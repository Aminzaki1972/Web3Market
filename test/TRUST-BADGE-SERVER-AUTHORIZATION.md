# W3M Trust Badge — Server Authorization Boundary

Status: design contract for the isolated prototype branch only.
Scope: documentation only. No Supabase schema, Edge Function, secrets, production data, or deployment changes.

## Non-negotiable trust boundary

The browser is an untrusted display and input surface. The browser's `approval`,
`score`, `coverage`, finding counts, badge label, user ID, and commit values
must never be accepted as authoritative when issuing or changing a badge.

The prototype's local `approval === true` check is only a UI acceptance rule.
It is not an authorization control and must not be reused as server security.

## Required server-side flow

1. The audit service stores a completed audit result server-side, tied to:
   - project/listing ID;
   - immutable audit ID;
   - full Git commit SHA;
   - score and coverage;
   - unresolved Critical and High counts;
   - audit completion status and completion timestamp.
2. A Premium request references only the stored audit ID. The server reloads
   the audit record and recomputes eligibility from trusted stored values.
3. The approval endpoint authenticates the caller from a verified Supabase
   access token, then resolves authorization from trusted server-side role data
   (for example `app_metadata` or a protected role table). Never authorize from
   user-editable `user_metadata`, request-body role fields, or UI state.
4. The server verifies the caller is an authorized administrator and that the
   audit is still eligible: completed, score 90–100, exactly 100% coverage,
   zero unresolved Critical/High findings, and audit commit equals the current
   project commit.
5. The server records an append-only approval event with the authenticated
   administrator ID, audit ID, project ID, timestamp, and decision. The client
   cannot choose the approver ID or timestamp.
6. Badge status is derived from trusted audit and approval records. The client
   cannot directly write `Premium Verified`.
7. Every public badge read rechecks that the audited commit is still current.
   A mismatch makes the badge stale/revoked until a fresh audit completes.
8. Repeated approval requests must be idempotent or rejected safely; an
   administrator cannot approve an ineligible or superseded audit.

## Minimum negative security tests

- Anonymous caller attempts approval: reject.
- Authenticated non-admin attempts approval: reject.
- Caller forges `is_admin`, role, approver ID, or timestamp in JSON: ignore/reject.
- Caller sends `approval: true` or `status: "Premium Verified"`: never grants a badge.
- Caller submits fabricated score, coverage, finding counts, or commit: ignore/reject.
- Audit ID belongs to another project or does not exist: reject.
- Audit is incomplete, below 90, coverage below 100%, or has unresolved Critical/High: reject.
- Current project commit differs from audited commit: reject and mark stale.
- Duplicate/replayed request: no duplicate approval event or privilege escalation.
- Approval event cannot be edited or deleted by ordinary authenticated users.

## Implementation constraints

- Keep service-role credentials server-only; never ship them to the browser.
- Enable RLS on exposed tables and grant only the minimum required access.
- Do not expose approval-event writes to `anon` or ordinary `authenticated` clients.
- Prefer a narrowly scoped server endpoint or database operation with explicit
  authorization checks; do not add a broad SECURITY DEFINER function as a shortcut.
- Log denied attempts without leaking tokens, secrets, or private audit data.
- Add automated tests for authorization, eligibility, stale commits, replay, and
  cross-project access before any production rollout.

## Release gate

This design is not implemented or deployed. Before implementation, inspect the
existing audit tables, current admin authorization model, and Edge Function
conventions in the test environment. Produce a migration and endpoint plan for
review first. Do not alter production schema, secrets, RLS policies, or deploy
without explicit owner approval.
