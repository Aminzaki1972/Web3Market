# AI Review Fallback — Safe Validation Checklist

This checklist applies to PR #52 (`fix/clarify-ai-review-fallback`).

## Scope and safety
- [ ] Keep the change on the PR branch until review is complete.
- [ ] Do not deploy `ai-review-project` or publish `admin-review.html` as part of this checklist.
- [ ] Use a disposable test project and a non-production test environment for any runtime checks.
- [ ] Do not approve or reject a real seller listing just to test the fallback.

## Static review
- [ ] Confirm fallback mode is set to `rules_fallback` whenever OpenAI is unavailable or the request/response fails.
- [ ] Confirm fallback summary explicitly says it is a completeness estimate, not independent evidence review or a code-security audit.
- [ ] Confirm fallback confidence is fixed at 25 and risk is `unknown`, rather than being inferred from completeness score.
- [ ] Confirm fallback valuation fields remain null and methodology is `insufficient_evidence`.
- [ ] Confirm the admin UI labels `rules_fallback` as a completeness estimate and shows a warning.
- [ ] Confirm OpenAI-success presentation and existing listing workflow paths are otherwise unchanged.

## Runtime tests — only in a disposable test environment
1. **OpenAI success:** with a valid test key, confirm mode is `openai_evidence_review` and the model result is stored.
2. **No API key:** confirm the request completes through fallback, with mode `rules_fallback`, confidence 25, risk `unknown`, and no numeric valuation.
3. **Provider failure:** simulate timeout, non-2xx response, empty output, and invalid JSON; each should safely use fallback.
4. **Required-field validation:** submit an intentionally incomplete payload and confirm validation fails clearly without writing a misleading review.
5. **Duplicate request:** repeat the same review fingerprint and confirm the existing result is returned without a second write.
6. **Atomic commit failure:** simulate a failed commit in the test environment and confirm the endpoint reports failure rather than claiming a successful review.
7. **Admin UI:** verify the fallback label and warning are visible in full project details on mobile and desktop.
8. **Workflow regression:** confirm test listings remain in the existing test-review flow and no listing is automatically published.

## Release gate
Do not merge or deploy until static review is complete, available checks are understood, runtime tests are recorded, and the owner explicitly approves the release. GitHub currently reports no workflow runs or commit statuses for the PR head, so the absence of CI results must not be interpreted as a passing test suite.
