# W3M Protocol V1 — Deal Room Dispute and Safe Policy Review
**Review date:** 2026-11-11  
**Branch:** `feat/w3m-audit-fingerprint-binding-20261107`  
**Review type:** Read-only source and migration inspection.

## Finding D1 — Deal Room currently records dispute opening, not dispute adjudication

Inspected `js/deal-room.js`:
- The legacy Deal Room renders a Model B notice stating that Web3Market is the dispute-resolution party.
- The dispute form validates a 10–5,000 character reason and inserts one row into `public.deal_disputes` with `deal_id`, `opened_by`, `reason`, and `status: 'open'`.
- The UI then reports that the dispute was submitted. The inspected path does not create a reasoned decision, identify an authorized adjudicator, record buyer/seller outcome, calculate a refund amount, prepare a buyer Safe transfer, or verify a refund receipt.
- For deals classified as W3M V1, this legacy Model B UI is hidden; the V1 agreement and digital-signing path remain gated pending final legal/commercial approval.

**Conclusion:** dispute intake exists in the inspected Deal Room path; an end-to-end dispute decision and buyer-refund workflow is not evidenced by the inspected V1 implementation.

## Finding D2 — Safe release serialization exists, but it is not a refund lifecycle

Migration `20261108044500_w3m_v1_safe_release_claims.sql` creates a durable active-claim guard for `release_to_seller` and serializes dispute row changes against an active seller-release claim by locking the deal row. This is a useful race-condition defense. It does not create a separate buyer-refund claim, refund transaction state machine, refund decision record, or on-chain refund verifier.

Do not reuse a seller-release claim as a refund claim. A refund must have its own immutable action identity, exact recipient/amount/token/chain binding, idempotent claim lifecycle, and independent receipt verification.

## Finding S3 — Deal Room Safe display hard-codes the default 2-of-3 policy

In `js/deal-room.js`, `renderSafe()` reads `getOwners()`, `getThreshold()`, and nonce from BNB Chain, but sets `ok` only when `owners.length === 3` and `threshold === 2`. The user-approved 2-of-3 configuration is the default; this browser check is not a generic dynamic-policy verifier. It should compare actual Safe state with the immutable approved deal policy and display the actual required threshold, without treating a hard-coded browser predicate as the authorization source.

The previously documented signer endpoint limitation remains: the endpoint supports buyer/seller user identities and roles only, while the execution endpoint reads the threshold but hard-codes it to 2. A complete fix must cover UI, signature endpoint, execution endpoint, database signer uniqueness and tests together.

## Required V1 gates

1. Finalize the authorized dispute decision process and immutable decision record before implementation. Do not invent adjudication authority, appeal rules, deadlines, or legal terms.
2. Bind each decision to the deal, evidence snapshot, decision-maker, outcome, timestamp, and reason; require an explicit buyer-favorable amount and recipient when a refund is ordered.
3. Define how the platform's 7.5% commission is treated in buyer-favorable full/partial refunds from the approved signed agreement. Do not assume fee-on-refund or waive/retain the fee without an agreed contractual basis.
4. Implement a separate Safe buyer-refund transaction and durable refund claim, with exact token/chain/recipient/amount checks, current owner/threshold verification, distinct valid signatures, nonce protection, replay resistance, broadcast uncertainty handling, and on-chain receipt verification.
5. Enforce mutual exclusion between seller release and buyer refund for the same deal, including concurrency and retry tests.
6. Add end-to-end tests for dispute intake → authorized decision → refund preparation → Safe signatures → execution → verified receipt → final ledger status; include denied, partial, full, duplicate, stale, reverted, and uncertain-broadcast cases.
7. Keep V1 digital signing and dispute activation blocked until canonical legal/commercial terms are approved.

## Safety boundary

No source implementation, database, Safe, wallet, key, deployment, live deal, or funds were changed. This is documentation of inspected gaps only. No independent escrow contract is proposed or permitted.
