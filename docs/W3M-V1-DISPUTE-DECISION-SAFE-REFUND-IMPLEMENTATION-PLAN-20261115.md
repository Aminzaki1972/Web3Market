# W3M Protocol V1 — Dispute Decision and Safe-only Refund Implementation Plan

Date: 2026-11-15
Scope: isolated V1 branch only. Planning artifact; not a production migration or authorization to deploy.

## 1. Verified current state

- `open_deal_dispute(uuid,text)` is an authenticated participant-only RPC. It locks the deal row, inserts one dispute, sets `deals.status='disputed'` and `deals.dispute_status='open'`, and writes `dispute_opened`.
- `deal_disputes` currently uses the statuses `open | under_review | resolved | cancelled`, one dispute per deal, and has no authenticated participant UPDATE policy.
- `deal_multisig_transactions.action` includes `refund_to_buyer`, but an enum/check value is not an implemented refund workflow.
- The current Safe finalizer is deliberately seller-release-specific: it requires `action='release_to_seller'`, verifies exactly two USDT transfers (seller net + platform fee), then completes the deal and transfers project ownership.
- Existing independent-session tests now exercise the actual finalizer against dispute opening, signer revocation, project ownership changes, report appends, and evidence appends. The focused legacy dispute concurrency test is not a substitute for those finalizer tests.
- The owner-approved Arabic 20-article agreement is now committed at `docs/legal/W3M-DEAL-AGREEMENT-AR-V1.0.md` (document ID `W3M-AGREEMENT`, version `1.0`, SHA-256 `721aaabcef891b8cdd43cdc34e1980f2166ce32282162d927da942ef8ec10531`) and is integrated into the isolated EIP-712 acceptance flow under Issue #192. This owner approval is not a claim of final independent legal review or jurisdiction-specific enforceability. The agreement protects the platform's 7.5% commission but does not yet provide a sufficiently precise executable formula for allocating commission on partial buyer refunds. Partial-refund fee allocation must therefore remain fail-closed and must not be invented.

## 1A. Read-only live-schema inventory (2026-11-15)

The connected production schema was inspected read-only to avoid designing against guessed columns or policies. No rows were modified and no migration was applied.

- `deals`: has `status` including `disputed`, `dispute_status` values `none | open | under_review | resolved_buyer | resolved_seller | closed`, `payment_status`, `payment_tx_hash`, `funded_at`, `chain_id`, `safe_address`, `token_contract`, `expected_amount`, and locked fee fields.
- `deal_disputes`: has `id, deal_id, opened_by, reason, evidence jsonb, status, resolution, resolved_by, resolved_at`; allowed dispute statuses are `open | under_review | resolved | cancelled`; a unique index enforces one dispute per deal.
- RLS currently permits authenticated participants to INSERT disputes and permits participants/admins to SELECT them; no participant UPDATE policy was found. This supports a server-only decision path rather than browser-side updates.
- `deal_multisig_transactions`: has the `refund_to_buyer` action value, amount, chain/Safe address, nonce, destination, calldata, operation, gas fields, Safe transaction hash, status, signatures, and confirmations. Its current RLS is participant SELECT only; no working refund RPC was identified.
- `deal_release_policies`: stores the locked 7.5% fee, fee amount, seller net, platform wallet, Safe, token contract, chain, and Safe nonce.
- `blockchain_transactions`: has chain ID, tx hash, transaction type, amount, token symbol, from/to, status, block number, confirmation timestamp and metadata; a partial unique index permits one `transaction_type='payment'` record per deal. It does not have a first-class token-contract column, so refund eligibility must independently verify the deal's configured token contract and on-chain receipt rather than trusting `token_symbol` or metadata alone.
- `deal_messages`, `deal_assets`, `deal_events`, and `deal_audit_logs` are available as existing deal evidence/audit sources. Evidence references must be checked against the same deal and the actor's permitted scope.
- Existing deal-state trigger permits `disputed -> in_progress | completed | cancelled`; the dispute status column has separate values. The new RPC must update both vocabularies consistently and must not bypass the fee-lock or sensitive-field triggers.
- The isolated V1 seller finalizer now allows parent `deals.dispute_status` only in `none | resolved_seller`; a disputed seller release additionally requires an immutable decision row for that exact deal/dispute proving `seller_wins`. `resolved_buyer` and generic `closed` states block seller release. Do not map a seller-win result to generic `closed` merely to bypass the gate. The dispute row should use its allowed status `resolved` and store `buyer_wins | seller_wins` in `resolution`; the parent deal should use `resolved_buyer | resolved_seller`. Keep the deal in `disputed` while the buyer refund is pending; only the verified refund finalizer should move it to `cancelled`. A seller-win deal remains blocked until the seller-release finalizer verifies the persisted seller-win decision.
- `public.is_admin()` delegates to `private.support_is_admin()`, which checks the authenticated user's `profiles.role='admin'`. A decision endpoint must still verify the session and invoke the server-side admin check; a browser-supplied role is never authority.

