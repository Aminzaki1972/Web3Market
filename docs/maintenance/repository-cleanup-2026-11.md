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

Documentation note: this report update itself was committed immediately after the workflow-hardening commit above; the resulting branch head is 9fd6586ab8e48fbfd0bf86711a2a3f1cc1b4d4b0. This final documentation-only commit does not alter runtime code, workflow behavior, or Supabase resources.


## Follow-up review — diagnostics and public-page inventory

1. Audited the remaining diagnostic and administrator pages. Retained auth-diagnostic.html and edge-connectivity-test.html as support/troubleshooting tools; neither is linked from the main navigation, and both make explicit diagnostic requests to the Supabase project. They should remain restricted operational tools and must not be treated as user-facing marketplace pages.
2. Retained diagnostics/safe/deal-room-safe-diag-20260920-r3.js. It has no HTML script-tag consumer in the repository, but the W3M Protocol V1 implementation blueprint explicitly references it as a historical Safe/Deal Room release client source. The script includes direct Deal Room RPC and Safe/payment Edge Function calls, so deleting it without a source-history and operational confirmation would be unsafe. Treat it as a diagnostic/historical artifact, not proof of the live production settlement implementation.
3. Retained admin-listing-monitoring.html, admin-audit-log.html, admin-review.html, admin-login.html, and all MFA pages. They form administrator review, audit, login, and MFA flows; no deletion is justified by lack of public navigation links.
4. Reviewed all 15 remaining workflows. Fourteen have explicit read-only permissions (contents: read or permissions: {}); the W3M contract-analysis workflow intentionally uses permissions: {} at both workflow and job levels. No workflow-level repository write permission is required by the current jobs. Two manual/production Edge Function deployment jobs are additionally guarded so deploy runs only on main.
5. Reviewed public homepage links against sitemap.xml. The homepage links to code-audit.html, w3m-protocol.html, and w3m-whitepaper.html, but sitemap currently lists only five URLs. robots.txt allows crawling and points to the sitemap. No sitemap URLs were added or removed in this pass: canonical and indexability metadata should be checked against the live published pages and analytics/backlinks before changing search-engine discovery.

No diagnostic/admin page, Supabase function, migration, wallet, Safe, payment, or deal-room file was deleted or modified in this follow-up. These are retention decisions based on current source references and documented operational purpose, not a claim that every page has been runtime-tested.


## Follow-up compatibility review — Deal Room / W3M Safe routes — 2026-11-17

### Current branch call graph

The Deal Room release client on this branch (js/release-signing-fix.js importing js/w3m-safe-wallet-execution-client.js) now calls these isolated W3M routes:

| Client operation | Edge Function directory present on this branch | Source status |
|---|---|---|
| PREPARE release | w3m-protocol-v1-prepare-deal-release | Explicitly marked isolated and not deployed |
| Compose connected-wallet package | w3m-protocol-v1-safe-wallet-package | Explicitly marked isolated and not deployed |
| Record Safe signature | w3m-protocol-v1-safe-sign | Explicitly marked isolated and not deployed; does not replace deployed legacy signer |
| Record wallet-submitted transaction hash | w3m-protocol-v1-safe-wallet-submit | Authenticated persistence only; submitted hash is unverified and this function does not broadcast or finalize |
| Verify receipt and finalize | w3m-protocol-v1-finalize-safe-release | Explicitly marked isolated; does not replace deployed legacy finalizer |

The browser-side client obtains a one-use execution package, submits Safe.execTransaction through the connected owner wallet, then records the returned transaction hash. The server-side finalizer is a separate receipt-verification step. The submission-hash endpoint explicitly does not treat the browser hash as proof.

### Legacy routes still present

- js/deal-room.js still invokes the existing create-safe endpoint and calls verify-deal-payment.
- The old direct execute-safe-release / finalize-safe-release route is no longer present in deal-room.html; the page loads the W3M release-signing module instead.
- The read-only deployed-source snapshot records legacy active versions as of 2026-11-06: create-safe v56, prepare-deal-release v43, prepare-safe-release-tx v37, record-safe-release-signature v24, execute-safe-release v28, and finalize-safe-release v25. These versions were retrieved for static review only and were not changed.

