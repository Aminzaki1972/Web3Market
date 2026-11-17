# W3M Protocol V1 — Source-Derived Safe Data Field Map

**Captured from:** Read-only source snapshots dated 2026-11-06  
**Purpose:** Identify fields actually referenced by the six deployed Safe functions before designing W3M adapters.  
**Important:** This is a source-derived field inventory, not a complete database schema. It does not establish SQL types, nullability, foreign keys, constraints, RLS, indexes, or authoritative write paths.

## 1. Fields explicitly selected from `deals`

The `prepare-deal-release` function explicitly selects:

- `id`
- `buyer_id`
- `seller_id`
- `amount`
- `currency`
- `status`
- `payment_status`
- `payment_tx_hash`
- `chain_id`
- `safe_address`
- `token_contract`
- `token_symbol`
- `dispute_status`
- `disputed_at`

Other captured functions use `select("*")` and reference these additional `deals` fields:

- `delivery_status`
- `buyer_approved_at`
- `release_tx_hash`
- `project_id`
- `safe_deployment_status` (referenced by the frontend/create-safe flow)
- `safe_deployment_tx_hash`
- `safe_deployer_wallet`
- `safe_deployed_at`

Do not assume this list is exhaustive.

## 2. Fields explicitly referenced in `deal_release_policies`

- `deal_id`
- `deal_amount`
- `fee_percent`
- `fee_amount`
- `seller_net_amount`
- `seller_wallet`
- `platform_wallet`
- `safe_address`
- `token_contract`
- `token_symbol`
- `chain_id`
- `safe_nonce`
- `status`
- `locked_at`
- `updated_at`
- `released_at`
- `release_tx_hash`

## 3. Fields explicitly referenced in `deal_multisig_transactions`

- `id`
- `deal_id`
- `action`
- `safe_tx_hash`
- `tx_hash`
- `status`
- `confirmations_count`
- `required_signatures`
- `safe_nonce`
- `to_address`
- `data`
- `value_wei`
- `operation`
- `safe_tx_gas`
- `base_gas`
- `gas_price`
- `gas_token`
- `refund_receiver`
- `signatures`
- `amount`
- `token_symbol`
- `chain_id`
- `safe_address`
- `updated_at`

## 4. Fields explicitly referenced in `deal_multisig_signers`

- `deal_id`
- `signer_role`
- `signer_id`
- `wallet_address`
- `signature_status`
- `signed_at`
- `safe_tx_hash`
- `signature`

The current signature recorder upserts on conflict target `deal_id,signer_role`. The actual unique constraint and its concurrency behavior must be confirmed from the authoritative schema before relying on it in a new RPC.

## 5. Other referenced records

| Table | Referenced fields | Source use |
|---|---|---|
| `profiles` | `id`, `wallet_address`, `wallet_verified`, `role` | Participant wallet and caller authorization |
| `deal_disputes` | `deal_id`, `status` | Open-dispute fail-closed check |
| `projects` | `id`, `status`, `updated_at` | Mark listing sold after verified settlement |
| `deal_audit_logs` | `deal_id`, `actor_id`, `action`, `metadata`, `old_status`, `new_status` | Audit trail |
| `deal_party_agreements` | Not queried by these six captured Edge Functions | Frontend records party acceptance; authoritative schema and acceptance semantics still need separate review |

## 6. W3M adapter mapping — confirmed vs unresolved

| W3M evidence | Source-derived candidate | Remaining proof required |
|---|---|---|
| PROJECT_IDENTITY | `deals.project_id`, accepted project record | Exact project approval/identity fields and ownership relation |
| CODE_AUDIT | Existing W3M audit registry | Exact audit-to-deal binding and immutable commit pin |
| OWNERSHIP_CONTROL | Asset-specific proofs | No generic ownership proof field was found in these six functions |
| ASSET_TRANSFER | `deals.delivery_status`, `buyer_approved_at` | Asset-by-asset transfer evidence; current flags alone are insufficient |
| DEAL_AGREEMENT | Deal terms and `deal_party_agreements` | Terms version/hash and complete party acceptance source |
| PAYMENT | `payment_status`, `payment_tx_hash`, release policy | Canonical chain receipt, token, amount, payer, recipient and finality source |
| BUYER_ACCEPTANCE | `delivery_status`, `buyer_approved_at` | Authoritative acceptance actor, exact delivered asset set and immutable version |
| DISPUTE_CHECK | `dispute_status`, `deal_disputes.status` | Complete dispute state machine and any separate settlement holds |
| REVENUE_VERIFICATION | No direct source in these six functions | Conditional chain/token/address/block scope must come from the deal's verified terms |

## 7. Explicit schema gaps — do not guess

The following are not established by the six function sources alone:

- SQL types, nullability, defaults, constraints, indexes, foreign keys and unique constraints.
- The exact schema and behavior of `validate_deal_release_policy`.
- Whether payment verification is exclusively represented by `payment_status` or is linked to a separate canonical payment ledger.
- Whether agreement acceptance includes a terms hash/version and all required parties.
- Whether any hidden settlement hold or administrator override exists.
- Whether the existing `deal_multisig_transactions` row is guaranteed unique per deal/action.
- Whether release/finalization operations can be safely combined in a transaction without conflicting with existing triggers.

Before implementing database RPCs or writing adapters, inspect the isolated schema/migration history and the definition of `validate_deal_release_policy`. Do not query or mutate production data as a substitute for this source/schema review.

## 8. Implementation boundary

The source-derived adapter must read canonical records server-side, normalize them into W3M evidence, and produce deterministic hashes. It must not accept evidence booleans, payment facts, wallet ownership, acceptance, or status values supplied by the browser. Every unresolved field above remains a blocker for an authoritative PASS decision.
