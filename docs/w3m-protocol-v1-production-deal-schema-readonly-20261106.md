# W3M Protocol V1 — Production Deal Schema Read-Only Inspection
Date: 2026-11-06

## Scope and safety
This inspection was performed against the Supabase project `web3market` (project ref `hzhqlexnhtukfljcvnyd`) only after explicit user approval. It used schema/catalog metadata reads only:
- `list_tables` with verbose column metadata for `public`
- migration history listing
- read-only SELECTs against PostgreSQL catalogs (`pg_proc`, `pg_constraint`, `pg_indexes`, `pg_policies`)

No business rows were selected. No INSERT, UPDATE, DELETE, DDL, migration, Edge Function invocation/deployment, wallet operation, Safe transaction, or funds movement occurred. This document contains schema definitions and metadata, not user or deal records. The table tool's approximate row-count metadata was not used as evidence about any deal.

## Confirmed authoritative table shapes

### public.deals
Primary key: `id uuid`.
Relevant fields:
- Binding: `project_id uuid`, `buyer_id uuid`, `seller_id uuid`
- Terms: `amount numeric`, `currency text`, `status text`
- Settlement config: `chain_id bigint`, `safe_address text`, `token_contract text`, `token_symbol text`, `expected_amount numeric`
- Payment: `payment_status text`, `payment_tx_hash text`, `funded_at timestamptz`
- Release: `release_tx_hash text`, `completed_at timestamptz`
- Fee snapshot: `platform_fee numeric`, `platform_fee_percent numeric DEFAULT 7.50`, `platform_fee_amount numeric`, `seller_net_amount numeric`, `fee_locked_at timestamptz`
- Dispute: `dispute_status text`
- Delivery: `delivery_status text`, `delivery_submitted_at timestamptz`, `delivery_data jsonb`, `delivery_accepted_at timestamptz`, `delivery_rejected_at timestamptz`, `buyer_approved_at timestamptz`
- Safe deployment: `safe_deployment_tx_hash text`, `safe_deployer_wallet text`, `safe_deployed_at timestamptz`, `safe_deployment_status text`
- Payment scan cursor: `payment_scan_from_block bigint`, `payment_scan_last_block bigint`, `payment_scan_updated_at timestamptz`

Important checks:
- `amount >= 0`
- status values: pending, accepted, funded, in_progress, completed, cancelled, rejected, disputed
- dispute_status values: none, open, under_review, resolved_buyer, resolved_seller, closed
- buyer/seller reference profiles; project references projects.

### public.deal_release_policies
Primary key `id uuid`; unique `deal_id uuid` (one policy row per deal).
Relevant fields:
- `deal_amount numeric`, `fee_percent numeric`, `fee_amount numeric`, `seller_net_amount numeric`
- `seller_wallet text`, `platform_wallet text`, `safe_address text`, `token_contract text`, `token_symbol text`, `chain_id bigint`
- `status text` (pending, locked, ready, blocked, released)
- `locked_at timestamptz`, `released_at timestamptz`, `release_tx_hash text`, `safe_nonce bigint`

Checks include:
- deal_amount > 0; fee_percent 0..100; fee_amount and seller_net_amount >= 0
- platform wallet is pinned to `0x2B15cC63eE3b833F502C065767695Fa2B584f8c9`
- `release_policy_math`: `fee_amount = round(deal_amount * fee_percent / 100, 18)` and `seller_net_amount = deal_amount - fee_amount`
- unique `deal_id`; partial unique indexes on (deal_id, safe_nonce) when nonce exists and release_tx_hash when present.

### public.deal_multisig_transactions
Primary key `id uuid`; FK `deal_id`.
Relevant fields:
- `action text` (deposit, release_to_seller, refund_to_buyer)
- `amount numeric`, `token_symbol text DEFAULT 'USDT'`, `chain_id bigint`, `safe_address text`
- `tx_hash text`, `safe_tx_hash text`, `safe_nonce bigint`
- `to_address text`, `data text`, `value_wei numeric`, `operation integer`
- Safe gas fields: `safe_tx_gas numeric`, `base_gas numeric`, `gas_price numeric`, `gas_token text`, `refund_receiver text`
- `signatures jsonb`, `confirmations_count integer`, `required_signatures integer DEFAULT 2`
- `status text` (awaiting_signatures, signed, submitted, confirmed, cancelled)

Constraints:
- allowed action list above; amount >= 0; required_signatures = 2
- unique Safe tx hash where non-null
- index on (safe_address, chain_id, safe_nonce) where nonce is non-null
- No schema-level unique constraint for one active release row per deal, nor unique (deal, action) constraint.

### public.deal_multisig_signers
Primary key `id uuid`; FK `deal_id`.
Fields: `signer_role` (buyer/seller/platform), `signer_id uuid`, `wallet_address text`, `signature_status` (pending/signed/rejected), `signed_at timestamptz`, `safe_tx_hash text`, `signature text`.
Constraints:
- unique (deal_id, signer_role)
- partial unique (deal_id, wallet_address, safe_tx_hash) when safe_tx_hash is not null
- role/status checks.

