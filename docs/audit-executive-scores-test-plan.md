# W3M Executive Audit Scores — Review & Test Plan

## Scope
This branch adds two additive metrics to the existing AI-assisted repository audit:
- `scalability_score`: static source-code estimate only; not a load/performance test.
- `ai_fit_score`: conservative estimate based on explicit evidence in the repository; a low/zero score is not proof that a project cannot benefit from AI.

The existing seven score fields and the overall-score weighting remain unchanged. Historical records may keep NULL in the new columns.

## Required checks before merge/deploy
1. Apply `supabase/migrations/20261023000100_add_audit_executive_scores.sql` to a non-production/test database first.
2. Verify both columns exist and accept NULL or integers 0–100; reject out-of-range values.
3. Run a new audit for a clearly AI-focused public repository and check that both new scores are present and the evidence is explained in the summary.
4. Run a new audit for a repository with no visible AI functionality; confirm AI-Fit is conservative and uncertainty is not represented as verified fact.
5. Run a non-Web3 and a Web3 repository; confirm the seven legacy scores, overall score, findings, and existing audit history remain intact.
6. Verify old audit records render a dash for missing new values.
7. Verify no website traffic, user counts, production performance, or load-test results are inferred from static code.
8. Review findings and file/line evidence manually. AI-generated findings and scores are not a security certification.

## Safety
Do not deploy the Edge Function or apply this migration to production until review and test checks pass. This branch is not evidence that the live site or live database has changed.
