# W3M Protocol V1 — Read-only Review of Deployed Deal Room / Safe Functions

**Review date:** 2026-11-06  
**Supabase project:** `web3market` (`hzhqlexnhtukfljcvnyd`)  
**Review method:** Read-only Edge Function metadata and source retrieval; static source inspection only  
**Production changes:** None. No function invocation, deployment, database write, wallet action, Safe transaction, or secret-value retrieval was performed.

## 1. Exact deployed source versions captured

| Function | Active version | Supabase source package SHA-256 |
|---|---:|---|
| `create-safe` | 56 | `d888f48d48c87563e20e43318f9187c0f02d9a46fbe5e037cadbb5520b918e07` |
| `prepare-deal-release` | 43 | `6c670d08fbb55fdc61a10c39b5f32062d311934228df59ce23096d337ba52e18` |
| `prepare-safe-release-tx` | 37 | `f4248dde096a3532befca8dbd894cdb3bb6511bdf2d6a70c8e253b9587b01dfe` |
| `record-safe-release-signature` | 24 | `fb4fedf2c17245b52d2920d3ac13c426b02a49d176dc96e75237c599840d5d01` |
| `execute-safe-release` | 28 | `e51aa4f2dffe259292a627b0ab1c3663c5f2ef46b7792cd96c156c452eb65d22` |
| `finalize-safe-release` | 25 | `4f39f60122f79198fd8b2051cefd172d600f1c1d3a5d48310b40620957efd5ce` |

The matching source-only snapshots are in this directory. Their `.txt` extension is intentional: they are archival review artifacts, not deployable Edge Function directories.

## 2. Executive result

**W3M Protocol V1 is not connected to any of the six currently active Safe Edge Functions.** Static searches of all six retrieved sources found no W3M report table, report validator, settlement-gate invocation, trusted signer registry lookup, or W3M PREPARE/EXECUTE validation.

The existing Safe flow has useful controls, especially participant checks, payment/dispute/delivery checks in preparation, typed-data signature recovery when a signature is recorded, Safe transaction hash recomputation, and exact Safe execution/USDT transfer checks during finalization. These controls must be preserved. They do not replace the W3M evidence gate.

## 3. High-priority findings

### H1 — No W3M enforcement at PREPARE or EXECUTE

**Affected:** `prepare-deal-release`, `prepare-safe-release-tx`, `record-safe-release-signature`, `execute-safe-release`, `finalize-safe-release`.

None of these deployed source versions loads a W3M report, verifies its signature, checks signer revocation, compares report version/evidence hash/terms hash, or rejects settlement based on W3M decision status.

**Required:** Add trusted server-side W3M validation to every preparation/signature/execute boundary. At minimum, require the latest signed PASS report at PREPARE and independently revalidate report freshness, evidence, deal terms, and signer status immediately before EXECUTE. Finalization must be bound to the same authorized report and exact Safe transaction.

### H2 — Execution does not independently recover stored Safe signatures

**Affected:** `execute-safe-release` version 28.

The function loads stored signer addresses and signature bytes, checks that each stored address is a current Safe owner, checks byte length, and recomputes the Safe transaction hash. It does **not** independently recover each stored ECDSA signature against that digest at execution.

The separate `record-safe-release-signature` version 24 does call `ethers.verifyTypedData` when a signature is initially recorded. That is a useful control, but execution must not trust mutable database signature rows or a prior status flag alone.

**Required:** At EXECUTE, reconstruct the exact Safe EIP-712 domain/message, recover every stored signature, require a unique recovered address per signature, match each recovered address to the corresponding stored signer and a current Safe owner, reject duplicate signers, and verify threshold.

### H3 — Exact MultiSend semantics are not enforced at the final execution boundary

**Affected:** `prepare-safe-release-tx` version 37 and `execute-safe-release` version 28.

The preparation helper `isValidPackedMultiSend` checks ABI decoding and packed-call length/bounds. It does not validate each inner operation, destination, value, ERC20 selector, token address, recipient, or amount. Its existing-transaction fast path accepts a structurally valid packed MultiSend with the expected outer MultiSendCallOnly target and DELEGATECALL operation.

At execution, the code checks only that the outer operation equals 1, then recomputes the Safe transaction hash from stored fields. It does not decode and semantically validate the actual signed payload against the locked seller/platform split immediately before broadcast.

