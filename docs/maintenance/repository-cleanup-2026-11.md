# Repository cleanup — 2026-11

## Scope and safety boundary

- Repository: `Aminzaki1972/Web3Market`
- Cleanup branch: `chore/repository-cleanup-2026-11`
- Baseline commit: `64d0fddacc1df957e3f78b12b29a322323c9aafa`
- Production `main`, live website, Supabase production project, and legacy Git branches are intentionally unchanged.
- No wallet, Safe, payment, deal-room, RLS, Edge Function, or production migration behavior was deleted or rewritten as part of this cleanup pass.

## Baseline inventory

At the baseline commit, the repository tree contained 561 tracked files:
- 346 files under `supabase/`
- 55 files under `js/`
- 54 files under `docs/`
- 17 GitHub Actions workflows
- 61 files at repository root

The project is a static-site application with Supabase Edge Functions and Deno-based checks. No root `package.json` was present, so a Node package manifest was not invented. A Git-object scan found no exact duplicate file blobs, zero-byte files, oversized files above 500 KB, or committed dependency/build/cache directories.

## Changes made in this pass

1. Added a conservative root `.gitignore` for local environment files, dependency/build output, local Supabase state, editor files, and logs. It does not ignore source, migrations, functions, or tests.
2. Removed an old 80.35/100 LOW RISK badge from README and relabeled the associated scan as historical. The prior scan targeted a different commit and must not be represented as a current audit.
3. Corrected the isolated protocol workflow's disposable-PostgreSQL setup: it now applies `20261106000100_w3m_protocol_v1_acquisition_verification.sql` before the later migration that hardens the trigger function created by it. The migration was also added to both push and pull-request path filters.
4. Corrected double-escaped shell grouping in the timestamp-sorted migration-order check. The first explicit PostgreSQL migration/test step passed after item 3; the second all-migrations check exposed this shell syntax issue, which is now corrected and awaiting rerun.

## Findings requiring further review

- The previous isolated protocol workflow failed because `20261117085142_harden_acquisition_event_trigger_search_path.sql` altered `public.w3m_reject_acquisition_event_mutation()` before the disposable database had applied the migration that creates that function. This is a test-fixture/migration-sequence defect; it is not evidence that production data should be changed.
- Three MFA-related root pages exist. `admin-review.html` directly redirects to `admin-mfa.html`, and both `admin-mfa.html` and `admin-mfa-v2.html` are included in a security workflow's path filters. They are therefore retained until the authentication flow and inbound links are fully mapped.
- Diagnostic pages and the Safe diagnostic script are retained. Their operational status and references need a full call-site audit before removal.
- The Future Lab contains a likely duplicate-topic pair: `future-ai-agents-blockchain.html` and `future-lab-ai-agents.html` cover AI agents and blockchain. The older-looking URL is not linked from the Future Lab index or current sitemap, while the newer page is linked from the index. Keep both temporarily; assess analytics/backlinks before converting the older URL into a canonical redirect/retired-page notice.
- No `package.json` was added because the root app is not a conventional Node build and adding one without a verified build/test contract would create misleading tooling.

## Deletion policy

No source file is deleted solely because a repository search did not find a reference. Before deleting or moving any page/module, verify:
1. HTML, JavaScript, TypeScript, CSS, workflow, sitemap, manifest, and service-worker references.
2. Dynamic URL construction and server-side references.
3. External links/bookmarks and published canonical URLs where applicable.
4. Whether the file is a diagnostic or recovery path used during incident response.

## Validation still required

- Confirm the corrected workflow rerun completes, including both disposable PostgreSQL migration checks.
- Run the repository's available audit, security, and application tests on this branch.
- Review remaining root-level pages and duplicated implementations with explicit dependency evidence.
- Open a pull request for review; do not merge to `main` or deploy to production as part of this cleanup pass.
