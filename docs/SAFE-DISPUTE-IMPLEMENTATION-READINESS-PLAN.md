# W3M Safe Dispute Enforcement — Implementation Readiness Plan

**Status:** planning artifact only — not approval to implement, deploy, upgrade, configure or fund any Safe.  
**Scope:** isolated Web3Market deal-management prototype; BNB Smart Chain (56); USDT BEP-20; no independent escrow contract.

## 1. Non-negotiable product invariant

When a dispute is opened, Web3Market immediately stops creating or issuing new payout instructions for that deal. No seller payout, platform fee, buyer refund or partial distribution may be initiated while the dispute remains unresolved. The deal Safe must reject outgoing transactions during the confirmed on-chain lock, except the exact settlement transaction authorized by the final dispute decision and required Safe signatures.

An off-chain dispute record is not an on-chain lock. UI and API states must distinguish:
1. `dispute_submitted`: request persisted; no on-chain lock claim.
2. `lock_pending`: lock transaction broadcast; funds are not yet confirmed locked.
3. `lock_confirmed`: canonical lock event and state verified under the selected finality policy.
4. `decision_final`: reasoned platform decision persisted; Safe remains locked.
5. `settlement_authorized`: exact allocation and authorization validated; Safe remains locked until execution.
6. `settlement_executed_verified`: canonical Safe execution and all expected transfers independently verified.

No stage may be skipped by changing a database status or invoking a browser callback.

## 2. Phase plan and acceptance gates

### Phase 0 — Freeze requirements and decisions (no contract code)

Deliverables:
- Approved dispute initiation authority and anti-abuse rules.
- Approved Safe owner/threshold model for ordinary and dispute settlement.
- Approved platform decision authorization model and key custody/rotation policy.
- Approved lock race and transaction-ordering behavior.
- Approved recovery and incident response policy.
- Contractual fee treatment for full and partial buyer refunds.
- Exact supported Safe deployment/version and USDT token contract verified from authoritative sources.

Exit gate: written user approval of the decision record. Until then, remain in design and sandbox tests.

### Phase 1 — Independent specification and threat model

Deliverables:
- Guard and Module Guard state diagrams and exact call-path coverage.
- Threat model for owner transactions, module transactions, nested MultiSend, delegatecall, approvals, native BNB, arbitrary calls and Safe configuration mutation.
- ABI selector inventory pinned to the chosen Safe version.
- EIP-712 typed-data specification for dispute lock and final decision authorization.
- Nonce, expiry, replay, chain/Safe/deal/agreement binding rules.
- Complete recovery and upgrade policy, including the possibility of a permanently bricked Guard.

Exit gate: specification reviewed by an independent Safe/Solidity security reviewer before implementation.

### Phase 2 — Contract implementation in isolated code only

Deliverables:
- Deal-specific Guard with deny-by-default lock behavior.
- Module Guard only if the chosen Safe version and threat model require it; otherwise enforce no enabled modules and verify this invariant.
- Exact settlement authorization and replay protection.
- Configuration mutation protections.
- Explicit emergency recovery behavior, constrained so it cannot become an ordinary bypass.

Constraints:
- No production keys, wallets, RPC credentials or real funds.
- No deployment to BNB mainnet.
- No independent escrow or custody contract.
- No privileged generic payout switch.
- No automatic AI decision or signing.

Exit gate: static analysis, unit tests, invariant tests and external code review pass.

### Phase 3 — BNB testnet and Safe-fork adversarial integration

Required scenarios:
- Competing payout and lock transactions submitted in the same block and in adjacent blocks.
- Lock transaction delayed, censored, replaced, reverted or reorganized.
- Every outgoing value path blocked while locked: USDT transfer, other ERC-20, native BNB, approvals, arbitrary calls and nested batch calls.
- Guard removal/replacement, Module Guard removal, module enable/disable, fallback handler changes, owner/threshold changes.
- Direct Safe calls and every module execution route.
- MultiSend and MultiSendCallOnly nested CALL/DELEGATECALL combinations; malformed lengths, offsets, operation bytes and trailing data.
- Invalid/replayed/expired signatures; wrong chain, Safe, deal, agreement hash, nonce, token, recipients or amounts.
- Platform key compromise, unavailable signer, RPC disagreement, stale state, reorg and partial infrastructure outage.
- Exact dispute settlement succeeds only when all authorization and Safe threshold requirements pass.
- Recovery paths cannot transfer funds to arbitrary destinations or silently erase the dispute record.

