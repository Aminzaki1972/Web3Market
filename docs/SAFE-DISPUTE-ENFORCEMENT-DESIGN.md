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
