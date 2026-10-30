# W3M Trust Badge — Server Endpoint Contract

Status: design specification only. Not deployed, not connected to the production audit function, and does not authorize database or secret changes.

## Security boundary

The browser is an untrusted client. It may request a badge decision, but it must never submit authoritative audit evidence, a current commit SHA, an admin identity, or a Premium approval and have those values accepted as truth.

The `evaluateTrustBadge` helper is a pure policy function. Its `source: "server"` field is only a typed contract marker; it is not proof that an approval came from a server. Only the endpoint may construct the approval object, after independently loading and validating the approval record.

## Proposed request

- Authenticated user session (Supabase access token).
- `audit_id` only.
- No client-supplied score, finding counts, file counts, commit SHA, badge type, actor ID, or approval payload.

## Required server sequence

1. Validate the bearer token and resolve the user with Supabase Auth `getUser(token)`. Reject missing, invalid, or expired sessions.
2. Resolve the caller's authorization from the trusted server-side admin membership source already used by the application. Do not trust user-editable profile fields, request headers, local storage, or client claims. Reuse the existing authorization policy; do not invent a new admin allowlist.
3. Load the audit row by `audit_id` from the database. Confirm it belongs to the expected repository/project and that the requesting user is allowed to view/request this result.
4. Require a completed audit and validate the stored audit ID, score, commit SHA, and status.
5. Obtain the current commit SHA from GitHub using the server-held credential, for the exact repository and branch/ref associated with this audit. Never accept the current SHA from the browser.
6. Load persisted per-file audit records and independently count them. Compare the persisted count with the eligible-file count and files-scanned count. Require positive integer counts, exact equality, and zero oversized/unreadable eligible files. Do not rely on rounded `coverage_score` or parse human-readable summary text.
7. Load findings from the persisted findings table and independently count Critical and High findings using the canonical severity values. Any Critical or High finding blocks the badge.
8. Construct `AuditEvidence` from these server-loaded values and call `evaluateTrustBadge`.
9. For scores from 90 through 100, load the Premium approval event from a server-controlled approval store. Verify it is approved, refers to the same audit ID and commit SHA, and has a non-empty trusted actor and event ID. The endpoint must not accept a client-provided approval object.
10. Return a minimal decision: badge type (or none), reason code, audit ID, audited commit SHA, current commit SHA, score, and decision timestamp. Do not expose secrets or internal authorization data.

## Premium approval requirements

- Approval action requires a fresh authenticated admin session and server-side admin authorization.
- The approval endpoint must re-read the audit and current commit at approval time, then bind the approval to that exact audit ID and commit SHA.
- Record actor ID, event ID, timestamp, decision, audit ID, and commit SHA.
- Deny direct browser INSERT/UPDATE/DELETE access to approval records.
- Do not describe a table as immutable or append-only merely because RLS is enabled. A service-role credential can still mutate rows. If tamper-evidence is required, design a separately reviewed append-only mechanism and operational controls.
- Revoke or supersede approval when the audited commit changes; the next decision must fail closed.

## Failure behavior

Fail closed for missing rows, incomplete audit state, missing file evidence, malformed/negative/non-integer counts, GitHub lookup errors, truncated repository tree, commit mismatch, Critical/High findings, missing approval, or authorization errors. Return stable reason codes without silently downgrading failed verification into an eligible badge.

## Acceptance tests before any deployment

- Anonymous, expired-token, and non-admin requests are rejected.
- Client attempts to inject score, file counts, severity counts, commit SHA, actor ID, or Premium approval have no effect.
- Audit ID from another project/repository is rejected.
- 999/1000 files is rejected even if a rounded metric displays 100%.
- Missing persisted file rows, oversized files, unreadable files, truncated GitHub tree, and GitHub API failure are rejected.
- Any Critical or High finding is rejected.
- A changed commit invalidates both automatic and Premium eligibility.
- Score 80–89.99 grants only Code Audit Verified.
- Score 90–100 never grants Premium without a matching server-loaded approval event.
- Approval for another audit or commit is rejected.
- Approval attempts by non-admin users are rejected and logged.
- Repeated requests are safe and do not create duplicate approval events.

## Explicitly out of scope

This document does not create migrations, tables, policies, triggers, secrets, Edge Functions, endpoints, or deployments. It does not change `w3m-code-audit` or any production data. Those steps require separate review and explicit approval.
