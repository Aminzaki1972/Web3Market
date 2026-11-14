# Web3Market Deal Management — Sandbox Security Review

**Review scope:** isolated branch `prototype/deal-management-system-20261114`  
**Review status:** static code review only; no live integration or test execution  
**Production status:** no production changes; this document adds findings and gates only.

## Executive conclusion

The current prototype is suitable for workflow discussion and local simulation only. It is **not safe to connect to real funds**. In particular, the current code models payout readiness and dispute execution evidence but does not establish trusted authorization, enforce a Safe-level dispute lock, or independently verify a Safe execution receipt.

No Safe Guard/Module, transaction builder, signer flow, RPC implementation, database persistence, or server authorization boundary exists in this sandbox.

## Findings

### Critical — trusted on-chain execution verifier is not implemented

**Sandbox hardening completed:** the pure dispute lifecycle no longer contains an execution-confirmation helper, an `executed` status, or a caller-controlled receipt Boolean. The local model cannot self-certify payment.

**Still blocking live use:** no trusted server-side BNB Smart Chain verifier exists. A future verifier must independently confirm chain ID, expected Safe, successful canonical receipt, Safe execution semantics, exact approved transaction/batch, expected token, all recipient/amount transfers, unique transaction hash, and confirmation/finality policy. It must persist the verification result atomically and idempotently. A UI or client must never be able to manufacture this result.


### Critical — no actual Safe-level dispute lock

The prototype records dispute state only. It does not install or configure a Safe Guard/Module and cannot prevent owners from executing another Safe transaction while a dispute is open.

**Required before live funds:** design and independently security-review an enforcement mechanism at the Safe layer. Demonstrate with adversarial tests that an open dispute blocks every prohibited outgoing transfer, including direct owner-submitted transactions and alternate transaction paths. A database flag, disabled button, or server-side payout check is not a lock. Define recovery, emergency, upgrade, and signer-loss behavior before deployment.

### High — payout readiness trusts caller-supplied state booleans

File: `prototype/deal-management/payout-readiness.ts`

Both payout functions accept values such as `agreementApproved`, `depositVerified`, `requiredAssetsVerified`, `buyerFinalAcceptance`, and a caller-supplied `DisputeCase`. These are ordinary input values, not authenticated facts. The pure helper is useful for deterministic sandbox logic but cannot be an authorization boundary.

**Required before live use:** the server must load the canonical deal, immutable approved agreement version/hash, deposit record, asset verification records, buyer acceptance events, dispute record and Safe state from trusted persistence and chain sources. Recompute every gate server-side at execution time; never accept client-provided booleans or client-constructed dispute objects as proof.

### High — deposit transaction hash reservation is not atomic

File: `prototype/deal-management/bsc-readonly-adapter.ts`

The adapter asks whether a transaction hash was already used, then later returns evidence. Two concurrent requests could both observe the hash as unused. The adapter has no atomic reservation or durable unique constraint.

**Required before live use:** atomically reserve the normalized `(chain_id, tx_hash)` in a server-side database with a unique constraint and a state machine (reserved/verified/rejected). Make retries idempotent and ensure a failed verification cannot leave a permanently claimed hash without a safe recovery procedure.

### High — deposit adapter trusts externally supplied token/Safe configuration

The read-only adapter receives `expectedTokenAddress` and `expectedSafeAddress` from its caller. It validates their format and compares receipt data against them, but it does not establish that the token is the official USDT BEP-20 contract or that the Safe is the canonical Safe for this deal.

**Required before live use:** derive the deal Safe and approved token from server-controlled, versioned configuration bound to the approved agreement. Verify and pin the official token contract from authoritative sources; do not accept these addresses from browser input or a mutable unreviewed setting.

### High — confirmation count alone is not a complete reorg/finality policy

The adapter computes confirmations from a single block-height read. It does not implement reorg detection, canonical block-hash rechecks, provider disagreement handling, or a documented finality threshold.

**Required before live use:** define a BNB Smart Chain confirmation/finality policy, retain block number and block hash, recheck canonical inclusion before crediting the deposit, and handle reorgs by reversing the internal funding state safely before any transfer or payout can proceed.

### Medium — evidence timestamps are not trusted server timestamps

The dispute helper validates timestamp relationships, but claimant evidence submission has no independent `now` parameter and all timestamps are caller-supplied values.

**Required before live use:** stamp all evidence and workflow events on the server, preserve original upload metadata and cryptographic hashes, and enforce deadlines using a trusted server clock. Treat client timestamps as descriptive metadata only.

## Required security architecture before real-fund integration

