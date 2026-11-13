# W3M Protocol V1 — Safe Release Claims and Dispute Serialization

**Status:** isolated feature-branch implementation; not deployed or applied to production.

## Purpose

Serialize a W3M-mediated Safe release attempt against a dispute opening. A dispute and a release claim must not both win for the same deal.

This mechanism does not create an escrow contract. Deal settlement remains through the existing Safe{Wallet} multisig on BNB Smart Chain.

## Shared lock order

The release-claim RPC and the dispute-table trigger both lock the corresponding `public.deals` row with `SELECT ... FOR UPDATE` before reading or changing the relevant state.

- If a dispute insert/update obtains the deal lock first, the release-claim RPC waits, then observes the open dispute and rejects the claim.
- If the release-claim RPC obtains the deal lock first, it persists an active claim. The dispute trigger waits, then observes that active claim and rejects opening/reopening the dispute.
- A deal-level attempt to set `status = 'disputed'` or a non-terminal `dispute_status` is also rejected while a claim is active.

The same row lock is the serialization point; a preflight read in an Edge Function is not treated as the authoritative race guard.

## Durable claim lifecycle

| State | Meaning | Blocks new disputes? |
| --- | --- | --- |
| `claimed` | W3M reserved the deal immediately before attempting Safe broadcast; no transaction hash may be known yet | Yes |
| `submitted` | The outer BNB transaction hash is durably recorded | Yes |
| `failed` | A mined EVM revert or Safe `ExecutionFailure` was confirmed and recorded | No |
| `finalized` | Safe `ExecutionSuccess`, exact Safe-to-seller and Safe-to-platform USDT transfers, and deal settlement were verified | No; the deal is terminal |

The claim identity binds one deal, one Safe transaction hash, and one Safe nonce. A retry that finds an existing active claim does not broadcast again. A finalized deal cannot acquire another release claim.

## Failure and recovery policy

There is intentionally no time-based expiry for `claimed` or `submitted`.

If the Edge Function crashes, a provider times out, or the broadcast result is uncertain, the active claim remains in place. It must not be cleared merely because a timeout elapsed: a transaction may still be pending or may have been broadcast without the caller receiving its hash.

Recovery requires checking BNB chain evidence and reconciling the exact Safe transaction. The finalizer verifies the outer transaction was sent by the configured Web3Market executor to the configured Safe, decodes `execTransaction`, and compares its full Safe payload with the signed database transaction before considering either success or failure. Only a confirmed mined EVM revert of that exact call or confirmed Safe `ExecutionFailure` can move the claim to `failed`. If the result cannot be proven, the claim stays active and the deal remains blocked. This is intentionally fail-closed, even though manual reconciliation may be required.

## Permissions

- The claim ledger is in the non-exposed `w3m_private` schema with RLS enabled.
- Browser roles and `service_role` have no direct table privileges.
- Only the four service-role RPCs can claim, mark submitted, mark failed, or finalize.
- Trigger helper functions are not directly executable by browser or service roles.

## Production schema compatibility

The migration was cross-checked read-only against the current production schema:

- `deals.dispute_status` accepts `none`, `open`, `under_review`, `resolved_buyer`, `resolved_seller`, and `closed`.
- `deal_disputes.status` accepts `open`, `under_review`, `resolved`, and `cancelled`.
- `deal_disputes.deal_id` is unique and its foreign key cascades on deal deletion.

The claim RPC and triggers use these actual state contracts. The dispute trigger also preserves the existing `ON DELETE CASCADE` behavior: when a parent deal is being deleted and is no longer visible to the child trigger, the cascading child delete is allowed. A direct dispute delete while the deal exists is still serialized and blocked during an active claim.

## Test coverage

The branch CI workflow uses disposable PostgreSQL 16 and covers:

- dispute-first rejection of a release claim;
- claim-first rejection of a new dispute and deal-level dispute transition;
- idempotent claim retry without rebroadcast;
- claim retention while the result is uncertain;
- release of the active hold only after a confirmed failure state;
- successful finalization and terminal-deal dispute rejection;
- both concurrency orderings using separate PostgreSQL sessions;
- least-privilege table and function grants.

These tests do not constitute a live Supabase Edge Function integration test or a BNB-chain transaction test.

## Security boundary

This guard coordinates actions that pass through Web3Market's database and Edge Functions. Safe remains a multisig wallet, not an escrow smart contract. It cannot prevent Safe owners from executing a fully signed Safe transaction directly through Safe or another client outside Web3Market. The protocol must not claim otherwise.

## Deployment boundary

This document and migration are branch-only. Do not apply the migration, deploy Edge Functions, connect the Deal Room UI, or perform a real Safe transaction without the user's explicit approval and a separate isolated integration test.

## Historical legacy completion compatibility

The branch finalizer preserves read-only verification for a legacy deal that was already marked completed before the release-claim ledger existed. The exception applies only when the deal is already completed and the submitted outer transaction hash exactly matches the stored `release_tx_hash`.

The finalizer still verifies the participant, terminal dispute state, stored release policy and multisig transaction, configured Safe and BNB chain, executor sender, decoded Safe execution payload, recomputed Safe transaction hash, successful receipt, Safe `ExecutionSuccess` event, and exact seller/platform token transfers. If all checks pass, it returns an `already_finalized` response without inserting or mutating a release claim, deal, policy, or multisig record.

A failed outer receipt or Safe `ExecutionFailure` event cannot rewrite historical completion or create a retroactive failed claim. This exception does not apply to funded/in-progress legacy deals or any V1 deal. It is covered by a branch source-regression test; it is not a live historical transaction test.
