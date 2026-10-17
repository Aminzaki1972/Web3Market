# AI Review Fallback — Safe Validation Checklist

This checklist applies to PR #52 (`fix/clarify-ai-review-fallback`).

## Scope and safety
- [x] Keep the change on the PR branch until review is complete.
- [x] Do not deploy `ai-review-project` or publish `admin-review.html` as part of this checklist.
- [ ] Use a disposable test project and a non-production test environment for any runtime checks.
- [x] Do not approve or reject a real seller listing just to test the fallback.

## Static review
- [x] Confirm fallback mode is set to `rules_fallback` whenever OpenAI is unavailable or the request/response fails.
- [x] Confirm fallback summary explicitly says it is a completeness estimate, not independent evidence review or a code-security audit.
- [x] Confirm fallback confidence is fixed at 25 and risk is `unknown`, rather than being inferred from completeness score.
- [x] Confirm fallback valuation fields remain null and methodology is `insufficient_evidence`.
- [x] Confirm the admin UI labels `rules_fallback` as a completeness estimate and shows a warning.
- [x] Confirm the GitHub Actions static check completed successfully for the reviewed PR head.
- [ ] Confirm OpenAI-success presentation and existing listing workflow paths with runtime regression tests.

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
Do not merge or deploy until runtime tests are recorded, all available checks are understood, and the owner explicitly approves the release. The static checks passed in GitHub Actions run [#39072159757](https://github.com/Aminzaki1972/Web3Market/actions/runs/39072159757), but runtime/integration tests have not been run. Passing static checks alone is not a production release approval.
