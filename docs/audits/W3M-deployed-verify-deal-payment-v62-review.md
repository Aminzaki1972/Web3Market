# Review: deployed `verify-deal-payment` Edge Function (version 62)

**Review date:** 2026-11-16  
**Supabase project:** `hzhqlexnhtukfljcvnyd`  
**Observed deployment:** `verify-deal-payment`, status `ACTIVE`, version `62`, `verify_jwt=true`  
**Deployed source SHA-256:** `dae5138b9a5c30345097c512a613db4697a08b6ce8e27ac10977ae55baad88aa`  
**Scope:** read-only inspection of the deployed Edge Function source. No production code, database, secrets, or settings were changed.

## Executive finding

The production payment verifier exists and is active. Its source was not present in the inspected GitHub development branch or `main`, so the repository does not currently provide a reproducible source-of-truth copy for this deployed version.

The function checks the buyer session, buyer wallet, seller wallet, BNB Safe owner set and threshold, transaction sender, token transfer recipient and amount, and a minimum of three confirmations. These are useful controls, but the implementation has material gaps before its result should be treated as canonical funding evidence for the W3M Protocol V1 refund path.

## Findings

### High — payment state is written before all business validations finish

The function upserts `blockchain_transactions` and updates `deals.payment_tx_hash`, `payment_status`, `status`, and `funded_at` before it checks that `platform_fee_percent` is exactly 7.5. If that check fails, the endpoint returns HTTP 409 after the payment has already been marked confirmed/funded.

The subsequent fee update and audit-log insert are separate writes, and their errors are ignored. A partial write can therefore leave a funded deal without its locked fee values or audit row.

**Required correction:** validate all deal and fee invariants before writes, then use one service-only database RPC/transaction with conditional state transitions and idempotent transaction binding. Treat fee and audit persistence failures as transaction failures.

### High — receipt canonicality is not verified

The function checks that a receipt exists and has status `0x1`, and calculates three confirmations. It does not compare the receipt's block hash and block number with a fresh `eth_getBlockByNumber` result, nor does it verify that the returned receipt transaction hash exactly equals the requested hash.

A confirmation count alone is not a complete canonical-block/reorg check.

**Required correction:** validate the receipt hash, block number and block hash; fetch the block by number; require an exact canonical hash match; pin related Safe/funding reads to an explicitly selected canonical block where supported; fail closed if the provider cannot supply these facts.

### High — transfer-log matching is not strict or unique

The verifier takes the first log whose token address, Transfer topic, buyer address, Safe recipient and amount appear to match. It does not reject multiple matching transfers, removed logs, malformed/non-canonical ABI address padding, or malformed topic arrays with an exact structural check. The sender topic is extracted by taking its last 40 hex characters.

**Required correction:** use a shared strict Transfer-log parser that validates topic count, canonical 32-byte address padding, non-zero sender, token contract, recipient, amount, log index and non-removed status; require exactly one matching event and bind its log index into the persisted evidence.

### High — chain and asset identity are not pinned tightly enough

The function uses the configured `BSC_RPC_URL` or public BSC RPC endpoints but does not call `eth_chainId` to prove that the selected RPC is on chain 56. It reads token decimals dynamically and trusts `deal.token_contract`; it does not itself require the canonical BNB USDT contract and 18 decimals.

The refund-request SQL does require the approved BNB USDT contract, but the payment verifier should establish the same invariant rather than relying on a later stage to reject it.

**Required correction:** assert chain ID 56 on the selected RPC; require the approved token contract and 18 decimals for this deal protocol; bind those facts into the verified funding record.

### Medium — transaction-hash reuse checks are incomplete

The preflight lookup checks whether an existing hash is bound to a different non-null deal ID and whether its transaction type is `payment`. It does not fully bind the existing row's user, chain, status and all ownership fields before the subsequent upsert. The final deal update is not a conditional compare-and-set against the previously read payment state.

**Required correction:** reject any existing hash row unless every relevant field matches the same deal, buyer, chain and payment intent; use a unique constraint plus an atomic conditional update to prevent concurrent cross-deal assignment.

### Medium — Safe facts are read at `latest` and Safe version is not checked

The verifier checks deployed code, owners, threshold and nonce at `latest`. It does not pin these reads to a canonical block snapshot or verify the Safe implementation/version. This is weaker than the block-pinned Safe checks already designed for the V1 settlement/refund gates.

**Required correction:** use the canonical block-pinned Safe reader and enforce the expected Safe implementation/version and exact owner set/threshold.

### Medium — confirmation policy is inconsistent across the protocol

This payment verifier accepts three confirmations. The refund workflow's funding evidence contract should define one explicit minimum and use it consistently in the payment verifier, request preparation, receipt verifier and SQL assertions. Do not silently treat a lower confirmation count as sufficient for the refund path.

## Deployment inventory observation

The read-only Edge Function inventory showed the active `verify-deal-payment` function, but did not show deployed `w3m-protocol-v1-buyer-refund-request`, `w3m-protocol-v1-buyer-refund-sign`, or `w3m-protocol-v1-buyer-refund-finalize` endpoints. The refund handlers/finalizer in the development branch are therefore not yet proven deployed or connected to the live Deal Room.

## Safe next steps

1. Preserve the exact deployed version 62 source in a controlled audit record and reconcile it with Git before changing the function.
2. Port the verifier into the repository as reviewed source, then add isolated tests for chain ID, canonical receipt block, exact transaction hash, strict unique Transfer log, fee prevalidation, transaction-hash reuse and atomic state transitions.
3. Build a fresh server-side refund-request context loader that reads the deal, immutable terms/decision, verified wallets and this canonical funding evidence. The browser must continue to submit only `deal_id`.
4. Only after isolated CI and independent security review should a separately approved deployment be considered.

**Release decision:** do not deploy this verifier change or enable live buyer refunds based on the current evidence. This document is an audit record, not a deployment instruction.
