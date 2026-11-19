# GitHub App Integration Plan — Auto-Fix PR

**Status:** Design proposal only; no runtime implementation is authorized by this document.
**Date:** 2026-11-20
**Target:** Web3Market Auto-Fix PR workflow (w3m-audit-autofix-pr)
**GitHub App:** Web3Market-Aminzaki1972 (App ID: 5840629)

## 1. Purpose and scope

Replace the current broad, single-token GitHub authentication in the Auto-Fix PR workflow with repository-scoped GitHub App installation tokens. A repository owner must explicitly install the Web3Market GitHub App and select the repositories the installation may access.

This proposal is limited to Auto-Fix PR. It is separate from W3M Protocol V1 and must not change Deal Room, Safe, settlement, dispute, database schema, Cloudflare, or production behavior as part of this design-only PR.

## 2. Current-state findings

The deployed Supabase Edge Function w3m-audit-autofix-pr is version 7 and currently:

- Reads a single GITHUB_TOKEN secret and uses it as a bearer token for GitHub API calls.
- Requires Supabase URL/anon/service-role secrets and GEMINI_API_KEY.
- Explicitly rejects repositories when GitHub reports private=true.
- Checks that the repository's current source-branch commit still matches the audited commit before creating a proposal.
- Creates a separate w3m-autofix/* branch and opens a pull request; it does not merge automatically.
- Stores resulting PR metadata in code_audit_autofix_prs.

The deployed code audit pipeline is currently public-repository-only. GitHub App authentication alone does not make private-repository auditing supported. Private repository support requires a separately scoped audit-pipeline review and must not be claimed by this integration.

## 3. GitHub App permission model

The registered app is intended to use only:

- Metadata: read-only (GitHub mandatory permission).
- Contents: read and write.
- Pull requests: read and write.
- No Organization, Account, or Enterprise permissions.
- Installation target: Any account, so each repository owner or organization chooses whether to install it and which repositories to grant.
- No webhook events or webhook endpoint in the initial design.

No additional permissions should be requested without a separate security review and explicit approval.

## 4. Proposed authentication and installation flow

1. An authenticated Web3Market user starts the GitHub App installation flow from the Web3Market UI.
2. The backend creates a short-lived, single-use installation intent bound to the authenticated Web3Market user. The intent must use cryptographically secure randomness, expire quickly, and be consumed exactly once.
3. GitHub presents the installation screen. The repository owner chooses all repositories or selected repositories.
4. The app setup callback receives the GitHub installation identifier. The backend validates the installation using an App JWT and GitHub's installation/repository APIs.
5. The backend obtains the installation's accessible repository list and records only the immutable GitHub repository IDs, installation ID, account identity/type, and the Web3Market user who completed the verified flow.
6. The callback must verify the original installation intent and authenticated user binding. It must not trust a client-supplied owner/name or repository ID without checking it against GitHub's installation API.
7. For each Auto-Fix request, the backend reloads the stored installation/repository association, confirms that the requesting Web3Market user is authorized for that association, and confirms that the target immutable repository ID is still accessible to that installation.
8. The backend mints a short-lived installation access token restricted to the exact repository ID needed for the operation, then uses it only for the required GitHub API calls.
9. Installation removal, repository access removal, permission reduction, or token errors must fail closed. No fallback to a broad PAT or the legacy token is permitted in the new path.

The app currently has no webhook URL or active webhook. This design should use a verified GitHub App setup callback for the initial installation handshake. If a webhook is later considered necessary for prompt uninstall/revocation handling, it requires a separately designed endpoint, signature verification, event allowlist, and secret. Do not invent or configure a webhook URL before that endpoint exists.

## 5. Server-side secret handling

After the implementation and callback endpoint have been reviewed and approved, store the following only as Supabase Edge Function secrets:

- W3M_GITHUB_APP_ID — GitHub App ID.
- W3M_GITHUB_APP_PRIVATE_KEY — full PEM private key contents.
- W3M_GITHUB_APP_SLUG — app slug, if needed to construct the installation URL.

The private key must never be placed in repository files, migrations, frontend bundles, browser storage, logs, error messages, issue comments, or PR content. Never ask the user to paste it into ChatGPT. The key must be parsed and used only in server-side code to sign short-lived App JWTs. Keep JWT lifetime within GitHub's documented limit and use a small clock-skew allowance.

Do not add or rotate production secrets in this design-only phase. Do not delete, rename, or overwrite GITHUB_TOKEN or W3M_GITHUB_ACTIONS_TOKEN until a separately approved migration and rollback plan exists.

## 6. Repository and user authorization safeguards

- Bind the installation to a verified Web3Market user and GitHub installation ID.
- Use GitHub's immutable numeric repository ID as the canonical repository identity; owner/name are display/routing attributes only.
- Confirm the repository is included in the installation's current accessible-repositories list before minting a token.
- Request an installation token restricted to the single target repository ID and only the minimum permissions needed for the operation.
- Never accept an installation ID or repository ID as sufficient proof of authorization when supplied by the browser.
- Prevent cross-user installation/repository association access (IDOR/BOLA).
- Revalidate the audit's repository identity and source commit before generating any patch.
- Preserve current exact-replacement safeguards and protected-path exclusions; do not broaden the AI patch surface in this work.
- Do not log JWTs, installation tokens, private-key material, authorization headers, or secret values.

## 7. Auto-Fix behavior and limits

- Keep the workflow proposal-only: create a dedicated branch and pull request.
- Never write to the default branch directly.
- Never auto-merge or execute generated code.
- Keep the source-commit freshness check.
- Keep existing finding eligibility and protected-file exclusions unless separately reviewed.
- The PR must clearly identify the audited source commit and AI-generated nature of the proposal.
- A human must review the diff and run appropriate tests, linters, compiler and security checks.
- Public repositories are the only supported audit target in this phase.
- Private repositories remain unsupported until audit ingestion, file retrieval, storage, entitlement, and security paths have been separately reviewed and implemented.

## 8. Rollout stages and acceptance criteria

### Stage A — implementation in an isolated branch

- Add server-side App JWT creation and installation-token exchange.
- Add a secure, authenticated installation setup callback and one-time intent validation.
- Add minimal persistence for verified installation-to-user and repository-ID associations only after a separate schema proposal/review.
- Update Auto-Fix to resolve the exact installation and mint a repository-scoped token.
- Do not deploy Edge Functions or change production secrets.

### Stage B — automated and security tests

Tests must cover:

- Valid App JWT and installation-token exchange.
- Expired, malformed, replayed, and mismatched installation intents.
- User A attempting to use User B's installation.
- A repository not selected for the installation.
- Removed installation or revoked repository access.
- Permission reduction and GitHub API authorization failures.
- Repository rename/transfer while preserving immutable repository identity.
- Stale audit commit and mismatched audit repository ID.
- No token/private-key leakage in logs or API responses.
- No default-branch writes and no auto-merge.
- Existing public-repository Auto-Fix behavior remains proposal-only.

### Stage C — controlled review

- First test only against the Web3Market repository after the app is installed for that repository.
- Verify selected-repository scope and resulting PR behavior.
- Do not test another owner's repository until that owner explicitly installs the app and authorizes the selected repository.
- Do not announce general availability until a second, separately consenting repository owner has completed a successful test.
- Keep private repositories out of supported claims until the audit pipeline supports them.

### Stage D — production approval (not included here)

Requires separate explicit approval for production secret configuration, database migration if needed, Edge Function deployment, app installation, and rollout. This PR does not authorize any of those actions.

## 9. Rollback and legacy compatibility

- Keep the existing deployed function and production secrets unchanged during design and implementation review.
- If the new integration is later deployed and fails, restore the prior function version and retain the legacy secret until rollback is verified.
- Do not silently fall back from an installation token to a broad PAT; return a clear configuration/authorization error instead.

## 10. Explicit non-goals

This plan does not:

- Enable private-repository audits.
- Modify W3M Protocol V1 or any Safe/Deal Room/settlement functionality.
- Change production Supabase secrets, database schema, Edge Functions, or Cloudflare configuration.
- Install the GitHub App on any repository.
- Generate, upload, or transmit the user's private key.
- Publish or list the GitHub App on GitHub Marketplace.
- Merge this PR or any future implementation PR automatically.

## 11. Review checklist

- [ ] Confirm app permissions and installation target match Section 3.
- [ ] Confirm no webhook is configured until a verified endpoint is designed.
- [ ] Review setup callback and anti-replay design against current GitHub documentation.
- [ ] Review schema proposal and RLS/authorization model before any migration.
- [ ] Review secret names and server-only handling.
- [ ] Verify repository-ID and per-user authorization checks.
- [ ] Verify no PAT fallback and no default-branch writes.
- [ ] Verify tests and rollback plan before any production approval.