### Merge/deployment gate

**Do not merge or deploy this branch as a live Deal Room release until all five W3M endpoints above have been deployed to an isolated staging project and the exact client/server contract has passed authenticated integration tests.** The old production endpoints must remain available for rollback until the new flow is proven end-to-end. Do not point the W3M browser client at production while its endpoint directories are undeployed.

This is a compatibility and deployment-readiness finding, not a claim that the production Deal Room has changed. No endpoint was invoked, deployed, or modified; no migration was applied; no wallet, Safe, payment, or production database operation occurred.

### CI and pull request state at review

- Commit 04cadb143d2d091684648e7aa8dd860b75b32a1f: all eight reported checks completed successfully, including Cloudflare Pages, JavaScript syntax, CDN SRI, audit selection, decision-engine/schema, trust badge, passport scope, and profile-guard migration.
- Cloudflare Pages reported a successful build check; this does not by itself prove a production deployment or a browser end-to-end Deal Room test.
- PR #201 remains open as a Draft and unmerged; the cleanup branch is 44 commits ahead of the unchanged main baseline and 0 behind at this review.

## Follow-up API contract and test review — 2026-11-17

### Static request/response contract comparison

- PREPARE: browser sends only deal_id; request handler derives actor from bearer auth and server context. The handler returns result.committed with camelCase policyId, transactionId, status, and idempotentReplay, matching the browser client's required fields.
- Wallet package: browser sends only deal_id. Handler returns PACKAGE_ISSUED, attempt_id, package_hash, and package; client validates those fields and the exact deal binding.
- SIGN: browser sends deal_id, safe_tx_hash, and signature. Handler reloads the verified signer context, independently verifies the typed-data signature, and calls atomic signature persistence. The response fields (recorded, idempotent_replay, confirmations_count, required_signatures, status) match the client checks.
- Wallet submission: browser sends attempt_id, package_hash, and transaction_hash. Handler returns BROADCAST_UNVERIFIED or RECONCILIATION_REQUIRED with receipt_verified=false and finalized=false; client accepts only these states and preserves the hash for reconciliation.
- FINALIZE: browser sends only attempt_id. Handler derives actor from the verified session. The receipt composition reloads a fresh attempt snapshot, revalidates the persisted acquisition report, verifies the BNB Safe receipt, and calls the atomic finalization RPC. The RPC adapter returns attemptId, broadcastTxHash, and CONFIRMED, matching the browser client's final confirmation contract.

### Test coverage and its limits

- Focused Deno unit tests exist for PREPARE request handling and atomic RPC persistence, wallet-package issuance, SIGN, wallet-submission persistence, finalization request handling, Safe package construction/submission, and finalization receipt guards.
- The browser execution-client tests cover request shapes and mocked response contracts for PREPARE, package issuance, wallet submission/recovery, SIGN, and FINALIZE.
- These are isolated unit/contract tests with injected mocks. They do not prove deployed Supabase Edge Function behavior, production schema compatibility, real BNB RPC behavior, wallet-provider behavior, or a full browser Deal Room transaction. The eight GitHub checks passing therefore establish repository CI success, not production integration readiness.
- The isolated Edge Function entrypoints remain explicitly marked not deployed. Their directory presence and passing tests must not be interpreted as deployment status.

### Decision

Static client/handler response shapes are consistent for the five W3M endpoints reviewed. No definite request/response mismatch was found in this pass. The remaining blocker is operational integration: deploy only to a separate staging Supabase project, apply only staging migrations there, configure a controlled BNB test environment, then run authenticated PREPARE → SIGN → connected-wallet submission → receipt verification → FINALIZE end-to-end tests. Production endpoints and the previously successful live deal path must remain untouched until staging passes and an external security review approves the change.

### Latest cleanup commit status

- The previous cleanup commit ac80bf74a5f2d921192730323567cfcd9a787c6f completed all eight GitHub checks successfully, including Cloudflare Pages build, JavaScript syntax, CDN SRI, audit selection, passport scope, profile-guard migration, trust badge, and decision-engine/schema checks.
- PR #201 remains open as Draft and unmerged. This documentation-only follow-up does not authorize or perform merge, production deployment, or Supabase changes.

