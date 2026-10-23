# W3M Audit File Selection and Coverage — Test Plan

## Scope
Validate that the audit engine selects production code before test harnesses and reports coverage against the full set of eligible files, not only the capped subset.

## Required checks
1. For a repository with more than 100 eligible files, confirm production source files are selected before `tests/`, `__tests__/`, `fixtures/`, `mocks/`, `harness/`, `certora/`, `echidna/`, and `medusa/` files.
2. Confirm the 100-file fetch cap remains in place to limit edge-function runtime and external API calls.
3. Confirm `coverage_score = successfully fetched files / all eligible files in the repository tree × 100`, rounded to an integer and clamped to 0–100.
4. Confirm files larger than 200 KB and files that cannot be fetched are reflected as lower coverage and explained in the audit summary.
5. Confirm the summary reports the eligible-file total, files scanned, files beyond the cap, oversized selected files, and unreadable selected files.
6. Test a small repository where all eligible files can be fetched; expected coverage is 100%.
7. Test a repository with 120 eligible files where 100 are fetched; expected coverage is about 83%, not 100%.
8. Test a repository where one selected file is oversized or unreadable; coverage must be lower than 100%.
9. Confirm test/harness files remain eligible for later AI analysis when the file cap allows them; they are deprioritized, not blanket-excluded.
10. Verify the audit history, finding records, score fields, resume behavior, and listing/deal flows remain unchanged.

## Safety
This branch changes audit file selection and coverage reporting only. It does not deploy the Edge Function, apply database migrations, or modify the live website/database. Review the diff and run the checks above before merging or deploying.