### Other supporting tables
- `deal_party_agreements`: unique (deal_id, party_role), buyer/seller roles, party_id, agreed_at.
- `deal_disputes`: unique deal_id, status open/under_review/resolved/cancelled, evidence jsonb, resolution fields.
- `deal_audit_logs`: deal_id, actor_id, action, old/new status, metadata jsonb, created_at.

## RLS metadata observed
RLS is enabled on all seven reviewed tables.
- `deals`: authenticated SELECT limited to admin or buyer/seller participant; INSERT has buyer identity and restrictive integrity checks.
- `deal_release_policies`: authenticated SELECT limited to deal participants; no client write policy surfaced.
- `deal_multisig_transactions` and `deal_multisig_signers`: participant SELECT policies; no client write policies surfaced.
- `deal_party_agreements`: participant/party-scoped SELECT/INSERT/UPDATE policies.
- `deal_disputes`: participant/admin SELECT and participant INSERT.
- `deal_audit_logs`: participant/admin SELECT; no client write policy surfaced.

This is a metadata snapshot of current policies, not a full authorization penetration test.

## validate_deal_release_policy — exact current definition
Signature: `public.validate_deal_release_policy(p_deal_id uuid) RETURNS jsonb`.
Catalog metadata confirms:
- `SECURITY DEFINER`
- `search_path=public`
- ACL shown: EXECUTE for `postgres` and `service_role`; no PUBLIC/anon/authenticated grant shown.

Function logic:
1. Loads the deal by ID.
2. Rejects missing deal.
3. Allows `deals.dispute_status` only when coalesced value is `none` or `resolved`.
4. Requires `payment_status='confirmed'` and non-null `payment_tx_hash`.
5. Requires `delivery_status='accepted'` and non-null `buyer_approved_at`.
6. Requires chain 56 and non-null Safe/token addresses.
7. Calculates `fee := round(deals.amount * 7.5 / 100, 8)` and `net := deals.amount - fee`.
8. If policy status is locked/ready/released, checks amount, 7.5%, fee/net, Safe, token, chain 56 and non-null Safe nonce.
9. Returns valid=true plus computed terms and policy nonce.

## Confirmed integration design blockers / discrepancies

### D1 — fee precision disagreement (must resolve before writing a policy RPC)
The table CHECK constraint computes fee at 18 decimal places:
`round(deal_amount * fee_percent / 100, 18)`.
The current validation function computes at 8 decimal places:
`round(amount * 7.5 / 100, 8)`.
These formulas can produce different numeric values for valid `numeric` deal amounts. A server-side write using the function's 8-decimal fee may violate `release_policy_math`; a write using the table's 18-decimal fee may then disagree with the function's locked-policy comparison. Do not guess the intended precision. The isolated protocol must explicitly model and test the chosen canonical fee precision before proposing any DB integration.

### D2 — dispute status vocabulary disagreement
The `deals.dispute_status` CHECK allows `none, open, under_review, resolved_buyer, resolved_seller, closed`; it does not allow literal `resolved`.
The validation function permits only `none` or literal `resolved`. Therefore, based on the current schema vocabulary, `none` is the only representable accepted value. This is fail-closed, but if resolved disputes are intended to permit settlement, the allowed terminal statuses need an explicit policy decision; do not silently broaden the gate.

### D3 — no persisted execution-attempt/claim entity
The existing multisig transaction row has hashes/status/signatures, but there is no explicit execution-attempt ID, claim lease, broadcast state, executor idempotency key, or reconciliation status. Existing unique indexes prevent duplicate non-null Safe hashes but do not themselves guarantee a single active release attempt per deal. The isolated integration design should add an atomic claim/attempt abstraction (or prove an existing safe equivalent) before broadcast retry handling.

### D4 — atomic finalization is not represented by a visible single-row primitive
Deal, release policy, multisig transaction, and audit log are separate tables. A future finalizer should be one scoped database transaction/RPC with expected-state predicates and idempotency; do not chain independent REST updates and assume atomicity.

### D5 — report binding must be added without weakening current server-only writes
Current RLS metadata shows participant read paths and no client write policies for release policy and multisig execution tables. W3M report ingestion and settlement authorization should remain server-only; never add authenticated browser write access to these tables.

## Migration history status
The production migration history currently lists migrations through `20261103065424` (`20261103065424_audit_v2_guest_checkout`). No W3M Protocol V1 evidence-registry or trusted-signer-registry migration appears in the production history snapshot. The two W3M registry migrations remain isolated/unapplied.

## Next isolated engineering steps
1. Record these confirmed schema facts in the isolated branch (this document).
2. Define canonical fee precision and terminal dispute policy as protocol invariants; do not alter production.
3. Design the report-to-deal binding and execution-attempt lifecycle against the actual columns/constraints above.
4. Add isolated SQL contract tests for precision, state predicates, unique claim behavior, idempotent broadcast recording, and atomic finalization.
5. Keep all W3M registry migrations and integration adapters on `w3m-protocol-v1-isolated-20261105`; no merge or deployment without separate explicit approval.

## Explicit non-actions
No production schema changes, no production function changes, no production data reads, no Edge Function deployments, no Safe calls, no wallet signatures, no blockchain transactions, and no funds movement.
