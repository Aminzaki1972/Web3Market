# Repository cleanup — 2026-11

## Scope and safety boundary

- Repository: `Aminzaki1972/Web3Market`
- Cleanup branch: `chore/repository-cleanup-2026-11`
- Baseline commit: `64d0fddacc1df957e3f78b12b29a322323c9aafa`
- The final `main` tree has been restored to the exact baseline tree SHA `f4f14ce8358b3cf894166ee57d69e54ba7139d54`; legacy Git branches are untouched.
- No active wallet, Safe, payment, deal-room, RLS, Edge Function, or production migration behavior was deleted or rewritten. Six unreferenced legacy browser scripts were removed; the project view counter was restored after its active `<script>` reference was discovered in `project.html`.
- Transparency: documentation-only updates were briefly committed to `main` twice by the file-update wrapper despite a branch argument. The first was reverted in `9c16b7603db0481ea7ef59fe3e99bdd475b66328`; the later update was removed in `390ca09baccf45526ffae573465f794e3ef655bf`. `main`'s final tree SHA is exactly the baseline. No application/runtime code, deal logic, migrations, or Supabase resources changed in those transient documentation commits; Cloudflare's handling of those brief commits could not be independently verified.

## Baseline inventory

At the baseline commit, the repository tree contained 561 tracked files:
- 346 files under `supabase/`
- 55 files under `js/`
- 54 files under `docs/`
- 17 GitHub Actions workflows
- 61 files at repository root

The project is a static-site application with Supabase Edge Functions and Deno-based checks. No root `package.json` was present, so a Node package manifest was not invented. A Git-object scan found no exact duplicate file blobs, zero-byte files, oversized files above 500 KB, or committed dependency/build/cache directories.

After the latest cleanup edits, the branch contains 555 tracked files: 346 under `supabase/`, 50 under `js/`, 55 under `docs/`, 15 GitHub Actions workflows (down from 17), and 51 root-level HTML pages. Six unreferenced legacy JavaScript files were removed; `.gitignore` and the maintenance report account for two additions.

## Changes made in this pass

