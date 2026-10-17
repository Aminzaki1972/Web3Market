# Admin Listing Monitoring — Safe Implementation Plan

## Status
Controlled release in progress, explicitly authorized by the platform owner in chat on 2026-10-18. The `admin-review` Edge Function was deployed as version 34 with `verify_jwt=true`; no database schema or data changes were made. The monitoring page remains separate and is not linked from the live admin menu. The PR must still be merged to publish the page and retain the source in the repository. Authenticated integration tests with a real administrator and a non-admin account remain unverified.

## Findings from current implementation
- The existing `admin-review.html` calls the deployed `admin-review` Edge Function and has existing approve, test-approve, request-changes, and reject actions.
- The current review queue is narrower than a full submission-monitoring center; it is not sufficient to infer that every saved draft or failed submission is visible.
- `sell-project.js` keeps a local draft snapshot in browser `localStorage`. A draft that never reaches the server cannot be viewed from an administrator's separate device.
- `ai-review-project` uses an OpenAI review when available and a deterministic rules fallback if that review fails. The monitoring UI must show the actual recorded mode/status rather than label every result as an AI review.
- `ai_due_diligence_reports` contains report status and error fields, but these records only help for attempts that are actually written to that table.
- The deployed `admin-review` Edge Function source was not found at the expected path in the default GitHub branch. Establish source-of-truth and compare deployed code before changing the function.

## Proposed read-only monitoring response
Add a separately reviewed `monitoring` action to the admin Edge Function. It should return bounded, paginated records for:
1. Persisted projects with status, project_status, ai_status, timestamps, score, and only the nested AI review mode needed to distinguish OpenAI review from rules fallback.
2. AI due-diligence reports with status, engine version, score, risk level, error message, and completion timestamps.
3. Verification requests with status and review timestamps only; exclude free-text notes and reviewer IDs from this monitoring response.

Do not return secrets, raw authentication material, full private evidence values, free-text admin notes, free-text verification notes, reviewer IDs, or unnecessary personal data. The preview must not expose the full `verification` JSON object merely to display the AI review mode. Require a valid user session and an `admin_users` membership check for every request. Use explicit selected columns, a maximum page size, stable ordering, and server-side filtering.

## Failed save observability
A browser-only draft save failure is not server-visible. Add a separate, minimal server-side event endpoint only after security review. It should accept a small enumerated event type, a generated correlation ID, safe stage/error codes, and timestamps; do not accept arbitrary full form payloads or secrets. Apply rate limiting and retention limits. Verify RLS/service-role boundaries before implementation.

## UI requirements
- Summary counts: persisted drafts, awaiting admin review, AI review failed, AI fallback used, verification pending.
- Filters: state, date range, and project ID.
- Each row should show last known stage, timestamp, safe error explanation, and next action.
- Distinguish "not recorded" from "no failure".
- Keep existing review actions unchanged and behind existing admin authorization.
- Display that local-only drafts cannot be seen by admins until a server event is recorded.

## Branch-preview security refinements
- The current branch implementation removes `admin_notes` from the monitoring project select and removes free-text `notes` plus `reviewed_by` from verification requests.
- The project table exposes only `verification->ai->>mode` as `ai_mode`; it labels `openai_evidence_review` as OpenAI, `rules_fallback` as Rules fallback, and missing values as Not recorded.
- These changes have been committed only to `feature/admin-listing-monitoring`. The live Edge Function and production database have not been changed.
- The nested JSON selector still requires an authenticated non-production integration test before merge; the GitHub branch page is not a runnable preview and production CORS allows only `https://web3market.xyz`.

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

## Static verification checkpoint — 2026-10-18