**Required:** Run the isolated W3M MultiSend decoder and semantic payload validator against the exact transaction fields:
- before returning an existing prepared transaction;
- before accepting/recording signatures;
- immediately before execution/broadcast.
Require BNB Chain 56, the approved Safe and MultiSendCallOnly target, outer DELEGATECALL, zero native value, exactly two inner CALL operations, the approved token contract, and exact seller/platform recipients and raw amounts. Reject approvals, extra calls, alternate tokens, unexpected recipients, and any mismatch with the immutable deal policy.

### H4 — Execution omits full release-state revalidation

**Affected:** `execute-safe-release` version 28.

The source rechecks participant access, dispute state, transaction status, Safe threshold/nonce, executor configuration, signer-owner membership, and Safe transaction hash. It does not reload and revalidate the complete payment, buyer delivery acceptance, locked release policy, current deal terms/acceptance version, and exact policy/deal configuration immediately before broadcast.

**Required:** Re-read authoritative deal, payment, delivery acceptance, agreement/terms, dispute, policy, Safe, owners, threshold, nonce, token, recipients, and amount at EXECUTE. Any changed precondition must invalidate the attempt.

### H5 — Broadcast idempotency and post-broadcast persistence are incomplete

**Affected:** `execute-safe-release` version 28.

The function broadcasts `execTransaction`, waits for the receipt, then updates `deal_multisig_transactions`. The update result is not checked. There is no visible atomic pre-broadcast execution claim/attempt record in this function. A lost response or failed DB write can leave chain execution and database state inconsistent; a retry must reconcile chain state rather than blindly broadcast again.

**Required:** Add an idempotent execution-attempt state transition before broadcast, guarded by a row lock/unique attempt key. Persist the broadcast hash immediately and check every write result. On uncertain outcomes, reconcile Safe nonce, Safe events, and receipt before any retry. Never send a second transaction merely because the first response was lost.

### H6 — Finalization is a multi-step non-atomic database update

**Affected:** `finalize-safe-release` version 25.

The function does strong chain-side checks: receipt success, target Safe, recomputed Safe transaction hash, matching `ExecutionSuccess`, absence of matching `ExecutionFailure`, and exact Safe-to-seller / Safe-to-platform USDT transfers. It then updates the multisig transaction, release policy, deal, and project in separate requests. The audit-log insert result is ignored.

A failure after an earlier successful update can leave partial completion state.

**Required:** Keep all chain verification read-only, then call a narrowly scoped database RPC that atomically finalizes transaction, policy, deal, project status, and audit event with strict expected-state predicates and idempotency. Check and report the complete RPC result.

## 4. Additional observations

- `prepare-safe-release-tx` checks delivery acceptance, confirmed payment, dispute status, Safe owner/threshold/version, token, chain, and fee arithmetic. However, when rebuilding it clears transaction signatures and deletes signer rows in separate calls whose returned errors are not checked.
- `prepare-deal-release` checks confirmed payment, participant identity, dispute state, chain, Safe, and verified wallets. It locks/upserts policy and writes transaction/audit state in separate operations; the exact release-precondition boundary is later in `prepare-safe-release-tx`.
- `record-safe-release-signature` performs typed-data signature recovery, but its later signer upsert and transaction confirmation-count update are separate writes. The latter update result is not checked.
- `create-safe` is not a release authorization endpoint. It can deploy a Safe on BNB using a server-side deployer key and writes Safe/policy state. It must never be called as part of this static review or test process.
- `finalize-safe-release` already verifies Safe success and exact USDT transfer logs; preserve these checks when making finalization atomic.
- These findings are static observations of the captured versions, not proof of exploitability or evidence that a live deal is currently vulnerable.

## 5. Safe implementation order on the isolated branch

1. Preserve these six captured sources and pin the source package identifiers.
2. Build a source-specific adapter contract using the actual fields in these versions; do not guess additional database columns.
3. Implement W3M report loading and trusted signer verification using the isolated registry and cryptographic verifier.
4. Add fail-closed PREPARE checks before transaction creation or reuse.
5. Add exact MultiSend semantic validation before signature recording and at EXECUTE.
6. Add execution-time EIP-712 recovery of every stored signature and full release-state revalidation.
7. Design idempotent pre-broadcast attempt persistence and atomic finalization RPC only after the relevant schema and existing RPC definitions are inspected.
8. Add isolated tests for the exact source-derived payloads, signatures, state transitions, retries, and rollback behavior.
9. Keep all changes on `w3m-protocol-v1-isolated-20261105`. No deployment, merge, production migration, Safe interaction, or real-fund transaction is authorized by this review.

## 6. Verification limits

This was source retrieval and static review only. No deployed function was invoked. No test was run against production. The current isolated branch CI status must be checked separately; the existence of test files is not evidence that they pass.
