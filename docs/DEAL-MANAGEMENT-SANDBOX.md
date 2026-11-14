# Web3Market Deal Management Sandbox

**Status:** isolated design and UI prototype  
**Branch:** `prototype/deal-management-system-20261114`  
**Production impact:** none intended; do not merge or deploy without separate approval.

## Safety boundary

This sandbox is intentionally a static front-end prototype. It does not import the production Supabase client, call Edge Functions, connect a wallet, submit signatures, read BNB Smart Chain, create a Safe transaction, or mutate production data. All sample values and button actions are local demo state only.

The page is `/deal-management-preview.html` when served from this branch.

## Product decisions represented

- Existing marketplace, accounts, dashboards, AI Code Audit, AI Passport, offer system, Deal Room, Safe integration and records are retained as existing platform capabilities. This prototype does not replace or delete them.
- Initial seller acceptance is preliminary and does not lock the price.
- The final price becomes binding only after the buyer, seller and platform approve the final agreement.
- Platform commission is shown as 7.5%; the ordinary-case seller share is 92.5%.
- Deal payment asset is USDT on BNB Smart Chain (BEP-20). BNB is used for network gas, not as the deal consideration.
- The deposit must be independently verified against the approved token contract, BNB Smart Chain, deal-specific Safe, exact final amount, successful receipt and Transfer event, confirmations, and unique transaction hash.
- AI verification is evidence-based; uncertain asset transfers must remain “Needs Review”.
- Disputes require evidence exchange, a defined response window, a reasoned platform decision and an agreement-defined payout/refund allocation.
- Settlement must be an authorized Safe transaction, preferably an atomic batch. A database status flag is not a Safe lock.
- No independent escrow contract is introduced.

## Proposed system architecture for the next implementation stage

1. **Deal orchestration:** retain current `deals` records and map current states to the agreed lifecycle before any schema change.
2. **Negotiation ledger:** append-only offer/counter-offer events, actor, amount, currency, note, and timestamp; only buyer/seller may change price proposals.
3. **Agreement snapshot:** immutable versioned snapshot of final amount, assets, deadlines, inspection window, dispute procedure, token contract, Safe destination and payout allocations.
4. **Three-party approval:** authenticated, server-validated acceptance of the exact agreement version. Never infer agreement from chat or a preliminary offer acceptance.
5. **Deposit verifier:** server-side BSC receipt/log verification; idempotent transaction-hash binding; no browser-submitted claim treated as proof.
6. **Asset evidence:** per-asset transfer evidence, AI result, source, checked-at timestamp and explicit “Needs Review” outcome.
7. **Buyer acceptance:** per-asset acceptance and final acceptance event.
8. **Dispute workflow:** claimant evidence, notice, response deadline, response evidence, reasoned decision and payout allocation.
9. **Safe execution:** separately reviewed Safe Guard/Module policy and transaction builder; verify execution receipt and emitted transfers before marking settlement complete.
10. **Audit trail:** append-only event history with least-privilege access; sensitive evidence and financial data are not copied into broad admin logs.

## Blocking decisions before live financial integration

- Confirm the exact official USDT BEP-20 token contract and how it is pinned/configured.
- Select and security-review the Safe Guard/Module design that actually blocks unauthorized transfers during an open dispute.
- Finalize Safe owners, threshold, signer availability and emergency behavior for the new deal model.
- Define commission treatment for full buyer refunds and partial dispute allocations.
- Set response deadlines, inspection window defaults, cancellation rules and non-response consequences.
- Obtain legal review of the binding agreement and internal dispute mechanism.
- Decide testnet environment, test Safe addresses and test token setup.
- Map existing database schemas and functions before creating migrations; no production migration is authorized.

## Acceptance criteria before any production consideration

- No route from the preview to production credentials or live transaction signing.
- Tests cover negotiation versioning, three-party agreement binding, amount/fee arithmetic, duplicate payment hash rejection, wrong token/network/Safe/amount rejection, insufficient confirmations, and reorg-safe finality handling.
- Tests cover each asset transfer state, buyer partial/final acceptance, dispute response deadline and non-response, full refund, partial allocation, and seller payout.
- Safe tests demonstrate that an open dispute prevents execution at the Safe layer, not merely in the UI or database.
- Every payout/refund batch is checked for recipients and amounts before signatures; completion is recorded only after an on-chain successful execution receipt.
- Security review and legal review are complete.
- Separate written approval is obtained before any production merge, deployment, database migration or real-fund test.

## Current scope delivered

- A self-contained responsive UI preview with overview, price/commission calculator, asset checklist, agreement approval states, Safe deposit requirements, dispute outline and activity log.
- Local demo interactions are explicitly marked as simulations and never claim an on-chain deposit, signature, verification or freeze.


## Additional isolated domain layer added

- `prototype/deal-management/core.ts` contains pure, side-effect-free rules for six-decimal USDT integer arithmetic, ordinary 7.5% commission split, normalized BSC deposit-evidence validation, guarded deal-stage transitions and exact dispute-allocation reconciliation.
- `prototype/deal-management/core.test.ts` adds Deno tests for precision, the 7,000 USDT example, wrong network/token/recipient/amount, duplicate transaction hash, failed receipt, insufficient confirmations, agreement/deposit gates, dispute pause, Safe-execution completion gate and allocation reconciliation.
- Suggested local command from repository root: `deno test prototype/deal-management/core.test.ts`.
- These tests have been authored but have **not** been executed in this environment. Do not describe them as passing.
- Deposit validation accepts a normalized evidence object only. A future trusted server-side adapter must independently obtain and decode the BSC receipt/logs, verify the configured token contract and Safe, enforce finality policy and atomically reserve the transaction hash. No such adapter is implemented here.


## Read-only BSC adapter contract added

- `prototype/deal-management/bsc-readonly-adapter.ts` defines an injected, read-only client interface and a receipt verifier for BNB Smart Chain (chain ID 56).
- It checks the receipt transaction hash and success status, computes confirmations from the receipt block and current head, rejects reused transaction hashes, and requires exactly one matching ERC-20 Transfer log from the configured token contract to the configured deal Safe for the exact agreed amount.
- The module has no RPC endpoint, network client implementation, credentials, wallet, signer, transaction builder or write method. It does not establish which token address is the official USDT contract; that address must be verified and pinned through an authoritative source and separate review.
- `prototype/deal-management/bsc-readonly-adapter.test.ts` adds mocked-reader tests for a valid deposit, wrong network, duplicate hash, missing receipt, insufficient confirmations, failed receipt and amount mismatch.
- Both the original domain tests and these adapter tests remain **authored but not executed**. No passing test claim is made. The mocked reader is not a substitute for testnet integration or reorg/finality testing.


## Negotiation and agreement controls added

- `prototype/deal-management/negotiation.ts` adds pure rules for buyer/seller offers, counter-offers, rejection and acceptance.
- A seller's preliminary acceptance of the buyer's initial offer leaves that offer open and explicitly does not lock the price or authorize a deposit. Either party can continue with a counter-offer until one current offer is explicitly accepted by the other party.
- Versioned agreement approval requires the buyer, seller and platform to approve the exact current version and snapshot hash. Any revision must increment the version and clears all previous approvals.
- `prototype/deal-management/negotiation.test.ts` covers preliminary acceptance, counter-offer flow, acceptance restrictions, three-party approval, stale-hash rejection and approval invalidation after revision.
- These tests are authored but have **not** been executed. The snapshot hash is supplied by the caller; this module does not calculate a cryptographic hash, authenticate signers, persist immutable records or collect cryptographic signatures. Those remain server-side implementation and security-review requirements.
