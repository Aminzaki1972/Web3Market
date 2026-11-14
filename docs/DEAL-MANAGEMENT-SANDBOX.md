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
- Commission treatment is defined: buyer bears the full 7.5% of the original gross agreed amount; dispute refunds deduct it from the buyer gross refund bucket, with shortfalls rejected.
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


## Dispute lifecycle rules added

- `prototype/deal-management/disputes.ts` models claimant evidence, respondent notice/response window, explicit response expiry, a reasoned one-time platform decision, agreement-defined allocation reconciliation, and a separate Safe-execution-pending state.
- A respondent cannot submit a response after the configured deadline. If no response arrives, expiry must be explicitly recorded before a decision can be issued.
- A decision requires a non-empty reason and buyer refund + seller payout + platform fee that exactly reconcile to the deposited amount. This validates arithmetic only; it does not decide what allocation is fair or legally required.
- Execution is not marked complete until a trusted external verifier supplies a successful Safe receipt confirmation and transaction hash.
- `prototype/deal-management/disputes.test.ts` covers claimant/response order, deadline expiry, balanced allocation, one-time decision and Safe receipt completion.
- These tests are authored but have **not** been executed. The module does not send notices, run timers, authenticate participants, adjudicate disputes, freeze Safe assets, or verify chain receipts. No actual pause/freeze or payout protection exists in this sandbox.


## Asset transfer evidence and buyer review rules added

- `prototype/deal-management/asset-transfer.ts` models per-asset transfer evidence and verification metadata (status, summary, source and checked-at time). It is a pure domain module with no GitHub, registrar, AI, database or network integration.
- GitHub member invitations/access do not qualify as ownership-transfer proof; the evidence gate requires a repository transfer completion or verified organization-owner control evidence. Domain DNS changes alone do not qualify; registrant change or registrar-account control transfer evidence is required. Other assets require an independent control proof or supported transfer receipt. Unsupported/ambiguous evidence remains `needs_review`.
- `prototype/deal-management/asset-transfer.test.ts` covers these rules, evidence metadata, and required-vs-optional assets.
- `prototype/deal-management/buyer-review.ts` models a configurable inspection window (including explicitly unset), acceptance per asset, a final acceptance only after all required assets are accepted, and rejection with a reason. Rejection is recorded but does not silently create a dispute; dispute initiation remains an explicit next action under the agreement.
- `prototype/deal-management/buyer-review.test.ts` covers per-asset and final acceptance, configurable/no inspection window, rejection, unverified asset blocking and duplicate IDs.
- These tests are authored but **not executed**. No real ownership checks, AI verification, buyer notifications, timers, dispute creation, payout readiness, or Safe operations are implemented.

- The standalone preview now includes an isolated Buyer Review tab with per-asset demo acceptance, final acceptance gating, optional inspection-window selection (unset by default), and a reasoned demo rejection state. These controls update local page state only; they do not create a dispute or authorize payout.

- The asset verification guard also prevents a caller from marking GitHub/domain assets verified unless the evidence types meet the asset-specific minimum gate; duplicate evidence IDs are rejected. This remains a local domain rule, not an external ownership check.


## Payout readiness and settlement gates added

- `prototype/deal-management/payout-readiness.ts` separates ordinary payout readiness from dispute-decision payout readiness. It returns explicit blockers or a reviewable allocation marked `ready_for_safe_review`; it does not build, sign or submit Safe transactions.
- Ordinary payout requires approved agreement, independently verified deposit amount, all required assets verified, final buyer acceptance and no open dispute. The ordinary split is 92.5% seller / 7.5% platform.
- Dispute payout requires approved agreement, verified deposit, a reasoned finalized decision, and an exact 7.5% fee recomputed from the original gross agreed amount. The decision records buyer gross refund bucket + seller payout = deposit; the net buyer refund is gross buyer bucket minus full fee.
- Active recipient addresses must be valid EVM addresses and cannot duplicate one another. Zero-value allocations do not require an active recipient address.
- `prototype/deal-management/payout-readiness.test.ts` covers ordinary gates and split, blockers, invalid/duplicate recipients, partial dispute allocation, full buyer refund, mismatched allocations and missing agreement/deposit.
- The preview includes a Settlement tab that explains both readiness paths and explicitly distinguishes readiness for Safe review from actual Safe authorization/execution.
- These tests are authored but **not executed**. No Safe transaction construction, signer collection, Guard/Module, transaction execution, chain receipt verification or production integration is implemented.


