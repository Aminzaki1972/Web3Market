# Dispute Payout Suspension — Verification Plan

**Scope:** isolated Web3Market Deal Management sandbox. This document defines tests and acceptance criteria; it does not authorize production deployment or real-fund use.

## Product invariant

Once a deal dispute is opened, no outgoing payout or refund from that deal Safe may execute until the dispute is resolved under the signed agreement and the exact settlement path is authorized. The rule applies equally to:
- seller proceeds;
- Web3Market commission;
- full or partial buyer refunds;
- any alternate recipient or token transfer from the deal Safe.

The only post-dispute outgoing transaction permitted by the eventual on-chain policy is the exact, authorized settlement batch that implements the final decision. A database flag alone is not enforcement.

## Sandbox domain tests

The Deno suite should verify:

1. Open dispute blocks ordinary payout readiness.
2. Open dispute blocks every transition to payout-ready and completed.
3. Clearing the active dispute flag without a final decision does not permit payout.
4. A deal with dispute history cannot use the ordinary 92.5% / 7.5% payout path, even after dispute closure.
5. A disputed deal can reach payout-ready only from the dispute decision path and only with a finalized decision.
6. Decision allocations must reconcile exactly to the verified deposited amount.
7. A full buyer refund creates no seller or platform transfer when the decision explicitly allocates zero to them.
8. A partial refund uses only the explicit decision allocation; it must not silently recalculate the standard fee.
9. Completion requires verified Safe execution evidence; a proposed or signed transaction is insufficient.
10. Resetting the local preview clears only demo state and must not be described as a real dispute cancellation.

## On-chain adversarial acceptance matrix — required before real funds

| Attack / failure | Expected Safe-level result |
|---|---|
| Seller payout submitted after dispute lock | Revert |
| Platform commission transfer submitted after dispute lock | Revert |
| Buyer refund or partial refund submitted before final decision | Revert |
| Direct ERC-20 USDT transfer | Revert |
| Native BNB transfer | Revert |
| Token approval / allowance increase | Revert unless explicitly allowed by policy |
| MultiSend with a hidden extra transfer | Entire batch reverts |
| Delegatecall or unapproved module execution | Revert |
| Module transaction while locked | Revert under verified Module Guard coverage |
| Guard removal / replacement while locked | Revert or require a separately specified secure recovery path |
| Owner / threshold change that bypasses policy | Revert or require separately specified secure recovery path |
| Replayed dispute signature or settlement decision | Revert |
| Wrong chain, Safe, token, agreement hash, nonce, recipient or amount | Revert |
| Dispute-lock transaction pending or reorganized | UI must not claim funds are locked |
| Exact decision batch with valid authorization and Safe threshold | Only approved transfers execute atomically |
| Failed settlement receipt or mismatched Transfer events | Deal remains incomplete; no success state |

## Required evidence for each on-chain test

Record the Safe address and deployed Safe version, chain ID, Guard and Module Guard addresses and code hashes, owners and threshold, enabled modules, transaction nonce, exact transaction/batch hash, expected token/recipients/amounts, revert reason or successful receipt, and all relevant token Transfer logs.

Test against the exact deployed Safe version and bytecode intended for BNB Smart Chain. A unit test of a mock Guard is not sufficient. Include fork tests and adversarial integration tests, plus independent security review before real-fund enablement.

## Server and UI consistency

- Persist an append-only dispute-opened event and derive `disputeEverOpened` from trusted server-side history.
- Treat an off-chain dispute request, pending lock transaction and confirmed on-chain lock as distinct states.
- Block new payout proposals at the server as soon as the dispute request is accepted; separately enforce the on-chain lock once confirmed.
- If the chain lock cannot be confirmed, show a clear protection warning and escalate; never represent the Safe as frozen.
- A final decision records exact allocation and agreement reference; it does not itself execute transfers.
- Mark completion only after an independent verifier confirms the exact Safe execution and all expected transfer events.

## Current implementation boundary

The sandbox currently contains pure TypeScript rules, mock tests, a read-only adapter interface and a front-end preview. It has no live Safe Guard, Module Guard, production backend, trusted dispute service, signing, transaction submission or on-chain freeze. The GitHub Actions workflow was added to run the Deno sandbox tests, but no workflow run has yet been observed. Do not claim the test suite passed until a successful run is recorded.