Implementation consequence: keep decision authorization and immutable decision persistence separate from Safe refund request creation and receipt finalization. Treat confirmed payment records as candidate funding evidence only after cross-checking their tx hash, chain, exact token contract, Safe recipient, amount, canonical receipt and confirmations.

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
- persists decision ID, dispute/deal IDs, outcome, decision-maker, server timestamp, exact signed terms version/hash, the active prior deal/dispute state, canonical payload hash, and prior-state reference;
- rejects duplicate/conflicting decisions and records an append-only audit event;
- transitions dispute/deal status atomically, without allowing participants to update the decision directly.

Do not add a new user-facing appeal or arbitration feature in V1 unless separately approved.

### A1. Decision table and RPC contract (implementation target)

Create an append-only `w3m_deal_dispute_decisions` table with:
- `id` UUID primary key and `dispute_id` UNIQUE (one authoritative decision per dispute);
- `deal_id`, `outcome` constrained to `buyer_wins | seller_wins`, bounded `reason`, and canonical `evidence_refs` JSONB;
- `decided_by`, server-generated `decided_at`, exact `terms_version_id`, `terms_version`, and `terms_hash`;
- prior deal/dispute state fields, canonical payload JSONB, and lowercase 64-character SHA-256 `decision_hash`.

Enable RLS, revoke direct participant writes, and add a trigger rejecting UPDATE/DELETE/TRUNCATE. The only write path is the service-role-only `w3m_admin_decide_deal_dispute` RPC called by the new authenticated Edge Function `w3m-protocol-v1-dispute-decision`. The Edge Function verifies the bearer session and checks the existing `profiles.role='admin'` authority; the RPC independently sets the verified session subject and calls the existing `public.is_admin()` / `private.support_is_admin()` policy before writing.

RPC lock order must be `deal_disputes FOR UPDATE` then `deals FOR UPDATE`. The existing row-level dispute mutation trigger locks the child row before acquiring the parent deal lock; matching that effective order avoids a child/parent deadlock. The Safe finalizer locks only the parent deal and deliberately does not lock child dispute rows.Production read-only inspection confirmed `pgcrypto 1.3` is installed in the `extensions` schema; use the fully qualified `extensions.digest(..., 'sha256')` in the SQL implementation and do not alter/pin the extension version. The SQL RPC is the authority for evidence snapshots, canonical JSONB serialization, and the persisted decision hash; it must compute and persist these atomically while holding the deal/dispute/evidence locks. The TypeScript canonical builder is a deterministic reference and validation layer, not a substitute for the database transaction or its content-hash revalidation. Revalidate that the deal and dispute are active and consistently disputed, no prior decision exists, both parties accepted the latest immutable terms version, and every evidence reference belongs to the same deal. Supported evidence source keys are `deal_message`, `deal_asset`, `deal_event`, and `deal_audit_log`, mapped to `deal_messages`, `deal_assets`, `deal_events`, and `deal_audit_logs`. The RPC stores a full immutable JSONB snapshot and its server-computed SHA-256 content hash for each referenced record in the canonical decision payload.