## Lifecycle hardening and integrated workflow coverage

- The shared transition guard now requires a confirmed deposit before asset-transfer progression, completed transfer and AI verification before buyer review, and a finalized dispute decision before moving a resolved dispute to payout readiness. Completion still requires separately confirmed Safe execution evidence.
- Deposit evidence validation now rejects malformed token, Safe and Transfer-recipient addresses in addition to mismatched values.
- Dispute evidence IDs must be unique across both parties; evidence timestamps and decision timing are checked against the dispute opening, response deadline and prior evidence.
- `prototype/deal-management/workflow.test.ts` connects the pure sandbox modules through a simulated buyer offer, seller preliminary acceptance, counter-offer, final price acceptance, three-party agreement approval, normalized deposit evidence, asset verification, buyer acceptance and ordinary payout allocation.
- All of these are authored tests only. Deno is not installed in the current execution environment, so the test suite remains **unexecuted** and must not be described as passing. The workflow uses mock evidence and does not establish a real deposit, asset transfer, Safe review or payment.


- Counter-offers now use the new unique offer ID while superseding the single current open offer. The same rule supports alternating buyer/seller counter-offers; this closes a defect where the prior implementation could not create a valid counter-offer.
- `prototype/deal-management/negotiation.test.ts` now covers seller and buyer counter-offers in sequence. The integrated workflow test uses the same corrected offer-ID contract.


## Additional transition safety checks

- A deal cannot enter agreement-pending until the buyer/seller price negotiation has an explicitly accepted final price.
- Awaiting-deposit requires both final-price acceptance and all three agreement approvals.
- A deal with a confirmed deposit cannot be marked cancelled through the ordinary state transition helper. Any post-deposit termination must use a separately agreed refund/dispute and verified Safe execution path.
- These are still pure sandbox checks; a future backend must enforce them server-side from immutable agreement records and trusted chain evidence.


## Dispute payout suspension rule — confirmed sandbox behavior

- As soon as a dispute is opened in the deal workflow, ordinary payout readiness is blocked and the state machine cannot advance to payout or completion while the dispute remains unresolved.
- A deal that has ever entered a dispute cannot later use the ordinary 92.5%/7.5% payout helper. Once a reasoned decision is finalized, it must use the explicit buyer-refund / seller-payout / platform-fee allocation from the dispute decision.
- A dispute decision does not itself move funds or mark the deal complete. The decision allocation is only prepared for Safe review; authorized Safe signatures and independently verified on-chain execution remain required.
- This is sandbox domain logic only. It does not freeze a real Safe or stop owners/modules from sending transactions. Real enforcement requires the separately reviewed Safe Guard/Module design and a confirmed on-chain lock.


### Dispute-history bypass prevention

The state-machine flags now distinguish an actively open dispute from a deal that has ever entered dispute. Clearing the active flag alone cannot route the deal through ordinary buyer-acceptance payout: disputed deals must enter payout readiness from the dispute-decision stage with a finalized decision. Completion also requires that final decision plus verified Safe execution. The flag must be derived from append-only trusted deal history, not from a client-supplied boolean. This remains sandbox domain logic, not an authorization boundary.


## Execution confirmation hardening

