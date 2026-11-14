# Web3Market Deal Management — Sandbox Security Review

**Review scope:** isolated branch `prototype/deal-management-system-20261114`  
**Review status:** static code review only; no live integration or test execution  
**Production status:** no production changes; this document adds findings and gates only.

## Executive conclusion

The current prototype is suitable for workflow discussion and local simulation only. It is **not safe to connect to real funds**. In particular, the current code models payout readiness and dispute execution evidence but does not establish trusted authorization, enforce a Safe-level dispute lock, or independently verify a Safe execution receipt.

No Safe Guard/Module, transaction builder, signer flow, RPC implementation, database persistence, or server authorization boundary exists in this sandbox.

## Findings

### Critical — dispute execution confirmation trusts a caller-supplied boolean

File: `prototype/deal-management/disputes.ts`, `confirmDisputeExecution`

The function accepts `receiptConfirmed: boolean` and a syntactically valid transaction hash. A caller able to pass `true` can move the local dispute model to `executed` without this module checking the Safe address, chain, receipt status, Safe execution event, token transfers, recipients, amounts, or transaction-to-decision binding.

**Required before live use:** remove the boolean proof interface. Accept only a server-created verification result from a trusted Safe-chain verifier. That verifier must independently confirm chain ID, expected Safe, successful receipt, Safe execution semantics, exact approved transaction/batch, expected token, all recipient/amount transfers, unique transaction hash, and confirmation/finality policy. Persist the verification result atomically and make it idempotent. A UI or client must never be able to manufacture this result.

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
