# W3M Protocol V1 — Safe execution-attempt lifecycle

Status: isolated implementation draft; not deployed.

## Purpose
Prevent two release broadcasts for one deal, preserve an idempotent execution claim, and persist the exact broadcast transaction hash before any retry can be considered. This layer does not sign, broadcast, inspect chain receipts, or move funds.

## New isolated artifacts
- Migration: `20261106230000_w3m_protocol_v1_safe_execution_attempts.sql`
- Table: `public.w3m_safe_execution_attempts`
- RPC: `w3m_claim_safe_execution_attempt(uuid,uuid,uuid,text,text,text)`
- RPC: `w3m_record_safe_execution_broadcast(uuid,text)`
- Disposable fixture: `supabase/tests/w3m-safe-execution-attempts-fixture.sql`
- Contract test: `supabase/tests/w3m-safe-execution-attempts.test.sql`

## Claim invariants
1. Serialize claims per deal with a transaction-scoped advisory lock, then lock the deal, stored Safe transaction, report, and release policy rows.
2. The W3M report must be the latest version for the exact deal, PASS, unexpired, signed at the registry-row level, and bound to the deal's project.
3. The report signer key must exist in the trusted signer status view, be ACTIVE now, and have been within its validity interval at report issue time.
4. Deal payment must be confirmed with a transaction hash; delivery must be accepted with buyer approval; dispute state must be exactly `none`. This deliberately blocks disputed/resolved cases until the production vocabulary inconsistency is resolved.
5. Deal and policy must agree on BNB Chain 56, Safe address, and token. The existing `validate_deal_release_policy` must also return valid=true.
6. The stored transaction must be the exact release action, status signed, chain 56, same Safe, and its stored Safe hash must match the supplied hash.
7. A single active attempt per deal is enforced by both advisory locking and a partial unique index.
8. A reused idempotency key with identical deal/transaction/report/hash returns the original attempt before revalidating mutable transaction state. Reuse with different arguments is rejected.
9. Broadcast recording is idempotent only for the exact same transaction hash. A different hash or a non-CLAIMED attempt is rejected.

## Security boundary
- RPC execution is service_role-only; browser roles receive no table or function write privileges.
- SQL checks signer registry status and key validity, but does not perform ECDSA report-signature recovery. The trusted Edge Function must cryptographically verify the canonical report signature and complete W3M settlement/Safe execution guard immediately before invoking claim.
- This SQL layer does not independently recompute the Safe EIP-712 transaction hash, inspect stored Safe owner signatures, decode calldata, or broadcast. Those remain mandatory server-side preconditions from the existing isolated adapters.
- The current production validator and dispute vocabulary are intentionally retained as fail-closed checks; no production function is changed.

## State machine
- `CLAIMED`: unique execution right acquired; no broadcast hash yet.
- `BROADCAST`: exact transaction hash durably recorded.
- `RECONCILIATION_REQUIRED`: reserved for uncertain network outcome; remains active and blocks a second attempt.
- `CONFIRMED` / `FAILED`: terminal states; finalizer/transition RPC is not implemented yet.

A timeout after broadcast must never cause a blind second broadcast. The caller must reconcile the original hash against BNB chain and the Safe nonce/events before a terminal transition. If the network result is uncertain, preserve the active attempt as RECONCILIATION_REQUIRED.

## Explicitly not implemented
- Atomic finalization across deal, release policy, Safe transaction, and audit log.
- Safe receipt/event reconciliation and idempotent terminal transition.
- A bounded recovery/lease process for a CLAIMED attempt when the process dies before recording a broadcast hash. Such a claim must remain blocking until a trusted recovery procedure proves no broadcast occurred.
- Canonical fee precision and resolved-dispute policy. Existing production function and triggers disagree; no policy is inferred here.
- Integration into the six deployed Safe Edge Functions.

## Test scope
The new disposable PostgreSQL contract test is designed to cover:
- first claim creation;
- identical idempotent replay;
- rejecting a second active attempt;
- exact broadcast-hash persistence;
- identical broadcast replay;
- rejecting a different hash;
- replay after the Safe transaction row advances to submitted.

CI must pass against the disposable PostgreSQL service before this draft is considered verified. A CI pass is not production approval.


## Atomic finalization RPC (isolated draft)
A follow-on migration adds `w3m_finalize_safe_execution_attempt(uuid,text,uuid,jsonb)`. It is service_role-only and finalizes a previously recorded BROADCAST or RECONCILIATION_REQUIRED attempt only when the server supplies a receipt-verification object bound to the exact BNB transaction hash, chain 56, Safe address, Safe transaction hash, token contract, successful receipt, Safe ExecutionSuccess (and no ExecutionFailure), and exactly two Safe-originating token transfers matching the locked seller-net and platform-fee recipients/amounts.

Within one PostgreSQL transaction it locks the attempt/deal/transaction/policy, verifies participant actor and immutable bindings, updates the multisig transaction to confirmed, policy to released, deal to completed, project to sold, inserts one deal audit row, and marks the attempt CONFIRMED. Any error rolls the whole operation back. Repeating the same finalization returns an idempotent result; rebinding the attempt to another transaction hash is rejected.

**Trust boundary:** PostgreSQL does not independently query BNB or parse a raw receipt. The server must independently verify the receipt and construct the evidence object from chain data immediately before calling this RPC. The RPC validates the evidence structure and exact binding against database state. This migration and fixture are CI-only drafts, not deployed.
