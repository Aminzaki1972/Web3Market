# W3M V1 — Security Review of the 2026-10-26 Safe Release Candidate

**Reviewed branch:** `fix/security-release-guards-20261026`  
**Review scope:** `prepare-deal-release`, `prepare-safe-release-tx`, `execute-safe-release`  
**Review type:** Static source review; no deployment or runtime access  
**Production impact:** None

## 1. Source status

This branch contains three Safe-related Edge Function source folders:
- `prepare-deal-release`
- `prepare-safe-release-tx`
- `execute-safe-release`

It does not contain the signature-recording or finalization functions. The candidate branch is not current `main`, and there is no evidence that it matches the deployed Supabase functions. The current-main frontend references all of these endpoints, but repository presence in a non-main branch does not establish deployment status.

## 2. Positive controls observed

### prepare-deal-release
- Requires a Bearer token and resolves the user through Supabase Auth.
- Restricts preparation to the buyer or seller.
- Fails closed when dispute status is open or cannot be verified.
- Requires an eligible deal status and confirmed payment with transaction hash.
- Requires BNB Chain ID 56 and Safe/token configuration.
- Requires verified buyer/seller wallets and distinct buyer/seller/platform owners.
- Reads Safe contract code, owners, threshold, and nonce; requires three expected owners and threshold 2.
- Calls `validate_deal_release_policy` before locking the release policy.
- Preserves an existing transaction if it already has a Safe hash, tx hash, or signed/submitted/confirmed status.

### prepare-safe-release-tx
- Requires authenticated participant access.
- Rechecks dispute status, delivery acceptance, payment confirmation, locked policy, Safe equality, token equality, and chain equality.
- Reads Safe owners, threshold, nonce, and version.
- Requires verified buyer/seller wallets and expected buyer/seller/platform owners.
- Requires seller net plus platform fee to equal the deal amount.
- Builds two ERC-20 transfer calls and uses MultiSendCallOnly through DELEGATECALL.
- Prevents automatic rebuilding when a transaction may already have been submitted or confirmed.

### execute-safe-release
- Requires authenticated participant access.
- Rechecks dispute status and rejects already-finalized deals.
- Requires two signed confirmation rows, DELEGATECALL, current Safe nonce, threshold 2, and a valid Safe transaction hash.
- Requires stored signers to be current Safe owners and checks signature byte lengths.
- Checks that the configured executor private key derives the configured executor address and that gas balance is sufficient.
- Waits for a transaction receipt before returning a transaction hash.

These controls should be preserved and strengthened, not replaced.

## 3. Findings

### Critical — execution does not prove the inner MultiSend payload is the intended two transfers

The preparation function creates two token transfers, but the execution function does not decode the stored `tx.data` and independently prove that the actual signed transaction contains only:
1. the exact token transfer to the verified seller for the locked seller-net amount; and
2. the exact token transfer to the approved platform wallet for the locked fee.

The preparation function's `isValidPackedMultiSend` only checks packed-call structure and boundaries. It does not prove the target token, selector, recipients, amounts, absence of approvals, or absence of additional semantic actions.

The execution function checks operation and Safe transaction hash, but a valid Safe hash only proves that the signers signed those bytes. It does not prove that the bytes implement the platform's intended release policy.

**Required fix:** Run the isolated `safe-multisend-decoder.ts` and `safe-payload-validator.ts` against the exact signed transaction fields immediately before execution. Also run the same validation before accepting signatures and when returning an existing prepared transaction. Any unexpected call, recipient, token, amount, value, operation, or chain must block broadcast.

### High — stored signatures are not independently recovered at execution

The execution function loads signer rows marked `signed`, checks that the stored wallet addresses are current Safe owners, packs the stored signature bytes, and checks the byte length. It does not independently recover each ECDSA signature against the recomputed current Safe transaction digest before calling `execTransaction`.

The separate historical signature-recording candidate performs typed-data signature recovery when a signature is recorded. That is useful, but it does not remove the need to re-verify the stored bytes at the execution boundary.

**Required fix:** Recompute the exact Safe EIP-712 digest at execution, recover every stored signature, require each recovered signer to match its stored wallet address and a distinct current Safe owner, and verify the current threshold. Do not rely on row count or status flags alone.

### High — incomplete release-state revalidation at execution

The execution function rechecks authentication, participant access, disputes, transaction state, threshold, nonce, and transaction hash. It does not recheck the full preparation preconditions immediately before broadcast, including:
- confirmed payment and payment reference;
- accepted delivery and buyer approval;
- locked release policy and its exact amounts/recipients;
- deal/policy Safe, token, chain, and fee configuration equality;
- verified buyer and seller wallet state;
- current agreement/terms hash and acceptance state.

