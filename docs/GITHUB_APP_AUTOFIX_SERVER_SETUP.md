# GitHub App Auto-Fix: server setup checklist

This checklist is for the isolated GitHub App integration in PR #209. It is not authorization to configure production.

## GitHub App settings

- App slug: `web3market-aminzaki1972`
- Setup URL (set only after the callback is deployed and reviewed):
  `https://hzhqlexnhtukfljcvnyd.supabase.co/functions/v1/github-app-setup`
- Keep the App webhook disabled unless a separately designed, signature-verified webhook endpoint is introduced.
- Keep OAuth / user authorization flow disabled; this integration uses the GitHub App installation flow.
- Preserve least-privilege permissions: Metadata read, Contents write, Pull requests write.
- The repository owner chooses the repositories during installation.

## Supabase Edge Function secrets

Configure only after a separately approved deployment:

- `W3M_GITHUB_APP_ID` — GitHub App numeric ID.
- `W3M_GITHUB_APP_SLUG` — `web3market-aminzaki1972`.
- `W3M_GITHUB_APP_PRIVATE_KEY` — contents of the downloaded PEM, stored only as a server-side secret.
- Existing Supabase URL, anon key, and service-role key are supplied by the Edge Functions environment; do not copy them into browser code.

Never paste the PEM, tokens, or secret values into GitHub, source files, issues, chat, browser storage, or logs. Do not rotate or delete existing GitHub tokens as part of this setup.

## Deployment order (not performed by this PR)

1. Review and merge the code only after all CI and security review requirements pass.
2. Apply the migration through the separately approved database change process.
3. Set the server-side secrets without exposing their values.
4. Deploy `github-app-install-start`, `github-app-setup`, and the updated `w3m-audit-autofix-pr` function.
5. Set the GitHub App Setup URL above.
6. Test with the Web3Market repository first; verify installation ownership, selected repository IDs, one-time state consumption, and creation of a review-only PR.
7. Test another repository only with its owner's explicit authorization.

## Current support boundary

- Public repositories only: the audit ingestion pipeline does not support private repositories.
- Auto-Fix creates a separate branch and pull request; it never merges automatically.
- The installation token is restricted to the selected repository and the minimum permissions requested by the function.
- No production secrets, database, Edge Functions, GitHub App settings, or installations are changed by this documentation or PR.
