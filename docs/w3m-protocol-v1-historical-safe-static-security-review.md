# W3M Protocol V1 — Historical Safe Settlement Static Security Review

**Review status:** Static source review only  
**Reviewed ref:** `fix/deal-dispute-release-guard`  
**Historical snapshot date:** 2026-10-22 (not confirmed as deployed)  
**Target integration branch:** `w3m-protocol-v1-isolated-20261105`  
**Production impact:** None. No live endpoint, database, Safe, wallet, or deployment was accessed or changed.

## 1. Executive conclusion

The historical Safe source contains useful controls that must be preserved: authenticated user lookup, buyer/seller participant checks, dispute fail-closed checks, payment confirmation, delivery acceptance before transaction construction, Safe owner/threshold/nonce checks, typed-data signature recovery, fee split checks, and final on-chain receipt/log verification.

It is not safe to copy this snapshot as the current implementation. The five source files are absent from the repository's current `main` tree, while the current Deal Room HTML/JavaScript still references Safe release operations. The deployed Edge Function source/version therefore remains unverified.

No historical function invokes the W3M decision engine or settlement gate. The W3M protocol is not enforced by this code.

## 2. Files reviewed

| Historical function | Main responsibility |
|---|---|
| `prepare-deal-release/index.ts` | Auth, participant/payment/dispute checks, Safe owner validation, fee policy lock |
| `prepare-safe-release-tx/index.ts` | Delivery/payment/policy checks, Safe transaction construction, MultiSend packing |
| `record-safe-release-signature/index.ts` | Wallet-owner check, Safe typed-data digest and ECDSA recovery, signer record |
| `execute-safe-release/index.ts` | Signature count, Safe hash/nonce/owner checks, executor submission |
| `finalize-safe-release/index.ts` | Receipt, Safe ExecutionSuccess and exact USDT Transfer log verification; deal finalization |

The current `main` tree does not contain these five paths. The current Deal Room source includes calls to `execute-safe-release` and `finalize-safe-release`, so repository source alone is insufficient to identify the currently deployed versions.

## 3. Findings and required controls

### Critical — exact Safe payload is not fully validated before execution

The transaction-preparation function recognizes an already-prepared transaction using structural checks: packed MultiSend bytes, destination equal to MultiSendCallOnly, and operation equal to DELEGATECALL. It does not decode and prove that the inner calls are exactly the two intended USDT transfers with the exact policy recipients and amounts.

The execution function recomputes the Safe transaction hash and checks the stored signer records, but it does not independently decode the transaction payload and enforce the exact seller transfer plus platform-fee transfer before broadcasting it.

The finalizer checks the expected transfers after the transaction is mined. That protects the database from falsely marking a wrong transfer as completed, but it cannot reverse funds if a different validly signed payload has already executed.

**Required fix:** A shared server-side payload validator must decode the Safe transaction and require exactly:
- Safe → configured seller wallet, exact seller net amount;
- Safe → configured platform wallet, exact platform fee;
- configured token contract and chain;
- no extra calls, unexpected recipients, arbitrary approvals, or extra value;
- exact deal amount = seller net + platform fee.

Run this validation at preparation, signature recording, execution immediately before broadcast, and finalization. Reject before broadcast if any byte or semantic field differs.

### High — signature records are not re-recovered in the execution function

The signature-recording function recovers the signer from the Safe EIP-712 typed-data digest and checks that the recovered address equals the verified profile wallet. This is a good control at write time.

The execution function later loads signer rows, checks that their wallet addresses are current Safe owners, packs the stored signatures, and checks signature byte length. It does not independently recover each stored signature against the exact current Safe transaction digest before broadcasting.

**Required fix:** At execution, recompute the exact Safe transaction hash and independently recover every stored signature; require distinct current owners, exact matching transaction hash, correct signature format, and threshold. Do not trust a stored `signature_status` or count as proof by itself.

### High — incomplete state revalidation across the signature and execution path

The signature endpoint rechecks participant identity, open disputes, verified profile wallet, Safe ownership, threshold, nonce, and typed-data digest. However, it does not independently recheck all of the release preconditions present in the preparation path, including confirmed payment, accepted delivery, locked release policy, deal/policy Safe and token equality, and already-finalized release state.

The execution endpoint rechecks participant and dispute state, Safe threshold/nonce, signer owner membership, and transaction hash. It does not fully revalidate payment, delivery acceptance, policy status, deal/policy Safe equality, token, amount, and fee split immediately before broadcasting.

**Required fix:** The W3M `PREPARE` and `EXECUTE` gate must be called server-side, and the existing payment, delivery, dispute, policy, token, amount, fee, Safe, and release-idempotency checks must remain in place at each relevant boundary. Signature recording must reject if the deal/report is no longer eligible.

### High — non-atomic preparation and partial-state risk

The first preparation function writes the release policy, then inserts/updates the multisig transaction, then writes an audit log as separate database calls. A later failure can leave earlier writes committed.

The Safe transaction builder clears an old hash/signatures and deletes signer rows in separate calls when rebuilding, but the historical source does not check the returned errors from both cleanup operations before proceeding.

**Required fix:** Move the coupled state transitions into a narrowly scoped PostgreSQL RPC/transaction with explicit row locking and compare-and-set state transitions. Check every write result. Never clear old signatures unless the new transaction payload and nonce are safely prepared as one controlled transition. Preserve submitted/confirmed transaction records.