Exit gate: reproducible testnet evidence, independent review of failures, and explicit user approval before any mainnet deployment proposal.

### Phase 4 — Backend verifier and controlled testnet integration

Deliverables:
- Server-side canonical chain reader; no browser-provided receipts or decoded transaction effects.
- Exact Safe proxy/singleton, bytecode hash, Guard, Module Guard, owners, threshold, modules, fallback handler and MultiSend verification.
- Lock event/state verification and finality policy.
- Immutable settlement intent and exact nested transaction decoder.
- Safe execution receipt, expected Safe success event, and every expected Transfer log verification.
- Idempotent event processing, unique tx/decision nonce constraints, concurrency locks and reorg handling.
- Append-only audit trail and monitoring alerts for configuration changes.

Exit gate: backend security review and testnet end-to-end evidence. No production credentials or mainnet transactions at this phase.

### Phase 5 — Mainnet readiness (separate approval required)

Before any mainnet action:
- Independent audit of exact source commit and deployed bytecode.
- Reproducible build and deployment artifact verification.
- Confirmed Safe version and all live deployment addresses/code hashes.
- Audited key management, signer recovery, RPC redundancy, monitoring and incident playbooks.
- Legal review of agreement, dispute decision authority, lock delays, abuse and refund fee policy.
- Small-value controlled pilot plan and explicit user authorization.

No mainnet deployment, Safe setup transaction, upgrade, guard installation or deposit is authorized by this document.

## 3. Decision register — unresolved, do not infer

| Decision | Candidate considerations | Current status |
|---|---|---|
| Who can initiate lock? | Either buyer or seller typed signature; Safe threshold; platform-only key | Not selected |
| Can one party grief-lock? | Evidence hash, reason codes, filing deadline, abuse consequences, repeated-dispute controls | Not decided |
| Who authorizes final platform decision? | Dedicated platform decision key; multisig/MPC; independent attestation | Not selected |
| Safe owners and threshold? | Buyer/seller/platform roles; 2-of-3 is a previous proposal, not assumed final here | Not confirmed for this new design |
| Guard immutability? | Immutable deployment versus upgradeable with constrained governance | Not selected |
| Module policy? | No modules by default; Module Guard required if modules are permitted | Pending version-specific review |
| Lock race handling? | Mempool monitoring, payout proposal freeze, ordering policy, emergency pause | Not fully resolved |
| Recovery? | Narrow recovery authority, timelock, independent approvals, or no recovery | Not selected |
| Fee on full/partial refund? | Agreement-defined fee basis and explicit allocation | Not finalized |
| Finality policy? | Confirmation count and reorg response for BNB Chain | Not specified |

## 4. Required recovery principles

Recovery is a critical power, not an administrative convenience. Any recovery mechanism must:
- never allow ordinary owner or platform API action to bypass a confirmed dispute lock;
- bind recovery to the exact Safe, chain, deal and incident;
- require a separately approved authorization threshold and a delay/notice rule where feasible;
- prohibit arbitrary recipient or amount selection;
- preserve the original dispute and recovery evidence permanently;
- be independently tested against compromised platform keys and unavailable signers;
- define what happens if the Guard itself contains a bug and no safe recovery exists.

If a safe recovery path cannot be proven, the risk must be disclosed before funds are accepted. Do not invent a backdoor or claim guaranteed recovery.

## 5. Race-window rule

On dispute intake, the backend atomically records the dispute and blocks all new payout proposals. It then submits the on-chain lock request. Until the canonical lock is confirmed, the interface must explicitly say the funds are not yet confirmed locked. If a payout is already signed or submitted, the system must inspect its nonce, execution state and chain ordering; it cannot promise that a later lock retroactively cancels it.

The system must define a fail-safe response for lock submission delay, mempool censorship, RPC disagreement and reorganization. An off-chain "freeze" flag is never a substitute for this.

## 6. Explicit non-goals