1. Added a conservative root `.gitignore` for local environment files, dependency/build output, local Supabase state, editor files, and logs. It does not ignore source, migrations, functions, or tests.
2. Removed an old 80.35/100 LOW RISK badge from README and relabeled the associated scan as historical. The prior scan targeted a different commit and must not be represented as a current audit.
3. Corrected the isolated protocol workflow's disposable-PostgreSQL setup: it now applies `20261106000100_w3m_protocol_v1_acquisition_verification.sql` before the later migration that hardens the trigger function created by it. The migration was also added to both push and pull-request path filters.
4. Corrected double-escaped shell grouping in the timestamp-sorted migration-order check. The complete isolated protocol workflow rerun `44079080578` completed successfully: 110 steps, no failed steps. The GitHub Actions result is available at https://github.com/Aminzaki1972/Web3Market/actions/runs/44079080578.
5. Removed two obsolete push-triggered automation workflows: `fix-seller-entry.yml` and `fix-web3market-logo.yml`. Both ran on every push to `main`, had `contents: write`, rewrote site files, and pushed commits automatically. Their intended one-time changes are not suitable as permanent push automation; the actual current homepage and hero asset remain untouched by this cleanup branch.
6. Corrected the extra-escaped six-digit TOTP regex in `admin-mfa-v2.html`, matching the working `admin-mfa.html` behavior. This prevents valid 6-digit authenticator codes from being rejected by the v2 page.
7. Removed six unreferenced legacy scripts after checking all current HTML/JS code-search references and their role against active replacements: `wallet.js` (root; current verification page uses `wallet-manager.js` and `seller-wallet.js`), `js/buyer-wallet.js` (buyer dashboard uses `buyer-wallet-compat.js` and `buyer-wallet-v2.js`), `js/marketplace-intelligence.js` (marketplace uses `marketplace-intelligence-v2.js`), `js/offer-actions.js` (no consumer of `window.Web3MarketOffers` or its RPC wrapper exists), and `js/marketplace-active-filter.js` (no page loads it; its old active-listing enforcement is not part of the live marketplace path), and `js/marketplace.js` (the only page that loaded it, `marketplace.html`, marks itself as owned by `real-marketplace.js`; the legacy controller's `init()` therefore skipped rendering and had no remaining external API consumers). The stale `<script>` reference was removed from `marketplace.html`; the active `real-marketplace.js` and `marketplace-intelligence-v2.js` remain. `js/project-view-counter.js` was restored after the page-level audit confirmed that `project.html` actively loads it.

## Findings requiring further review

- An earlier isolated protocol run exposed a test-fixture migration-order defect: `20261117085142_harden_acquisition_event_trigger_search_path.sql` ran before the migration creating `public.w3m_reject_acquisition_event_mutation()`. The disposable-database setup order was corrected in this branch, and the latest isolated protocol run completed successfully (110 steps, no failures). This did not require or justify any production database change.
- Three MFA-related root pages exist: `admin-mfa-setup-20260926.html`, `admin-mfa.html`, and `admin-mfa-v2.html`. The two latter pages are now byte-identical after a one-character escaping defect in the v2 page's six-digit TOTP regex was corrected on this branch. Both pages remain explicitly included in the security workflow path filters, and `admin-review.html` routes users through `admin-mfa.html`. The dated setup page has no match in the default-branch code search, but it is a directly addressable administrator security route. All three are retained pending administrator auth-flow confirmation; do not delete based only on apparent duplication.
- A Cloudflare Pages branch preview was automatically built for the cleanup branch (`https://chore-repository-cleanup-202.web3market.pages.dev`). This is a preview deployment. No Supabase production deployment or migration was run; Cloudflare's handling of the brief, reverted documentation-only main commit could not be independently verified.
- Diagnostic pages and the Safe diagnostic script are retained. Their operational status and references need a full call-site audit before removal.
- The Future Lab contains a likely duplicate-topic pair: `future-ai-agents-blockchain.html` and `future-lab-ai-agents.html` cover AI agents and blockchain. The older-looking URL is not linked from the Future Lab index or current sitemap, while the newer page is linked from the index. Keep both temporarily; assess analytics/backlinks before converting the older URL into a canonical redirect/retired-page notice.
- `supabase/cleanup/legacy-external-passport-cleanup.sql` is intentionally retained and was not executed. It deletes external passport/search-history records after hard-coded row-count guards; this is a destructive operational script, not a migration. It requires a fresh read-only count review and a verified restorable backup before any future use.
- No `package.json` was added because the root app is not a conventional Node build and adding one without a verified build/test contract would create misleading tooling.

## Deletion policy

No source file is deleted solely because a repository search did not find a reference. Before deleting or moving any page/module, verify:
1. HTML, JavaScript, TypeScript, CSS, workflow, sitemap, manifest, and service-worker references.
2. Dynamic URL construction and server-side references.
3. External links/bookmarks and published canonical URLs where applicable.
4. Whether the file is a diagnostic or recovery path used during incident response.

## Validation

Validation was rerun on the latest cleanup code snapshot (commit `dd982803aca047ea9c9f97e16da3cd73d87a536f`):

- Security-remediation workflow run [`44083193198`](https://github.com/Aminzaki1972/Web3Market/actions/runs/44083193198) passed all three jobs: browser JavaScript syntax, CDN SRI integrity, and disposable PostgreSQL profile-guard migration.
- Isolated trust-badge workflow run [`44083192886`](https://github.com/Aminzaki1972/Web3Market/actions/runs/44083192886) passed.
- Isolated W3M Protocol V1 workflow run [`44083193045`](https://github.com/Aminzaki1972/Web3Market/actions/runs/44083193045) completed successfully with 110 steps and no failed steps.
- The branch comparison reports 15 changed files: six legacy JavaScript removals, two obsolete workflow removals, one new `.gitignore`, this maintenance report, and five targeted edits. No Supabase source or migration files are changed by this cleanup PR.
- Cloudflare Pages built an earlier code-change commit as a PR preview: https://14212a9b.web3market.pages.dev. This is a preview, not a production deployment.
- Pull request [#201](https://github.com/Aminzaki1972/Web3Market/pull/201) remains a draft. No merge, production deployment, or production Supabase migration was performed.



## Follow-up hardening — 2026-11-17

1. Restricted both production Supabase deployment jobs (deploy-external-passport-persist.yml and deploy-external-project-passport.yml) to github.ref == refs/heads/main. Their existing push trigger remains limited to main; manual dispatch from a non-main ref now skips the deploy job. This changes workflow configuration only and does not deploy functions.
2. Added explicit workflow-level contents: read permissions to audit-file-selection-tests.yml, passport-scope-check.yml, and security-remediation.yml. A fresh audit of all 15 remaining workflows found that the other 12 already declare contents: read, while w3m-contract-analysis.yml declares permissions: {} at workflow and job level. No remaining workflow requires repository write permissions for its stated checks.
3. Retained the overlapping audit-selection workflows. audit-file-selection-tests.yml runs the broader audit/payment/autofix regression suite on relevant source changes; audit-selection-priority.yml is a narrower selection/archive check with manual dispatch. They overlap but are not exact duplicates.
4. Sitemap review: the current sitemap lists only the homepage, marketplace, passports, AI Passport, and roadmap. The homepage also links to code-audit.html; the repository contains w3m-protocol.html, w3m-whitepaper.html, and listing-guide.html, which are not in the sitemap. These pages were not added automatically because canonical/indexing metadata is inconsistent or absent on some pages. SEO inclusion should be handled as a deliberate canonical/robots review, not guessed during code cleanup.

Current cleanup branch head after this follow-up: a6b885dc66c738f83fc896bdbce047e7d90de74c. It is 41 commits ahead of the unchanged main baseline 390ca09baccf45526ffae573465f794e3ef655bf, with no commits behind. PR #201 remains draft and unmerged.
