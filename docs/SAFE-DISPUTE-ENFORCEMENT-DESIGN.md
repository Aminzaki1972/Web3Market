# W3M Safe Dispute Enforcement — Architecture Design (Sandbox Only)

**Status:** design proposal for review; not an implementation or authorization to deploy.  
**Scope:** Web3Market deal-specific Safe on BNB Smart Chain, USDT BEP-20.  
**Repository branch:** `prototype/deal-management-system-20261114`.

## 1. Objective

While a deal has an unresolved dispute, prevent the deal Safe from executing any outgoing asset movement that is not explicitly permitted by the agreed dispute-resolution path. A database status, disabled UI button, or server-side payout check is not sufficient: enforcement must run in the Safe execution path.

The design must preserve the existing principle: **no independent W3M escrow contract**. Deal funds remain in a Safe. A Guard/Module Guard would be a Safe policy extension, not a separate escrow holding contract.

## 2. Safe mechanisms and implications

Safe documentation distinguishes:
- A **Transaction Guard**, which performs checks before and after standard Safe transactions, adding restrictions on top of the owner threshold.
- A **Module**, which can execute through a different access path and may bypass the ordinary owner threshold.
- A **Module Guard**, which checks transactions initiated by modules.

Safe warns that a broken Guard can block Safe execution and lock access to funds. Modules are security-critical because they may execute transactions outside the ordinary owner confirmation path.

Safe's current release notes state that Safe v1.5.0 adds Module Guard checks for module transactions, applying the same rules as other transactions. Therefore, any future implementation must pin and verify the actual Safe contract version and deployed Guard interfaces; it must not assume all Safe versions enforce the same paths.

Official references reviewed:
- Safe transaction guards: https://docs.safe.global/advanced/smart-account-guards
- Safe modules: https://docs.safe.global/advanced/smart-account-modules
- Safe Module Guard reference: https://docs.safe.global/reference-smart-account/guards/setModuleGuard
- Safe v1.5.0 release note (22 September 2026): https://www.safe.global/blog/safe-contract-version-1-5-0
- Safe warning about guard configuration and recovery: https://help.safe.global/articles/9852022523-add-a-transaction-guard

## 3. Proposed enforcement model — not yet selected for deployment

### A. Deal-specific policy Guard

A narrowly scoped Guard is the leading candidate for blocking ordinary owner-submitted Safe transactions during a dispute. It should be immutable or tightly governed, deal-specific, and configured with:
- exact Safe address;
- BNB Smart Chain chain ID 56;
- approved USDT token contract address, pinned only after authoritative verification;
- deal ID and approved agreement version/hash;
- explicit deal lifecycle state;
- allowed transaction target, operation type, token, recipients and amounts;
- approved payout decision hash for dispute settlement;
- replay protection and transaction/batch nonce policy.

The Guard should reject unapproved outgoing transfers and calls while the dispute lock is active. It must inspect the full Safe transaction semantics, not merely the outer destination address. In particular, it must safely handle ERC-20 transfers, native BNB, batch/MultiSend, delegatecall, token approvals, arbitrary contract calls, nested calls, and attempts to alter Safe security configuration.

### B. Module execution coverage

No unreviewed module should be enabled on a deal Safe. Inventory and verify enabled modules on-chain before funding and again before payout.

If the Safe version supports Module Guard, configure and test it so module-originated transactions cannot bypass the dispute policy. Pin Safe v1.5.0 or a later explicitly reviewed compatible release only after verifying BNB Chain deployment addresses, proxy/mastercopy version and interface compatibility. Do not infer compatibility from the Safe web UI.

A Module must not be introduced merely to automate payouts. If any module is proposed, its authority must be narrowly limited to the exact deal settlement policy, and the risk of bypassing ordinary owner threshold must be explicitly accepted and independently audited.

### C. Dispute state and authorization