## Follow-up staging-readiness configuration review — 2026-11-17

### Latest repository CI

- The latest cleanup head reviewed was `49f480d23e2208c866937399b13f0683736c099d`.
- All eight GitHub checks on that head completed successfully after retrying the failed `audit-selection-tests` job. The first attempt failed while Deno was downloading `@supabase/functions-js` metadata from `jsr.io` and the remote connection reset; the retry completed successfully. This was a transient dependency-network failure, not a failing audit-selection assertion.
- Cloudflare Pages check succeeded. It is a branch preview/build result, not a production deployment or browser end-to-end test.
- PR #201 remains open, Draft, and unmerged.

### Five isolated endpoint runtime configuration

Static inspection of the five isolated W3M entrypoints found:

- Each endpoint uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for server-side Supabase access. The service-role client disables session persistence/refresh. Caller identity is separately checked through `supabase.auth.getUser(token)`; handlers derive actor identity from that authenticated user rather than accepting a browser-supplied actor ID.
- The five entrypoints allow only `https://web3market.xyz` and `https://www.web3market.xyz` as browser origins. A staging hostname or local browser origin is not currently allowlisted. Do not weaken CORS to `*`; add only the explicitly approved staging origin when a staging environment is selected.
- The four request-handler paths that were inspected enforce POST in their handler layer (PREPARE, SIGN, FINALIZE, and wallet submission); wallet-package also checks POST at the entrypoint. OPTIONS is handled as CORS preflight.
- BNB RPC configuration is currently hard-coded to `https://bsc-rpc.publicnode.com` in the isolated endpoint compositions. The canonical Safe reader and receipt verifier explicitly require chain ID 56 (BNB mainnet). The finalizer reads `W3M_BNB_MIN_CONFIRMATIONS`, defaulting to six and rejecting invalid/out-of-range values.
- Consequently, these endpoint compositions are **not configurable for BNB testnet** as currently written. A separate Supabase staging project alone would not make a safe testnet lifecycle possible. Before staging, the chain/RPC and Safe/token deployment configuration must be deliberately parameterized and covered by chain-mismatch tests; do not point this candidate at a production Safe or use real deal funds as a substitute for testnet.
- `supabase/config.toml` currently identifies a local audit-test project and disables automatic migration discovery. It does not define a staging project, staging secrets, or deployment targets for these five functions. The isolated CI workflow uses a disposable PostgreSQL service and fixtures; it does not provision Supabase staging or deploy Edge Functions.
- The report-issuer composition and protected signing-key custody remain open blockers in the protocol readiness notes. The five endpoint entrypoints do not, by themselves, complete authoritative evidence loading and signed report issuance. The six active legacy Deal Room/Safe Edge Functions also remain unpatched to call the W3M gate.

### Staging gate — not yet satisfied

A safe staging run still requires all of the following, none of which was performed in this review:

1. An explicitly separate Supabase staging project and verified project reference.
2. An approved staging browser origin, added narrowly to the five endpoint CORS allowlists.
3. A chain-aware RPC/Safe/token configuration that supports a controlled BNB testnet and fails closed on wrong chain ID, wrong Safe, and wrong token.
4. Staging-only secrets and provider credentials, with protected signer custody selected and documented; never copy production service-role or signing secrets into a public repository or CI logs.
5. The authoritative report-issuer runtime and evidence-source mapping completed, then the isolated endpoint functions deployed only to staging.
6. Ordered staging-only migrations applied and inspected against the staging schema.
7. Authenticated browser/wallet end-to-end tests for PREPARE → package → SIGN → connected-wallet execution → hash reconciliation → receipt verification → FINALIZE, including negative cases and rollback/recovery.
8. Independent external security review before any production activation.

**Decision:** repository CI is green, but the protocol is not yet staging-ready or production-ready. No source runtime was changed in this follow-up. No Supabase project was created or modified, no secret was set, no migration was applied to any hosted database, no Edge Function was deployed, and no wallet/Safe/transaction was invoked. Keep PR #201 Draft and retain all legacy production Deal Room routes until every staging gate above is passed.
