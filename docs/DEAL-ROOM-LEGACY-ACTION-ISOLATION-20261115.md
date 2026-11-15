# Isolated Deal Room Legacy Action Containment

Date: 2026-11-15
Branch: `prototype/deal-management-system-20261114`
Status: containment change in isolated branch only

## Why this was necessary

A source review found that the existing `deal-room.html` still loaded a legacy Safe release watchdog. When it found two recorded signer rows, it exposed an Execute Safe Release action and called the production `execute-safe-release` Edge Function, then called `finalize-safe-release`.

The same page loaded `js/release-signing-fix.js`, which could call production `prepare-deal-release` and `prepare-safe-release-tx`, request a wallet EIP-712 signature, and record it through `record-safe-release-signature`.

The existing `js/deal-room.js` also:
- called the production `create-safe` Edge Function from its Safe creation helper;
- polled the production `verify-deal-payment` Edge Function every 15 seconds for buyer/seller sessions;
- inserted chat messages directly into the production-connected `deal_messages` table.

The Deal Room page initializes its Supabase client against the existing Web3Market project. Therefore a branch preview was not automatically an isolated database/test backend. Merely avoiding production SQL migrations did not prevent page-side requests from reaching production Edge Functions or tables.

## Isolated branch containment performed

In the isolated branch only:
1. Removed the legacy Safe release watchdog and its direct execute/finalize calls from `deal-room.html`.
2. Removed the `release-signing-fix.js` script inclusion and its old prepare/sign workflow from the Deal Room page.
3. Removed the legacy Safe Release preparation control.
4. Removed the old hidden Safe creation button and its client invocation/helper from `js/deal-room.js`.
5. Removed the 15-second automatic call to the production payment-verification Edge Function.
6. Disabled chat sending from this page until the authenticated permanent archive is implemented; message history remains read-only.
7. Added a visible explanation that Safe release is temporarily unavailable until the new authorization, dispute-hold, and settlement controls are connected.
8. Extended the Deal Management GitHub Actions workflow to run when `deal-room.html` changes and added source-contract checks that reject reintroduction of the legacy financial endpoints/direct chat insert.

## Current behavior and limits

- Deal Room reads remain connected to the existing Supabase project for existing records.
- Agreement and dispute actions remain disabled pending the new server-authoritative workflow.
- Chat history can be read, but new chat messages cannot be sent from this page.
- Safe configuration inspection remains read-only.
- Safe creation, deposit verification, release preparation, wallet signing, Safe execution, and settlement finalization are not available from this isolated Deal Room page.
- This containment is a client-side branch safeguard, not a substitute for server-side authorization or on-chain Safe Guard enforcement.
- The standalone sandbox preview remains local/demo-only and is not evidence of deployed backend integration.

## Next prerequisites

Before restoring any transaction controls:
1. Recover and review the source of every relevant Edge Function, including `create-safe`, `verify-deal-payment`, `prepare-deal-release`, `prepare-safe-release-tx`, `record-safe-release-signature`, `execute-safe-release`, and `finalize-safe-release`.
2. Verify their JWT/session handling, deal participant authorization, single-admin separation, approved agreement binding, active dispute-hold checks, token/Safe/chain validation, replay protection, and idempotency.
3. Verify Safe owners, threshold, Guard/Module Guard state and every direct/indirect execution route independently on BNB Smart Chain.
4. Move all integration tests to a separate free-tier test project or local isolated database; do not point test pages at production mutation endpoints.
5. Reintroduce one operation at a time only after server-side and on-chain tests pass.

No production database, Edge Function, Safe, wallet, funds, or Cloudflare production setting was changed. No paid resource was created. No merge or deployment was performed.


## Checkout legacy-path isolation — 2026-11-15

A wider client-path review found that `js/deal-checkout.js` still automatically invoked the deployed `create-safe` function for accepted deals and offered a wallet payment path that submitted a token transfer and then called `verify-deal-payment`. These were legacy production endpoints and were not part of the new server-authoritative deal workflow.

Sandbox branch changes:
- Replaced checkout client behavior with read-only deal display.
- Removed automatic Safe creation and all wallet connection/signing/transfer code from this page.
- Removed calls to both legacy `create-safe` and `verify-deal-payment`.
- Clarified the checkout page that deposits and asset transfers remain disabled until the new agreement/Safe workflow is complete.
- Extended CI to syntax-check checkout and fail if legacy function URLs, `eth_sendTransaction`, or `eth_requestAccounts` reappear in this file.

This is only prototype-branch isolation. The production website and deployed Edge Functions were not changed. Other direct API access to the deployed legacy functions remains possible outside this branch; this client-side change is not a server-side authorization control. The legacy functions still require their existing authenticated/session and signature checks, but they do not enforce the proposed new dispute-request/hold state machine.