The Guard must not trust a browser or a mutable database boolean. It should rely on a verifiable, authenticated state transition or a narrowly defined on-chain authorization mechanism. The design must specify:
- who can open a dispute and what signed/persisted evidence is required;
- how the dispute lock becomes effective on-chain;
- how the platform's decision is authenticated and bound to the approved agreement;
- how buyer/seller/platform allocation is encoded;
- how the lock is released only by the exact approved settlement path;
- what happens if the platform service is unavailable or compromised.

A platform decision is a contractual dispute outcome, not a court judgment. The contract should enforce only the agreed mechanical policy; it must not attempt to make an AI decision.

## 4. Critical threat: owners may try to remove or bypass the policy

The design must test attempts to:
1. call `setGuard(address(0))` while a dispute is open;
2. replace the Guard;
3. change owners or threshold to regain unilateral control;
4. enable a new Module or disable the Module Guard;
5. execute `delegatecall` or MultiSend with hidden nested transfers;
6. use token approvals, transferFrom, native BNB or non-USDT assets to move value;
7. use a Safe transaction path not covered by the configured Guard version.

A policy Guard may itself block legitimate recovery if configuration is wrong. A recovery mechanism must be specified and tested before any real funds are deposited. Do not promise an absolute freeze if the Safe's owners can still alter or remove the enforcement configuration through an unblocked path.

## 5. Payout execution policy

The ordinary settlement path and dispute settlement path must be separate, explicit policy branches.

### Ordinary path
- exact current agreement approved by all required parties;
- exact USDT deposit verified and bound to the deal Safe;
- all required assets verified;
- buyer final acceptance recorded;
- no open dispute;
- exact 92.5% seller / 7.5% platform split, unless the agreement specifies a different approved basis.

### Dispute path
- dispute response period completed or validly expired;
- one final reasoned platform decision recorded;
- explicit buyer refund, seller payout and platform fee amounts;
- allocation sums exactly to the verified deposit;
- recipients match the agreement/decision;
- one atomic Safe batch, with every expected transfer included;
- execution receipt and each expected transfer independently verified before marking the deal complete.

Do not automatically apply the ordinary 7.5% fee formula to a dispute refund. The agreement must define fee treatment for full and partial refunds before funding.

## 6. Safe transaction integrity checks

Before allowing an execution, independently verify:
- chain ID and Safe address;
- Safe version/mastercopy and proxy implementation;
- current owners and threshold;
- enabled transaction Guard, Module Guard and all enabled modules;
- exact transaction hash, Safe nonce and approved batch content;
- token contract and token decimals;
- all recipient addresses and exact amounts;
- no duplicate transaction/decision execution;
- successful receipt, expected Safe execution event and all expected token Transfer logs;
- confirmation/finality and canonical block inclusion policy.

The verifier must bind the on-chain transaction to the exact approved agreement or dispute decision hash. A successful receipt alone does not prove that the intended payout occurred.

## 7. Mandatory adversarial test matrix before any deployment

| Test | Expected result |
|---|---|
| Normal USDT payout without open dispute, exact approved batch | Allowed after required Safe signatures |
| Any outgoing transfer while dispute is open | Reverted |
| USDT transfer to an unapproved recipient | Reverted |
| Amount differs by one base unit | Reverted |
| Extra transfer hidden in MultiSend | Reverted |
| Delegatecall or arbitrary contract call | Reverted unless explicitly and narrowly approved |
| Token approval / allowance increase during dispute | Reverted |
| Native BNB transfer during dispute | Reverted |
| Attempt to remove or replace Guard during dispute | Reverted |
| Attempt to add a Module or bypass Module Guard | Reverted |
| Module-originated transfer during dispute | Reverted |
| Exact approved dispute settlement batch | Allowed only through the approved path |
| Replay same decision or Safe nonce | Reverted |
| Invalid decision signature/hash | Reverted |
| Malformed or unavailable policy state | Fail closed for outgoing transfers; recovery behavior explicitly tested |
| Recovery operation | Allowed only under a documented, independently reviewed recovery rule |

Tests must run against the exact Safe version and deployed bytecode intended for BNB Chain, including fork tests and adversarial integration tests. Unit tests of a pure TypeScript state machine are not sufficient.

## 8. Unresolved decisions — do not guess