**Required fix:** At EXECUTE, resolve all authoritative records server-side and revalidate them alongside the W3M report. A state change after signing must invalidate the release attempt or require a new report and new Safe transaction.

### High — receipt status is not equivalent to Safe execution success

The executor waits for the outer transaction receipt and checks `receipt.status === 1`. It does not inspect the matching Safe `ExecutionSuccess` event for the exact Safe transaction hash before updating the database to submitted.

A Safe call can fail internally while the outer EVM transaction is mined successfully. The finalization endpoint must then reject it, but the executor's response and intermediate state can still be misleading.

**Required fix:** Require the exact Safe `ExecutionSuccess` event (and reject matching `ExecutionFailure`) for the intended Safe transaction hash before marking Safe execution successful. Keep a distinct state for an outer transaction mined with Safe execution failure.

### High — database update result after broadcast is ignored

After a successful receipt, the executor updates the multisig transaction record but does not inspect the returned database error. This can leave an on-chain executed transaction with a stale database state.

**Required fix:** Check the update result, record an immutable execution attempt before broadcast, and provide an idempotent reconciliation path that can recover the transaction from chain state if the database write fails. Never broadcast a second time merely because the first response was lost.

### High — non-atomic transaction rebuild and policy update

The preparation function clears an old transaction hash/signature state and deletes signer rows in separate operations without checking both results. It then stores the new Safe transaction and updates the release-policy nonce in separate database writes.

**Required fix:** Use a narrowly scoped atomic database transition with row locks and checked results. Preserve old signatures until the replacement transaction is fully prepared, and never delete submitted/uncertain attempts.

### Medium — hard-coded token, decimals, chain and Safe assumptions

The transaction builder pins BNB Chain 56, one USDT contract, 18 decimals, one MultiSendCallOnly deployment, one platform wallet, and Safe version 1.4.1. Those assumptions may be intended for this platform but must be centrally approved and verified against the actual deployed configuration.

**Required fix:** Use server-controlled allowlisted configuration and bind it into the deal policy/report. Do not derive these values from browser payloads or silently reuse them across networks.

### Medium — duplicate and stale signature-row protection is not explicit in executor

The executor checks the number of signed rows and that each wallet belongs to the current owner set, but does not explicitly require two distinct recovered signers at the execution boundary. Any uniqueness constraints in the database were not available in this source review.

**Required fix:** Enforce distinct signer addresses in the executor and in database constraints; recover each signature from the exact Safe digest.

## 4. W3M integration points

| Existing endpoint | W3M requirement |
|---|---|
| `prepare-deal-release` | Require latest signed PASS report bound to deal/project/terms; preserve existing payment/dispute/participant checks |
| `prepare-safe-release-tx` | Validate exact generated MultiSend payload before persisting; bind payload hash and report ID/version |
| Signature-record endpoint | Revalidate report, terms, payload hash, current owner set and eligibility; record only recovered valid signatures |
| `execute-safe-release` | Revalidate W3M at EXECUTE; decode/validate actual signed payload; recover every signature; verify nonce/owners/threshold; idempotency claim before broadcast |
| `finalize-safe-release` | Verify exact Safe success event and exact token transfers; atomically persist completion |

## 5. Cross-branch conclusion

The 2026-10-26 branch is a useful, more recent candidate source for three functions. The earlier `fix/deal-dispute-release-guard` branch contains a separate candidate for signature recording and finalization. Neither branch proves what is deployed.

Do not copy either snapshot into the current function paths or assume their pieces are compatible without comparing schema, policy RPC, token configuration, signature format, and transaction record shape.

## 6. Required next source artifact

The next safe step is to obtain an authoritative source export of the six currently deployed functions, including:
- `create-safe`
- `prepare-deal-release`
- `prepare-safe-release-tx`
- `record-safe-release-signature`
- `execute-safe-release`
- `finalize-safe-release`

Include only source and migration/schema definitions; exclude all secrets, private keys, environment values, access tokens, and production data. Pin the export to a known deployment version or staging deployment ID.

**Conclusion:** This candidate branch has substantial release protections, but its executor still lacks exact payload semantics, independent signature recovery, complete state revalidation, Safe event verification, and robust idempotent persistence. The new isolated W3M decoder/validator pipeline is designed to address part of this gap, but it is not wired into the candidate or live backend.