- No independent escrow contract.
- No AI authority to decide legal ownership or execute/sign money movement.
- No automatic payout module in the initial design.
- No assumption that a 2-of-3 Safe threshold alone enforces a dispute lock.
- No mainnet deployment, Safe migration, production database or UI changes in this planning phase.

## 7. Current readiness

The TypeScript policy model and sandbox tests are useful specification checks only. They do not establish Solidity correctness, Safe hook coverage, chain state, lock effectiveness, recovery safety or protection of real funds. Contract coding begins only after Phase 0 decisions are explicitly approved and the threat model is independently reviewed.

## User-approved governance and financial rules — 2026-11-14

These requirements were explicitly supplied by the Web3Market owner and supersede conflicting candidate wording:

### Dispute intake and opening
- Either buyer or seller may submit a dispute request to Web3Market administration.
- Submission is a request for administrative review; it is not automatically an approved/open dispute.
- Administration reviews the request and decides whether to formally open the dispute.
- While review is pending, the entire deal is put on administrative-review hold: no new payout proposal or payout instruction may be issued. The UI must not claim the Safe is on-chain locked.
- If administration approves opening, initiate the on-chain lock. Do not describe the Safe as locked until canonical lock state is independently verified under the finality policy.
- If administration declines, record reasons. Remove the administrative hold only through an explicit recorded administrative action after checking that no other hold/security incident exists.

### Final financial authority
- Web3Market administration has final decision authority for every financial outcome: seller payout, full/partial buyer refund, split allocation, platform commission and any other financial distribution.
- Record a reasoned decision with exact recipients, amounts, agreement reference and immutable decision identifier/hash.
- AI may collect and summarize evidence but cannot make the final financial decision, authorize allocation or execute a transfer.
- Safe owner signatures and Guard policy are technical execution controls; they do not replace the administration's decision authority.

### Platform commission basis
- Commission is calculated on the gross final agreed deal amount, regardless of completion, full refund, partial refund, equal split or another percentage allocation.
- At the currently specified 7.5%, the basis is the original final agreed gross amount, not the amount ultimately paid to the seller.
- Include the commission explicitly in every administrative allocation and agreement record.
- **Still requiring a precise contractual rule:** which party/share bears the commission in full/partial refunds, and how the allocation remains funded when the Safe balance equals the gross deposit. Do not silently deduct it from a buyer refund or assign it to the seller without an approved agreement clause.

### Guard/enforcement failure
- If Guard, Module Guard or any required enforcement component is faulty, missing, bypassable, incompatible or cannot be independently verified, disable the entire deal until repaired and revalidated.
- Disable progression, new deposits/funding, payout proposals, refunds and all outgoing financial execution. No manual status change may bypass the safety hold.
- If funds are already in Safe, prohibit outgoing movement while the fault remains unresolved.
- Re-enable only after repair, reproducible security tests, independent on-chain re-verification and explicit recorded administrative reactivation.

These are product requirements, not implemented controls.

## User-approved commission treatment for refunds — 2026-11-14

The user has now resolved the refund-fee question:
- The buyer bears the **entire platform commission**, not the seller.
- The commission remains calculated on the original gross final agreed deal amount at the agreed rate (currently 7.5%), regardless of the outcome.
- When funds are refunded to the buyer, the full commission is deducted from the amount otherwise refundable to the buyer; it is not prorated to the seller's payout or the amount retained by the seller.
- Example: gross deal amount 10,000 USDT; commission 7.5% = 750 USDT. If the administrative decision is a full refund, the buyer receives 9,250 USDT and the 750 USDT commission is allocated to Web3Market.
- In partial-refund or split outcomes, the same full gross-based commission is borne by the buyer and deducted from the buyer's gross refund allocation before the buyer's net refund is transferred. The administrative decision must show gross buyer refund allocation, full commission, net buyer refund, seller allocation and exact sum.
- No allocation may be executed unless all amounts reconcile exactly to the verified Safe balance and the agreement. If the buyer's gross refund allocation is smaller than the full commission, the current rule does not by itself specify how the shortfall is funded. Do not silently charge the seller, create a new buyer debt, or exceed the buyer's refund. Flag this edge case for explicit agreement wording/administrative handling before funding or execution.

This commission rule is an approved product decision. It remains a specification, not a live financial implementation.