The pure dispute state machine intentionally stops at `execution_pending`. It has no function that accepts a caller-supplied receipt boolean to mark funds paid or a dispute executed. A live implementation remains blocked until a trusted server-side BNB receipt verifier binds the exact Safe execution and decision allocation to canonical chain evidence.

 
## CI verification record — 2026-11-14

GitHub Actions workflow `.github/workflows/deal-management-sandbox-tests.yml` executed on isolated branch commit `5a89ad8ad581d04241e3c321dc4b700ddd12fa61`.

- Deno 2 setup completed.
- All sandbox test files type-checked by Deno.
- Result: **51 passed, 0 failed**.
- The first run exposed one stale expected error string in the BSC read-only adapter test (`transaction_not_successful` versus the adapter's actual `transaction_failed`); the assertion was corrected and the rerun passed.
- This is unit/domain-logic CI only. It does not test a deployed Safe Guard/Module Guard, live RPC, real USDT transfer, database authorization, concurrency, BNB fork behavior, or production runtime.

Cloudflare Pages reported a successful **branch preview** build for the same commit. This is a preview deployment, not a production deployment; no production release or production configuration change was requested or performed.

## User-approved commission treatment for refunds — 2026-11-14

The user has now resolved the refund-fee question:
- The buyer bears the **entire platform commission**, not the seller.
- The commission remains calculated on the original gross final agreed deal amount at the agreed rate (currently 7.5%), regardless of the outcome.
- When funds are refunded to the buyer, the full commission is deducted from the amount otherwise refundable to the buyer; it is not prorated to the seller's payout or the amount retained by the seller.
- Example: gross deal amount 10,000 USDT; commission 7.5% = 750 USDT. If the administrative decision is a full refund, the buyer receives 9,250 USDT and the 750 USDT commission is allocated to Web3Market.
- In partial-refund or split outcomes, the same full gross-based commission is borne by the buyer and deducted from the buyer's gross refund allocation before the buyer's net refund is transferred. The administrative decision must show gross buyer refund allocation, full commission, net buyer refund, seller allocation and exact sum.
- No allocation may be executed unless all amounts reconcile exactly to the verified Safe balance and the agreement. If the buyer's gross refund allocation is smaller than the full commission, the current rule does not by itself specify how the shortfall is funded. Do not silently charge the seller, create a new buyer debt, or exceed the buyer's refund. Flag this edge case for explicit agreement wording/administrative handling before funding or execution.

This commission rule is an approved product decision. It remains a specification, not a live financial implementation.


## Code-level dispute commission enforcement — isolated sandbox update

- The dispute decision now records `buyerGrossRefund` (before commission), `sellerPayout`, `platformFee`, and the original gross agreed amount.
- The decision validator recomputes 7.5% from the original gross amount, requires the deposit to equal that gross amount, requires the buyer gross refund bucket to cover the full fee, and requires the buyer bucket plus seller payout to equal the deposit.
- The payout readiness function independently checks the decision's gross amount, deposit amount and fee, then derives the net buyer refund by subtracting the full fee. It does not accept a caller-selected reduced fee.
- Tests were updated for full refund (10,000 gross -> 9,250 buyer / 750 platform), mixed outcome (4,000 gross buyer bucket -> 3,250 buyer net / 6,000 seller / 750 platform), seller-only outcome (0 buyer net / 9,250 seller / 750 platform), fee mismatch, gross/deposit mismatch and fee-shortfall rejection.
- These are pure domain rules and authored CI tests only. The original agreement amount and decision must be supplied by a trusted authenticated backend in a live implementation; there is no Safe transaction, chain verification, or real fund movement here.


## Latest commission enforcement CI — 2026-11-14

The isolated branch CI workflow completed successfully after the buyer-paid dispute commission code and tests were updated.

- GitHub Actions run: [#56](https://github.com/Aminzaki1972/Web3Market/actions/runs/43619720518)
- Result: **68 passed, 0 failed**.
- The run checks Deno pure-domain sandbox tests only.
- This does not validate an actual Safe Guard/Module Guard, live BNB RPC, official token contract configuration, database/authentication, concurrent transaction processing, production runtime, or real funds movement.


A final adversarial payout-gate test was added to forge a decision object with a buyer gross refund bucket below the fee. The payout-readiness function independently rejected it. Latest CI run: [#59](https://github.com/Aminzaki1972/Web3Market/actions/runs/43619818044), **68 passed, 0 failed**, on code commit `0d52a61a04ac521f0c194329c478a3775a4d71ab`.


## Administrative dispute intake gate — 2026-11-14

The isolated domain layer now separates a dispute request from a formally approved dispute:

1. Either buyer or seller may submit a request with a reason and optional initial evidence.
2. Submission enters `pending_admin_review` and raises a payout hold immediately in the model. No Safe lock is claimed.
3. Only a separately recorded, reasoned administrative approval advances the request to `approved_lock_pending`.
4. An administrative decline advances to `declined_hold`; the payout hold remains in place.
5. A declined request's hold can be released only through a separate explicit administrative action, with a reason and a trusted check that no other active hold exists.
6. An approved request can become `lock_confirmed` only when a normalized proof object reports BNB Smart Chain (56), the exact expected deal Safe, a successful lock transaction, sufficient confirmations, the lock event and independently verified locked state.
7. The dispute payout-readiness gate now binds the request ID to the dispute ID, the request's deal ID to the target deal, and the lock proof to the exact deal Safe. Ordinary payout is blocked while the request is pending, declined-but-not-released, approved, or lock-confirmed. A dispute decision payout plan is not prepared until the exact dispute's lock is reported confirmed.

Files:
- `prototype/deal-management/dispute-intake.ts`
- `prototype/deal-management/dispute-intake.test.ts`
- `prototype/deal-management/payout-readiness.ts`
- `prototype/deal-management/payout-readiness.test.ts`
- `deal-management-preview.html` now demonstrates request submission, administrative approval/decline, explicit release after decline, and the distinct “Safe lock pending — not confirmed” state.

**Critical boundary:** these are pure model transitions and a local UI simulation. The `reviewerId`, the no-other-hold assertion, and normalized lock proof are not authentication or chain verification. A future trusted backend must authenticate the administrator, persist append-only events atomically, prevent concurrent/duplicate requests, verify Safe state and canonical BNB receipts independently, and enforce the hold on every payout API. No live payout endpoint or Safe Guard is connected.

## Latest administrative-intake validation

- GitHub Actions Deno sandbox suite: **80 passed, 0 failed**.
- Run: https://github.com/Aminzaki1972/Web3Market/actions/runs/43620254644
- Tested code commit: `68d5491b51b2bbb91e49a21b24b06b43fc1f0558`.
- This covers pure domain logic only; the HTML preview is not part of the Deno test suite and no real administration, notification, database or Safe operation is exercised.

## Deal conversation archive — product rule clarified 2026-11-14

- The Deal Room has one conversation thread attached to the deal record; it is not a disposable or separate chat feature.
- Buyer and seller are the primary participants and can communicate directly during an ordinary deal.
- Web3Market administration has permission to join the same conversation when needed, but an administrator is not required to participate in normal negotiation, agreement, handover or completion.
- Deal-related messages are retained as part of the deal's chronological archive, including after completion, cancellation or dispute, subject to a separately defined retention/privacy policy.
- Each entry should preserve authenticated sender identity and role, server timestamp, message content and attachment/evidence references. Corrections must be auditable; ordinary participants must not be able to silently rewrite or delete archived entries.
- Chat content is not a substitute for formal agreement-version approval, asset acceptance, dispute decisions or Safe authorization. Those actions remain in their dedicated workflows.
- The preview's Chat tab now demonstrates the primary Buyer/Seller conversation, optional Admin participation, chronological append order and message count. It remains local-only: no authentication, cross-user delivery, permanent storage, attachments or notifications are implemented.