1. Exact Safe version to support on BNB Smart Chain and verified deployed addresses.
2. Whether the Guard is immutable or upgradeable, and who can authorize upgrades.
3. How dispute-open state is communicated to the on-chain policy without a privileged unilateral freeze key.
4. Whether a platform decision is represented by a threshold-signed EIP-712 authorization, a separately governed attestation, or another mechanism.
5. Emergency recovery path and conditions, including platform outage, compromised platform key, signer loss and Guard bug.
6. Whether all three parties remain Safe owners and the required threshold; do not assume the previous 2-of-3 proposal is final for this new system.
7. How the 7.5% fee is treated in full and partial buyer refunds.

No contract architecture should be coded until these decisions have an approved threat model and recovery plan.

## 9. Current status

This file is design documentation only. No Solidity contract, Guard, Module, Module Guard, Safe configuration transaction, wallet connection, signing flow, RPC integration, database migration, or live-fund operation has been created or changed. No claim is made that funds are currently frozen by the prototype.


## User-confirmed product rule: suspend payout during an open dispute

The product rule is now explicit: **opening a dispute suspends payout from the deal Safe until the dispute is resolved**. This means:
- no ordinary seller/platform payout while the dispute is open;
- no buyer refund or partial distribution while the dispute is open;
- after the platform's reasoned decision is final, only the exact decision allocation may proceed to Safe review;
- no completion state until the exact Safe settlement transaction and all expected transfers are independently verified.

The rule concerns outgoing deal funds; it does not imply that the Safe contract itself is disabled or that inbound deposits are blocked. The user-facing state must distinguish an off-chain dispute request from a confirmed on-chain enforcement lock. Current sandbox code enforces only local payout-readiness/state-machine rules; it does not install or activate a real Safe Guard.


## BNB Smart Chain deployment compatibility check (registry inspection)

Checked the official `safe-global/safe-deployments` registry directly on 2026-11-14. Its versioned deployment JSON records chain ID `56` as using the canonical deployment for Safe v1.5.0, as well as for v1.4.1.

Verified registry entries:

| Component | Version | Canonical address | Canonical code hash | Chain 56 listed |
|---|---:|---|---|---|
| Safe singleton | 1.5.0 | `0xFf51A5898e281Db6DfC7855790607438dF2ca44b` | `0xdda019cbd7c867a533a2a86e5c53434fdc50b13122b5a5ddb4a8df61b31c20f2` | Yes |
| MultiSend | 1.5.0 | `0x218543288004CD07832472D464648173c77D7eB7` | `0xca1147a12963172a93910c5cb2bfa5ad0e941c7f03fc7eb017dd06a8ea4e5604` | Yes |
| MultiSendCallOnly | 1.5.0 | `0xA83c336B20401Af773B6219BA5027174338D1836` | `0xcdbdcec38d2f1c7d961b0029ff8416b7e86e9974d6f0e9c9580c7d17fcfb6663` | Yes |
| CompatibilityFallbackHandler | 1.5.0 | `0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4` | `0x3c6a85bcf7b563daa624b884b4e9a1b9fa5371edde7be945d998071a48f28bbc` | Yes |
| Safe singleton | 1.4.1 | `0x41675C099F32341bf84BFc5382aF534df5C7461a` | `0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4` | Yes |

The v1.5.0 Safe ABI in the official registry includes both `setGuard(address)` and `setModuleGuard(address)`. The v1.4.1 ABI inspected does not include `setModuleGuard`. Safe's official v1.5.0 release notes state that the Module Guard checks module transactions against the same rules as other Safe transactions.

**Important qualification:** this registry evidence confirms that Safe publishes canonical v1.5.0 deployment records for chain 56; it does not prove that any particular Web3Market deal Safe uses v1.5.0. Before activation, inspect the actual deal Safe proxy's singleton/mastercopy on BNB Smart Chain and compare the implementation bytecode hash to the official registry. Also verify the actual Guard/Module Guard storage, owner threshold, enabled modules, MultiSend target and code hash on-chain. A Safe address alone is not enough.

