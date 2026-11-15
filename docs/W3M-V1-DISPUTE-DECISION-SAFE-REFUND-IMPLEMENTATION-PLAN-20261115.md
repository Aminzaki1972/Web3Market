# W3M Protocol V1 — Dispute Decision and Safe-only Refund Implementation Plan

Date: 2026-11-15
Scope: isolated V1 branch only. Planning artifact; not a production migration or authorization to deploy.

## 1. Verified current state

- `open_deal_dispute(uuid,text)` is an authenticated participant-only RPC. It locks the deal row, inserts one dispute, sets `deals.status='disputed'` and `deals.dispute_status='open'`, and writes `dispute_opened`.
- `deal_disputes` currently uses the statuses `open | under_review | resolved | cancelled`, one dispute per deal, and has no authenticated participant UPDATE policy.
- `deal_multisig_transactions.action` includes `refund_to_buyer`, but an enum/check value is not an implemented refund workflow.
- The current Safe finalizer is deliberately seller-release-specific: it requires `action='release_to_seller'`, verifies exactly two USDT transfers (seller net + platform fee), then completes the deal and transfers project ownership.
- Existing independent-session tests now exercise the actual finalizer against dispute opening, signer revocation, project ownership changes, report appends, and evidence appends. The focused legacy dispute concurrency test is not a substitute for those finalizer tests.
- The owner-approved Arabic 20-article agreement is now committed at `docs/legal/W3M-DEAL-AGREEMENT-AR-V1.0.md` (document ID `W3M-AGREEMENT`, version `1.0`, SHA-256 `74fc948b9b7757718b617af080acd51c0a21de81aa3a5b7f410a19aa07a7a465`) and is being wired into the isolated EIP-712 acceptance flow under Issue #192. This owner approval is not a claim of final independent legal review or jurisdiction-specific enforceability. The agreement protects the platform's 7.5% commission but does not yet provide a sufficiently precise executable formula for allocating commission on partial buyer refunds. Partial-refund fee allocation must therefore remain fail-closed and must not be invented.

## 2. Non-negotiable V1 rules

1. No independent escrow contract. Deal funds and any refund request remain Safe-only.
2. No browser-supplied decision authority, buyer wallet, refund recipient, Safe owner list, threshold, nonce, token address, or amount is trusted.
3. A dispute blocks seller release until an authorized decision is persisted and the permitted Safe path is completed.
4. Decision records and audit events are append-only; conflicting decisions fail closed.
5. Buyer refund recipient is derived from the verified buyer account/wallet binding on the server.
6. Full/partial refund amounts must be bounded by confirmed funded balance and exact approved deal asset/network.
7. Platform commission is never silently waived. Partial-refund fee allocation remains blocked wherever it depends on unresolved wording in the signed agreement.
8. No live wallet signing, funds movement, production migration, merge, or deployment during this implementation phase.

## 3. Proposed server-side components

### A. Decision authorization and immutable decision record

Implement a server-authorized decision service/RPC that:
- derives the actor from the verified server session and an explicit administrator permission check;
- locks the active `deal_disputes` row and parent `deals` row in one documented lock order;
- accepts only enumerated outcomes: buyer wins or seller wins;
- requires a bounded reason and references to the evidence/messages already stored for that dispute;
- persists decision ID, dispute/deal IDs, outcome, decision-maker, server timestamp, agreement/terms reference, canonical payload hash, and prior-state reference;
- rejects duplicate/conflicting decisions and records an append-only audit event;
- transitions dispute/deal status atomically, without allowing participants to update the decision directly.

Do not add a new user-facing appeal or arbitration feature in V1 unless separately approved.

### B. Buyer-win Safe refund request

For a buyer-win decision:
- derive buyer wallet and verified funded balance from persisted server-side deal/payment records;
- validate chain ID 56, the configured official USDT contract, the deal's Safe address, current Safe owners/threshold, current nonce, and the exact transfer payload;
- create a `deal_multisig_transactions` row with action `refund_to_buyer` and status initially pending/submitted according to the existing lifecycle;
- bind the request to decision ID, exact recipient, exact token, exact amount, Safe nonce, Safe transaction hash, and immutable decision hash;
- require the configured Safe signatures and normal Safe execution process; never broadcast or sign from the decision endpoint.