### High — no explicit concurrent execution/idempotency lock

The executor checks for a finalized deal and Safe nonce, but the reviewed code does not acquire a database lock or atomically claim a unique execution attempt before broadcasting. Concurrent requests can race. Safe nonce protection reduces the chance of two successful executions, but does not replace application-level idempotency and reconciliation.

**Required fix:** Introduce an idempotent execution-attempt record keyed by deal + Safe transaction hash, atomically claim it before broadcast, and reconcile pending/submitted/confirmed states from the chain. Never rebuild or retry a transaction whose broadcast outcome is uncertain until chain state is reconciled.

### Medium — execution success is deferred to finalization

The executor treats a mined receipt with `status === 1` as a submitted transaction. It does not inspect the Safe `ExecutionSuccess` event for the exact Safe transaction hash before recording that state. A Safe call can fail internally while the outer EVM transaction itself is mined successfully; the finalizer later rejects because it requires the matching `ExecutionSuccess` event.

**Required fix:** Inspect the receipt for the matching Safe `ExecutionSuccess` event before reporting successful Safe execution. Preserve a separate state for outer transaction mined but Safe execution failed.

### Medium — finalization uses multiple non-atomic database writes

The finalizer verifies the chain receipt and exact seller/platform token transfers, then updates the multisig transaction, release policy, deal, project listing, and audit log separately. A later failure can leave a partially finalized database state. For example, the deal can be marked completed before the project status update fails.

**Required fix:** Keep on-chain verification outside the database transaction, then pass the verified immutable receipt facts to one narrowly scoped atomic finalization RPC. The RPC must be idempotent, lock the deal/policy rows, update all related records, and append the audit event together.

### Medium — hard-coded chain, token, decimals, Safe version and platform address

The historical functions hard-code BNB Chain ID 56, a USDT token address, 18 token decimals, Safe version 1.4.1 in the builder, and a platform wallet address. Another preparation function reads a token contract from the deal record. These assumptions may be correct for the historical configuration but must be compared against current canonical platform configuration before reuse.

**Required fix:** Load approved chain/token/platform/Safe policy from trusted server-side configuration; validate against an allowlist. Do not accept these values from browser input. Confirm token decimals from trusted configuration or on-chain metadata and pin them into the signed deal policy.

### Medium — agreement/terms version is not enforced consistently

The Deal Room UI records buyer/seller agreement rows. The reviewed Safe functions do not consistently prove that both parties accepted the same immutable terms version/hash before preparing or executing release.

**Required fix:** Bind the W3M report and release policy to a canonical deal-terms hash/version, and recheck that both parties accepted that exact version. Any material terms change invalidates the report and prepared release.

## 4. Existing controls to preserve

- Authentication through Supabase Auth user lookup.
- Buyer/seller participant authorization.
- Fail-closed behavior if dispute lookup errors or an open/under-review dispute exists.
- Confirmed payment and payment transaction reference checks.
- Delivery acceptance check before Safe transaction construction.
- Verified buyer/seller wallet and expected Safe owner set.
- Safe threshold and nonce checks.
- EIP-712 Safe typed-data digest and signature recovery at signature-record time.
- Seller net + platform fee equals deal amount.
- MultiSendCallOnly with DELEGATECALL for the two-token-transfer batch.
- Execution hash recomputation and on-chain Safe receipt verification.
- Matching Safe ExecutionSuccess event and exact USDT transfer logs before database finalization.

## 5. W3M insertion points

| Boundary | Mandatory W3M action |
|---|---|
| Create acquisition report | Build evidence from trusted server-side sources; persist immutable report and signature |
| Prepare release policy | Require latest signed PASS report and validate terms/evidence/payment/dispute state |
| Build Safe transaction | Validate exact policy-bound payload and bind its hash to the report/release attempt |
| Record each signature | Revalidate current report, exact payload hash, participants/owners, and deal eligibility |
| Execute Safe transaction | Revalidate report at EXECUTE, exact payload, current nonce, all signatures, dispute/payment/delivery/policy state, and idempotency claim |
| Finalize | Verify exact chain receipt and atomically finalize only after verified on-chain success |

W3M must not rely on a browser-provided `PASS`, evidence boolean, report hash, or signature. The backend must resolve the latest report for the deal and recompute authoritative state.

## 6. Safe implementation sequence

1. Obtain the authoritative current Edge Function source from a dedicated staging/export workflow, without reading or changing production secrets.
2. Compare deployed/staging versions with the historical snapshots and current frontend function names.
3. Resolve the exact-payload validation and atomicity findings before wiring W3M.
4. Add the W3M gate to PREPARE, signature recording, EXECUTE, and finalization as appropriate.
5. Test with disposable PostgreSQL and BNB testnet wallets only.
6. Confirm that missing/expired/revoked/mismatched reports block every route to Safe execution.
7. Keep all changes on the isolated branch until owner review and explicit approval.

## 7. Scope limitations

This is a static review of a historical branch snapshot and current repository files only. It does not prove which code is deployed, does not inspect production database contents, and does not constitute a live penetration test or audit. No source was copied into executable Edge Function paths and no live system was changed.

**Conclusion:** The historical Safe workflow has meaningful protective controls, but it needs stronger exact-payload validation, signature re-verification, state revalidation, concurrency/idempotency, and atomic database transitions. W3M should be integrated only after the authoritative current Safe source is obtained and these controls are addressed.