### Compatibility gate for Web3Market

- New deal Safes intended to use the complete dispute enforcement design must be created from the verified v1.5.0 deployment for chain 56, or must pass an explicit compatibility test proving equivalent enforcement coverage.
- Existing v1.3.0/v1.4.1 Safes must not be assumed to have Module Guard protection. Do not silently upgrade an existing Safe; upgrade requires a separately approved migration plan and the Safe owners' transaction approval.
- If the deal Safe does not pass the version/code-hash/guard/module checks, the deal must not accept a real deposit under the claim that dispute payout is enforceably suspended.
- No deployment, upgrade, Guard installation, Module Guard installation or Safe transaction was performed by this registry inspection.


## 9. Execution confirmation trust boundary — fail closed

The sandbox dispute lifecycle no longer contains a helper that turns a caller-provided boolean into an executed status. This deliberately leaves a dispute in `execution_pending` until a future trusted verifier exists.

A future verifier must not accept browser-provided receipts, event arrays, transaction hashes as proof, or a `receiptConfirmed` boolean. It must fetch chain data server-side and prove all of the following against a persisted, immutable settlement intent:

- chain ID 56 and exact deal Safe address;
- canonical Safe execution transaction and expected Safe transaction hash/nonce;
- exact decision hash and approved allocation;
- exact token contract, recipient addresses and amounts;
- successful canonical receipt and the Safe execution-success event;
- every expected ERC-20 Transfer log, with no extra outgoing transfer in the authorized batch;
- required confirmations/finality and no removed/reorged logs;
- unique use of the decision nonce and Safe nonce.

Only a server-controlled verification service may append the final execution-confirmed event. The database status is a consequence of verified chain evidence, never its source. Until this service is implemented and independently tested, the UI and API must not mark a deal `executed` or `completed` based on a submitted hash or user action.


## 10. Minimum Guard behavior specification — design target only

This section makes the security requirements testable without selecting or implementing a contract.

### Transaction Guard path

For every owner-threshold Safe transaction, the eventual Guard must inspect the complete transaction tuple before execution: `to`, `value`, `data`, `operation`, Safe transaction hash, nonce and relevant gas/refund fields.

While a dispute is locked, the default is deny. The only exception may be the exact decision-authorized settlement transaction, bound to the deal Safe, chain 56, agreement hash, decision hash, decision nonce, USDT contract, all recipients and exact amounts. No generic "payout allowed" boolean or recipient allowlist by itself is sufficient.

The Guard must reject attempts to call Safe configuration selectors that can weaken or remove the policy while locked, including `setGuard`, `setModuleGuard`, `enableModule`, `disableModule`, `changeThreshold`, `addOwnerWithThreshold`, `removeOwner`, `swapOwner` and fallback-handler changes. The implementation must use the exact ABI selectors and Safe version under test; this list is a threat-model checklist, not production-ready selector code.

### Module Guard path

For every module-originated Safe transaction, the Module Guard must apply the same locked-by-default policy. The default configuration for a new deal Safe should have **no enabled modules** unless a specific module has a documented necessity, narrowly scoped permissions, verified code hash and independent audit. No automatic-payout module is required for the initial product.

If the chosen Safe version does not support Module Guard, or the deployed Safe has no correctly configured Module Guard, the deal is not eligible for real deposits under this policy. This is not a UI warning that can be bypassed.

### Dispute lock request and settlement separation

A candidate lock request can be relayed by any party but must contain a valid EIP-712 signature from the exact buyer or seller recorded for that deal, bound to chain ID, Safe, deal ID, agreement hash/version, dispute nonce, evidence reference hash and expiry. The Guard must consume the nonce and make the lock monotonic: once locked, it cannot be cleared by a second party signature, API update or ordinary owner transaction.

A candidate settlement authorization must be separate from the lock request. It must bind the final platform decision to the exact agreement hash, Safe, chain, token, decision nonce, recipients and amounts. The actual Safe settlement still requires the configured Safe owner threshold. The Guard allows only the exact authorized Safe transaction/batch and rejects any additional outgoing call or transfer.

