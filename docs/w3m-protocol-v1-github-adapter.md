# W3M Protocol V1 — GitHub Repository Adapter

**Status:** Read-only provider adapter implemented on the isolated branch.
**Production impact:** None. No GitHub App, OAuth installation, repository transfer, production database, or deployment was configured or invoked.

## Implementation

- Adapter: `supabase/functions/w3m-acquisition-verification/github-repository-adapter.ts`
- Tests: `supabase/functions/w3m-acquisition-verification/github-repository-adapter.test.ts`

The adapter performs authenticated GET-only reads against GitHub's repository endpoint and the authenticated-user endpoint. It binds the token actor's immutable user ID to the expected seller or buyer personal account ID. It accepts a server-side token as an input, never places it in a URL, and does not return or log the token. Provider error bodies are deliberately excluded from thrown error messages.

## Identity checks

The adapter normalizes and pins:
- Immutable repository ID.
- Immutable owner account ID.
- Owner login and account type.
- Repository visibility, fork, archived and disabled flags.
- Default branch and provider update timestamp.
- Admin permission where exposed.
- ETag, GitHub request ID, and observation timestamp.

Seller control is verified only when the exact repository ID and seller account ID match, the authenticated token actor is that same seller personal account, and GitHub reports `permissions.admin === true`.

Buyer ownership is verified only when the same immutable repository ID is now owned by the exact pre-verified buyer personal account and the authenticated token actor is that buyer. Collaborator or administrator permission is not a substitute for ownership.

**V1 limitation:** organization-owned repositories are intentionally returned as `REVIEW_REQUIRED`. They require a separate organization-authority adapter that verifies the seller's or buyer's authorized organization role; a personal-user token and the repository owner ID alone are not enough.

## Transfer safety

The module can convert a fresh authenticated owner read into a SHA-256-bound W3M `SELLER_CONTROL_VERIFIED` or `BUYER_CONTROL_VERIFIED` event. The event validity window is five minutes and its observation time must exactly match the provider-read timestamp.

The module can emit a `TRANSFER_CONFIRMED` event only after a fresh authenticated read shows that the same immutable repository ID is now owned by the exact buyer personal account. A separate buyer ownership read can then emit `BUYER_CONTROL_VERIFIED`.

The module can prepare a non-executable transfer intent after:
- Exact seller repository ownership and admin control are verified.
- Seller and buyer consent are recorded for the exact asset.
- The buyer login is bound to the pre-verified immutable buyer personal-account ID.
- The seller's authenticated GitHub token actor is bound to the seller account ID.
- The repository is not marked as a fork or disabled.

The intent is explicitly marked `executionEnabled: false`. No POST request or transfer operation exists in this adapter. A future transfer executor must be a separate server-side workflow with fresh provider reads, verified dual-party authorization, idempotency, audit logging, and handling for GitHub's asynchronous transfer/acceptance process.

## Provider facts and limitations

GitHub's REST API supports reading repository metadata and requesting repository transfer. Transfer requires appropriate administrator permission; a transfer to a personal account can require the recipient to accept the invitation. Therefore:
- An API transfer request is not evidence of completed transfer.
- The W3M adapter must re-read the same repository ID after provider completion.
- The buyer's immutable account ID must be the new owner.
- Pending invitations remain pending and cannot satisfy buyer ownership verification.

## CI

The existing isolated workflow runs `deno test supabase/functions/w3m-acquisition-verification/`, which discovers and executes the adapter tests. The workflow's explicit type-check list was not modified in this change; Deno test compilation still type-checks the imported adapter and its tests.

## Not implemented

- GitHub App creation or OAuth connection.
- Organization-owned repository verification.
- Secret storage or token provisioning.
- Webhook endpoint or polling worker.
- Transfer POST executor.
- Real repository transfer.
- Deal Room or Safe integration.
- Production deployment.

The next safe step is a server-side read-only connection in a disposable staging environment using a dedicated least-privilege GitHub App installation. Only after ownership reads and account-ID binding are demonstrated should transfer execution be designed.
