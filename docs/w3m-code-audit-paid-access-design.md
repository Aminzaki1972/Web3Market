# W3M AI Code Audit — Free/Paid Access and BNB Payment Design

**Status:** design-only draft. No production database, secrets, Edge Function, wallet, or deployment has been changed.

## 1. Product policy

- **Marketplace member — free entitlement:** one free audit per account, limited to the canonical public GitHub repository attached to that member's own eligible, active marketplace listing. The server must confirm ownership with `projects.owner_id = auth.uid()`, eligible listing status, and an exact normalized match between `projects.github_url` and the requested repository. A browser-supplied `project_id` is never proof of ownership.
- **Marketplace member — paid audits:** after the free entitlement is used, a verified paid order may audit any public GitHub repository, including a repository unrelated to the member's listing.
- **Non-member — paid audits:** purchase and audit a public GitHub repository without creating a Web3Market marketplace account. A receipt/access token is needed to retrieve the result safely.
- **Administrator:** a user present in `admin_users` may audit any public repository without charge or quota. Admin status is checked server-side.
- **Public repositories only:** private repositories remain unsupported in this phase.

## 2. Proposed prices

| Plan | Price | Intended purchase |
|---|---:|---|
| Basic | 9 USDT | One additional public-repository audit |
| Advanced | 29 USDT | One audit with an expanded review/report |
| Professional | 79 USDT | One audit with the most comprehensive report |

All amounts are denominated in USDT on BNB Smart Chain (BEP-20), chain ID **56**. The exact differences between report tiers must be implemented and tested before the higher-priced tiers are enabled; the current scanner must not be advertised as three different service levels unless its output actually differs.

## 3. Payment verification — server authoritative

1. The server creates a unique payment order with a cryptographically random order ID, plan, exact token base-unit amount, chain ID, expected recipient, expiry, and state `pending`.
2. The buyer sees the network, token, amount, recipient address, expiry, and order ID. The browser never marks an order paid.
3. A server-side verifier reads the transaction receipt and token Transfer log from BNB Smart Chain RPC. It validates:
   - chain ID 56;
   - the configured, independently verified USDT contract address;
   - successful receipt status;
   - exact expected recipient and token amount;
   - enough confirmations (initial proposal: 15 blocks);
   - transaction hash not previously credited to another order;
   - order is still valid and has not already been fulfilled.
4. The verifier is idempotent: a transaction hash can credit at most one order. The order state progresses through `pending → confirming → paid → audit_queued → completed` (or a recorded failure state). Only the trusted server can perform these transitions.
5. A paid audit is created only after the server verifies the on-chain payment. Never trust a screenshot, wallet-connect state, client-submitted transaction hash, or client-supplied amount by itself.
6. Use two configurable RPC endpoints where practical; if RPC providers disagree or are unavailable, leave the order pending and retry rather than falsely confirming payment.
7. Record underpayments, overpayments, expired orders, and duplicate transactions for manual review. Do not promise automatic refunds until a separately reviewed refund process exists.

## 4. Receiving-wallet architecture

**Recommended default for implementation:** a dedicated collection wallet with a distinct receiving address per order, derived server-side from a public extended key (xpub). The verifier needs only the public derivation key; private keys must never be sent to the browser, committed to Git, or stored in ordinary database rows. A separate controlled process can sweep received funds later.

This design is **not ready to activate** until the owner supplies/configures the receiving-wallet derivation material as a Supabase secret and verifies the destination wallet. Do not generate, guess, or hard-code a wallet address. If a per-order address derivation setup is not available, stop before accepting payments rather than using a shared address with ambiguous transfers.

Required server-side configuration will include a verified token contract, the xpub/derivation path, and primary/fallback BNB RPC URLs. Values must be validated at startup and kept out of client bundles and logs. No secret belongs in GitHub.

## 5. Data and authorization model

Use a dedicated payment-order ledger rather than treating a browser redirect as proof of payment. Each order should record at least:
- random order ID; plan ID; expected amount in token base units; chain ID; token contract; unique recipient; expiry;
- nullable marketplace user ID and optional contact email for non-members;
- status, transaction hash (unique when credited), observed block number, confirmation count, timestamps, and sanitized verification error;
- audit ID after fulfillment and a hash of any guest result-access token (never the raw token).

Use a separate atomic free-entitlement claim keyed by the authenticated user ID. It must prevent concurrent requests from consuming the one free audit twice. A claim is associated with the eligible project and audit; recoverable infrastructure failures must permit safe resumption without granting a second free audit. Existing historical audits must be reviewed before deciding whether any of them should count as the new free entitlement.

Guest results must not rely on a guessable audit UUID. Provide a high-entropy, revocable receipt/access token and a server-side access endpoint that checks its hash before returning the authorized report. Keep private notes and unrelated account data out of guest responses.

## 6. Required tests before any release

- Correct owner + active listing + matching repository gets one free audit.
- Wrong owner, inactive/unlisted project, mismatched repository, or forged project ID is rejected.
- Concurrent requests cannot claim the free audit twice.
- A second free audit is rejected; a paid order can target any public repository.
- Admin can audit any public repository without a payment or quota.
- Guest purchase works without a marketplace login; only the matching access token can retrieve the result.
- Wrong chain, wrong token contract, wrong recipient, wrong amount, failed receipt, insufficient confirmations, expired order, and reused transaction hash are all rejected.
- Repeated verification is idempotent; RPC failure leaves the order pending; payment cannot be marked paid from the browser.
- Audit is not started before payment is verified.
- No production migration or secret change occurs until the draft PR is reviewed and the payment receiver is configured.

## 7. Explicit blockers before accepting real payments

1. Verify the exact USDT contract address intended for BNB Smart Chain from an authoritative source.
2. Configure and test the dedicated receiving wallet/xpub and address derivation.
3. Define the concrete feature differences between Basic, Advanced, and Professional.
4. Implement and test the payment-order, chain-verification, guest-access, and entitlement flows together.
5. Run isolated migration/function tests and a small end-to-end test using a disposable order before enabling production payments.