This candidate still has unresolved questions: how to ensure the signed decision is an authentic platform decision; how to protect the platform decision key; whether an additional independent attestation is required; how to handle a decision-key compromise; and how recovery works if the Guard has a bug. It is not selected or approved for implementation.

### Race window and user-facing states

The server must append the dispute request and stop issuing new payout proposals immediately. It then submits or relays the signed on-chain lock request. The Safe is not described as locked until the lock event is observed in a canonical block under the finality policy. Any payout that executes before that point is a real race condition; no off-chain flag can retroactively stop it. The product must disclose this residual window and define the emergency response if lock submission is delayed, censored or reorganized.

### Configuration mutation monitoring

Monitor Safe events and independently poll critical state for changes to owners, threshold, Guard, Module Guard, modules, singleton and fallback handler. Any unexpected mutation invalidates the protection snapshot and blocks new deposits/payout preparation. While a dispute is open, any attempted policy-weakening transaction must revert at the Guard; an event monitor alone is detection, not prevention.

## User-approved administration authority — 2026-11-14

- Buyer or seller may submit a dispute request.
- Web3Market administration reviews the request and decides whether to open the formal dispute.
- During administrative review, hold the deal off-chain against new payout proposals/instructions. Do not represent this as a confirmed on-chain Safe lock.
- Once administration approves opening, initiate the on-chain lock procedure. Only canonical verified chain state establishes a confirmed Safe lock.
- The final financial decision in every deal matter belongs to Web3Market administration, including payout, refund, partial refund, equal split, other percentage split and platform commission allocation.
- AI is evidence-assistance only; it has no decision, authorization or signing power.

### Gross-amount commission rule
Commission is calculated on the original gross final agreed deal amount regardless of the outcome or amount ultimately transferred to the seller. The currently specified rate is 7.5%. The final administrative allocation must explicitly account for this commission in completed deals, full refunds, partial refunds and split outcomes.

The economic party/share from which the commission is funded in a full or partial refund is not yet specified. The agreement must resolve this before real deposits; do not silently subtract the fee from the buyer's refund or assign it to the seller without an approved clause.

### Whole-deal fail-closed rule
If Guard/Module Guard or any required security enforcement component fails, is removed, incompatible, unverifiable or behaves unexpectedly:
- disable the entire deal workflow, not only the payout button;
- block progression, new deposits, payout proposals, refunds and all outgoing financial execution;
- if funds are already in Safe, prohibit outgoing movement until repair;
- require repair, repeatable tests, independent on-chain verification and explicit recorded administrative reactivation before resuming;
- never bypass the hold through a database flag or manual UI override.

These are approved product decisions, not implemented controls. The sandbox does not enforce them on a real Safe.

## User-approved commission treatment for refunds — 2026-11-14

The user has now resolved the refund-fee question:
- The buyer bears the **entire platform commission**, not the seller.
- The commission remains calculated on the original gross final agreed deal amount at the agreed rate (currently 7.5%), regardless of the outcome.
- When funds are refunded to the buyer, the full commission is deducted from the amount otherwise refundable to the buyer; it is not prorated to the seller's payout or the amount retained by the seller.
- Example: gross deal amount 10,000 USDT; commission 7.5% = 750 USDT. If the administrative decision is a full refund, the buyer receives 9,250 USDT and the 750 USDT commission is allocated to Web3Market.
- In partial-refund or split outcomes, the same full gross-based commission is borne by the buyer and deducted from the buyer's gross refund allocation before the buyer's net refund is transferred. The administrative decision must show gross buyer refund allocation, full commission, net buyer refund, seller allocation and exact sum.
- No allocation may be executed unless all amounts reconcile exactly to the verified Safe balance and the agreement. If the buyer's gross refund allocation is smaller than the full commission, the current rule does not by itself specify how the shortfall is funded. Do not silently charge the seller, create a new buyer debt, or exceed the buyer's refund. Flag this edge case for explicit agreement wording/administrative handling before funding or execution.

This commission rule is an approved product decision. It remains a specification, not a live financial implementation.