The RPC updates the dispute row to `status='resolved'`, stores `resolution='buyer_wins'|'seller_wins'`, and updates the parent `deals.dispute_status` to `resolved_buyer | resolved_seller`. Keep `deals.status='disputed'` until the corresponding Safe settlement is chain-confirmed. The RPC returns the immutable decision ID/hash and exact resulting states; repeated identical calls may return the same decision as an idempotent replay, while a conflicting outcome must fail.

### B. Buyer-win Safe refund request

For a buyer-win decision:
- derive buyer wallet and verified funded balance from persisted server-side deal/payment records;
- validate chain ID 56, the configured official USDT contract, the deal's Safe address, current Safe owners/threshold, current nonce, and the exact transfer payload;
- create a `deal_multisig_transactions` row with action `refund_to_buyer` and status `awaiting_signatures`, then `signed`, `submitted`, and `confirmed` only as the Safe lifecycle advances;
- bind the request to decision ID, exact recipient, exact token, exact amount, Safe nonce, Safe transaction hash, and immutable decision hash;
- require the configured Safe signatures and normal Safe execution process; never broadcast or sign from the decision endpoint.

Reject zero/negative amounts, amounts exceeding verified refundable balance, wrong recipient/token/network, stale nonce/owner/threshold, duplicate requests, and any mismatch between decision and transfer payload.

### C. Receipt verification and atomic refund finalization

Do not reuse the seller-release finalizer by weakening its seller/platform transfer assumptions. Implement a separate refund finalization path or a carefully discriminated shared internal verifier with separate, exhaustive action-specific invariants.

Before finalizing, independently verify:
- canonical BNB Chain receipt and configured confirmation depth;
- successful Safe execution event for the expected Safe transaction hash;
- exact token contract, buyer recipient, and platform-fee recipient;
- the exact approved transfer set: buyer refund plus the protected platform-fee transfer, with no extra, duplicate, or ambiguous transfers;
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

The owner-approved Arabic 20-article agreement is now present in the isolated repository at `docs/legal/W3M-DEAL-AGREEMENT-AR-V1.0.md`, registered as `W3M-AGREEMENT-V1.0` with SHA-256 `721aaabcef891b8cdd43cdc34e1980f2166ce32282162d927da942ef8ec10531`. The isolated EIP-712 acceptance flow binds the canonical document version/hash. This does not establish final independent legal review, jurisdiction-specific enforceability, production activation, or signatures by actual deal parties.

The agreement preserves W3M's 7.5% commission and prohibits bypassing or waiving the platform fee without authorization. It does not provide a sufficiently precise executable arithmetic allocation for every partial buyer-refund scenario. Therefore:
- preserve the locked 7.5% commission policy and the exact signed deal terms;
- do not invent pro-rata, full-retention, or waived-fee arithmetic for partial refunds;
- keep any refund case whose fee allocation is not expressly determined by the signed agreement fail-closed;
- implement and test the decision and Safe mechanics independently of unresolved refund arithmetic, without creating or signing a Safe transaction for a blocked case.

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

The owner-approved Arabic V1.0 agreement and SHA-256 registry are committed; Issue #192 is complete on the isolated branch. For Issue #195, the immutable decision table, service-role-only decision RPC, admin-only Edge Function, evidence snapshots/content hashes, latest-terms and both-party acceptance checks, and seller-wins-only Safe release gate are now implemented on the isolated branch. TypeScript checks/tests have passed; the current disposable PostgreSQL migration/test run is still in progress. The RPC writes `deal_disputes.status='resolved'`, `resolution='buyer_wins'|'seller_wins'`, and parent `deals.dispute_status='resolved_buyer'|'resolved_seller'`, while `deals.status` remains `disputed` until the matching Safe settlement is chain-confirmed. Buyer refund request/signature/receipt/finalization and the admin Deal Room review UI remain pending; refund arithmetic is deliberately fail-closed. The generated migration has not been applied to production. No merge, deployment, wallet signing, or fund movement has occurred.