Reject zero/negative amounts, amounts exceeding verified refundable balance, wrong recipient/token/network, stale nonce/owner/threshold, duplicate requests, and any mismatch between decision and transfer payload.

### C. Receipt verification and atomic refund finalization

Do not reuse the seller-release finalizer by weakening its seller/platform transfer assumptions. Implement a separate refund finalization path or a carefully discriminated shared internal verifier with separate, exhaustive action-specific invariants.

Before finalizing, independently verify:
- canonical BNB Chain receipt and configured confirmation depth;
- successful Safe execution event for the expected Safe transaction hash;
- exact token contract and exact buyer recipient;
- exact refund amount and one unambiguous matching transfer;
- no reorg/receipt mismatch, duplicate transfer log, or conflicting prior finalization.

One database transaction must then mark the Safe transaction confirmed, record tx/receipt references, resolve the dispute/deal to the buyer outcome, update the refund state, and append immutable audit events. Replaying the same verified tx must be idempotent; a different tx or payload must fail closed.

### D. Seller-win outcome

Resolve/close the dispute without creating a buyer refund. Any subsequent seller release must still pass the existing seller-release finalizer and all acquisition, agreement, signer, Safe, and evidence gates. The dispute decision must not directly release funds.

## 4. Required test matrix

- unauthenticated and non-admin decision attempts;
- non-participant and non-active dispute;
- duplicate and conflicting decisions;
- invalid decision reason and missing evidence references;
- buyer wallet missing/unverified or changed after decision;
- full refund and partial refund bounds against confirmed funded balance;
- zero, negative, over-funded, wrong-recipient, wrong-token, wrong-chain amounts;
- stale Safe nonce, owners, threshold, or Safe address;
- invalid/reorged/unconfirmed receipt and wrong Safe execution event;
- duplicate/ambiguous transfer logs and exact amount mismatch;
- replay of same tx and conflicting tx replay;
- concurrency between decision/refund finalization and seller finalization/dispute state changes;
- atomic rollback assertions for every failure;
- seller-win path creates no refund and does not bypass seller release gates.

All race tests must use independent PostgreSQL sessions and the actual RPC/finalizer functions, with committed disposable fixtures and bounded waits.

## 5. Commission/legal blocker

The authoritative signed 20-article agreement is not present in the reviewed repository/context. Do not invent legal language, a fee formula, or a commission waiver. Until that document is supplied/recovered and approved:
- preserve the already persisted commission policy;
- do not implement partial-refund fee allocation where the agreement controls the calculation;
- permit implementation/testing of decision records and refund mechanics only behind a fail-closed policy gate for the unresolved fee treatment.

## 6. Implementation order

1. Finish the current isolated CI run and resolve any failures.
2. Inventory exact live-schema definitions for disputes, messages/evidence, wallet bindings, funded payment records, multisig transaction constraints, audit triggers, and RLS.
3. Design and review the decision schema/RPC lock order; add migration and rollback only to the isolated branch.
4. Add decision authorization and immutable-decision tests.
5. Add buyer refund request builder and payload-binding tests.
6. Add independent Safe receipt verification and action-specific refund finalizer tests.
7. Add full/partial refund and concurrency tests.
8. Re-run complete isolated CI, migration ordering checks, static security review, and consistency review.
9. Keep PR #190 Draft and unmerged until all V1 completion gates are met.

## 7. Current status

The legal document prerequisite has advanced: the owner-approved Arabic V1.0 agreement and its SHA-256 registry are committed on the isolated branch. Issue #192 remains open until the complete EIP-712/client/SQL integration and CI checks pass. Issue #195 remains unimplemented: decision records, refund requests, refund receipt verification, and refund finalization still require schema inventory and isolated implementation. This document records a proposed implementation sequence from the inspected V1 baseline. It does not claim that dispute decisions or refunds are implemented. No database migration, production change, wallet action, or fund movement is performed by this plan.
