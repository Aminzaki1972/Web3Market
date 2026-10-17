# Admin Listing Monitoring — Safe Implementation Plan

## Status
Planning-only document. This branch must not be merged or deployed without owner review. No production database or Edge Function changes are authorized by this document.

## Findings from current implementation
- The existing `admin-review.html` calls the deployed `admin-review` Edge Function and has existing approve, test-approve, request-changes, and reject actions.
- The current review queue is narrower than a full submission-monitoring center; it is not sufficient to infer that every saved draft or failed submission is visible.
- `sell-project.js` keeps a local draft snapshot in browser `localStorage`. A draft that never reaches the server cannot be viewed from an administrator's separate device.
- `ai-review-project` uses an OpenAI review when available and a deterministic rules fallback if that review fails. The monitoring UI must show the actual recorded mode/status rather than label every result as an AI review.
- `ai_due_diligence_reports` contains report status and error fields, but these records only help for attempts that are actually written to that table.
- The deployed `admin-review` Edge Function source was not found at the expected path in the default GitHub branch. Establish source-of-truth and compare deployed code before changing the function.

## Proposed read-only monitoring response
Add a separately reviewed `monitoring` action to the admin Edge Function. It should return bounded, paginated records for:
1. Persisted projects with status, project_status, ai_status, timestamps, and safe verification summaries.
2. AI due-diligence reports with status, engine version, score, risk level, error message, and completion timestamps.
3. Verification requests with status, notes, and review timestamps.

Do not return secrets, raw authentication material, full private evidence values, or unnecessary personal data. Require a valid user session and an `admin_users` membership check for every request. Use explicit selected columns, a maximum page size, stable ordering, and server-side filtering.

## Failed save observability
A browser-only draft save failure is not server-visible. Add a separate, minimal server-side event endpoint only after security review. It should accept a small enumerated event type, a generated correlation ID, safe stage/error codes, and timestamps; do not accept arbitrary full form payloads or secrets. Apply rate limiting and retention limits. Verify RLS/service-role boundaries before implementation.

## UI requirements
- Summary counts: persisted drafts, awaiting admin review, AI review failed, AI fallback used, verification pending.
- Filters: state, date range, and project ID.
- Each row should show last known stage, timestamp, safe error explanation, and next action.
- Distinguish "not recorded" from "no failure".
- Keep existing review actions unchanged and behind existing admin authorization.
- Display that local-only drafts cannot be seen by admins until a server event is recorded.

## Acceptance tests
- Unauthorized users cannot call the monitoring action.
- An authenticated non-admin is denied.
- Admin sees only bounded persisted records and safe fields.
- An AI success, AI provider failure with fallback, database commit failure, and verification request each appear accurately when recorded.
- A client-only save failure is not falsely shown as a server-recorded event.
- Existing approve, test-approve, request-changes, and reject flows remain unchanged.
- No schema migration or production deployment occurs as part of this PR.

## Deployment gate
Before merge: locate and commit the actual deployed `admin-review` source, compare it with the live version, test in a non-production environment, review RLS and retention, then obtain explicit owner approval. This plan itself must not trigger a deployment.