- The branch preview now includes separate counters for `rules_fallback` and missing/unrecorded AI review mode. Both are calculated only from the bounded project rows returned by the monitoring action; they are not platform-wide totals.
- Static source review confirmed that the monitoring action checks the authenticated user against `admin_users` before selecting records, caps the requested page size at 100, and selects explicit fields. No write operations occur inside the monitoring action.
- The selected database fields were cross-checked against the current project's `information_schema.columns`; the referenced project, due-diligence report, and verification-request columns exist.
- A read-only production snapshot found 10 due-diligence report rows, all marked completed at the time of the check; 5 project rows recorded `rules_fallback`, and 1 project row had no recorded AI mode. These are point-in-time observations, not permanent acceptance criteria.
- Important deployment blocker: the currently deployed `admin-review` Edge Function is version 33 and does not contain the `monitoring` action, while the branch source does. Therefore the branch preview cannot successfully use the currently deployed endpoint until a reviewed deployment occurs. No deployment was performed.
- The `ai-review-project` Edge Function is active at version 45 with JWT verification enabled. No changes were made to it.
- Still unverified: authenticated integration tests for non-admin denial, PostgREST JSON selector behavior, rendered UI with a real admin session, and preservation of existing review actions. Do not merge or deploy until those checks are completed and the owner approves.

## AI review logic audit — 2026-10-18 (source review only)

The active `ai-review-project` version 45 source matches the repository copy at `supabase/functions/ai-review-project/index.ts`. No function deployment or database write was performed.

### Findings to resolve before calling the review a due-diligence score

1. **Fallback confidence is not evidence confidence.** The deterministic fallback currently sets `confidence_score` to the clamped overall completeness-minus-penalty score. That makes a high-completeness listing appear highly certain even though the fallback does not independently verify the claims. A future change should use a clearly low/limited confidence value or a separate confidence label for rules-only results.
2. **Data gaps and weaknesses are conflated in the saved intelligence record.** The current `data_gaps` field is populated from every finding's recommendation, including findings that may describe risk or weakness rather than absent information. Split these into explicit `evidence_gaps` and `risk_findings` (or equivalent) and preserve their distinction in the UI.
3. **Fallback score is a completeness heuristic, not a substantive project-quality score.** It is computed from the presence of selected fields minus fixed finding penalties. It should be labelled as a rules-based listing-completeness check and not presented as equivalent to the OpenAI evidence review.
4. **OpenAI response parsing is strict.** Invalid JSON or a provider failure falls back to rules mode, which is safe for continuity but can silently change the nature of the review unless the UI clearly displays the mode. The monitoring preview already distinguishes `openai_evidence_review`, `rules_fallback`, and missing mode; keep that distinction visible wherever a score is displayed.
5. **Hard pre-review validation is distinct from the review result.** The endpoint returns HTTP 422 before scoring if core required listing fields are absent. These cases are validation failures, not low project scores, and are not necessarily persisted in the monitoring records.

### Recommended acceptance criteria for a separate AI-review improvement PR

- Keep the existing listing submission and admin approval flows unchanged.
- Expose separate labels for missing evidence, substantive risks/weaknesses, and input-validation failures.
- Never derive confidence directly from the overall score in rules fallback.
- Clearly label fallback scores as heuristic/completeness-based.
- Preserve `mode`, confidence, evidence gaps, and risk findings in the saved review result with backwards-compatible fields.
- Test OpenAI success, OpenAI timeout/invalid JSON fallback, incomplete required fields, duplicate request fingerprint, and failed atomic commit.
- Do not deploy or modify production data until tests and owner approval are complete.

### Atomic save / database privilege check

- Read-only inspection of `public.commit_ai_review_result` confirmed that the review result and project-intelligence upsert are handled inside one transaction; the function locks the project row and rejects a draft that is already in admin review.
- The RPC is `SECURITY DEFINER` with an empty `search_path`, and the current executable-role query returned only `service_role`, `supabase_admin`, and `postgres`. This is consistent with the Edge Function calling it through its service-role client; do not broaden direct client grants as part of this work.
- The RPC's existing `data_gaps` column receives the recommendations for every finding, confirming the finding-type conflation described above. A separate, backward-compatible change is needed to persist evidence gaps separately from substantive risks.