1. Authenticated server-side commands with role checks for buyer, seller, platform adjudicator and Safe signers.
2. Immutable, versioned agreement snapshot binding price, USDT token, deal Safe, recipients, fee treatment, assets, deadlines, inspection rules and dispute allocation policy.
3. Server-owned state transitions; the browser submits intent, never proof or authorization flags.
4. Deposit verifier with pinned token/Safe configuration, canonical receipt checks, reorg policy and atomic transaction-hash reservation.
5. Safe-level dispute enforcement, independently reviewed and tested against bypass paths.
6. Safe transaction policy binding the exact approved decision/agreement, chain, Safe nonce, token, recipients and amounts.
7. Independent post-execution verifier checking the Safe execution result and all expected transfers before recording completion.
8. Append-only audit events, idempotency keys, retry/recovery rules, monitoring and incident response.
9. Independent smart-contract/Safe integration security review and legal review before production consideration.

## Explicit non-claims

- “Ready for Safe review” is not Safe authorization, a signature, or an executed payment.
- A local dispute status is not a freeze of funds.
- A boolean indicating receipt confirmation is not proof of an on-chain Safe execution.
- A mocked or injected read-only client is not a live BNB Chain integration.
- Authored tests are not passing tests until executed in a supported environment.
- This review does not authorize production deployment, migrations, wallet connection, live-fund testing, or changes to Safe configuration.


## 2026-11-14 hardening — dispute execution self-certification removed

The pure dispute lifecycle previously accepted a caller-provided `receiptConfirmed: boolean` and a transaction-hash-shaped string, then marked the dispute executed. That was not a trustworthy chain verification boundary: any caller able to invoke the helper could assert the boolean.

The helper has been removed. The pure lifecycle can now advance only to `execution_pending`; it cannot self-certify an on-chain execution. A future server-side verifier must independently query a trusted BNB Smart Chain RPC, bind the canonical receipt to the exact Safe address, Safe transaction/batch hash, dispute decision hash, token, recipients and amounts, verify every expected Transfer log and finality policy, and only then write an immutable execution-confirmed event. Browser-supplied receipt data or booleans are not acceptable.

This is a fail-closed sandbox hardening change, not a replacement live verifier. No server verifier, RPC integration or Safe execution was added.


## 2026-11-14 follow-up — remove the terminal execution state from the pure model

The dispute type no longer exposes an `executed` status or an execution receipt field. The pure state machine ends at `execution_pending`. This avoids implying that the sandbox can ever confirm a real Safe payment. Production completion remains dependent on a separate trusted chain verifier that has not been implemented.

 
## CI verification record — 2026-11-14

GitHub Actions workflow `.github/workflows/deal-management-sandbox-tests.yml` executed on isolated branch commit `5a89ad8ad581d04241e3c321dc4b700ddd12fa61`.

- Deno 2 setup completed.
- All sandbox test files type-checked by Deno.
- Result: **51 passed, 0 failed**.
- The first run exposed one stale expected error string in the BSC read-only adapter test (`transaction_not_successful` versus the adapter's actual `transaction_failed`); the assertion was corrected and the rerun passed.
- This is unit/domain-logic CI only. It does not test a deployed Safe Guard/Module Guard, live RPC, real USDT transfer, database authorization, concurrency, BNB fork behavior, or production runtime.

Cloudflare Pages reported a successful **branch preview** build for the same commit. This is a preview deployment, not a production deployment; no production release or production configuration change was requested or performed.

## 2026-11-14 follow-up — buyer inspection deadline is recorded but not enforced

The buyer-review model stores an optional `inspectionEndsAt` value and the preview exposes the agreed choices (48 hours, 72 hours or 7 days). The pure `reviewAsset` and `finalBuyerAcceptance` helpers do not compare the current time with that deadline, send deadline notices, or define an expiry transition. They also do not automatically accept assets or release funds when time expires.

**Approved policy:** when the inspection deadline passes without the buyer's explicit decision, the deal remains pending review. The system must not auto-accept any asset, infer consent from silence, or authorize any payout. The buyer may still explicitly accept or reject; otherwise the case remains on hold until an authorized administrator intervenes through a separately recorded and auditable resolution path. The hold may be released only through that approved resolution workflow, never merely because time elapsed.

**Implementation requirement:** enforce this rule server-side using a trusted clock and authenticated events. The ordinary payout gate must require an explicit authenticated final buyer-acceptance event or a separately approved and auditable administrative resolution.


## 2026-11-15 follow-up — fail-closed disputed-stage transition

A static review found that the pure `canAdvance` helper could theoretically permit a transition from `dispute_open` to `payout_ready` through the ordinary buyer-acceptance branch if a caller incorrectly supplied `disputeEverOpened: false` while `buyerAccepted: true`. Although trusted server state must ultimately supply these flags, the model itself should fail closed when its current stage is already `dispute_open`.

**Sandbox fix:** `canAdvance` now rejects every transition out of `dispute_open` unless the dispute-history flag is explicitly true and a final dispute decision is recorded. Two regression assertions cover false and missing dispute-history values even when buyer acceptance is true.

**Validation status:** source and regression test changes are committed on the isolated branch. A new Actions run for the latest test commit has not yet been independently confirmed; do not treat the regression test as passing until a run reports success. This remains pure TypeScript policy logic, not a live authorization or Safe enforcement boundary.
