# W3M Deal Payment Path — Read-Only Source Review

Date: 2026-11-16  
Scope: source review only; no production writes, no Supabase deployment, no database migration execution, no live-chain transaction.

## Sources and identity

- Supabase Edge Function `verify-deal-payment`: ACTIVE, version 62, JWT verification enabled.
- Supabase Edge Function `deal-payment-monitor`: ACTIVE, version 44, JWT verification disabled; handler uses the database RPC `deal_payment_monitor_authorized` with `x-monitor-secret`.
- Both deployed entrypoints were retrieved read-only and compared against the recovery copies already committed on branch `w3m-v1-completion-20261116`. The deployed source fingerprints recorded in the recovery audit are:
  - verifier: `dae5138b9a5c30345097c512a613db4697a08b6ce8e27ac10977ae55baad88aa`
  - monitor: `efa56456ed919f977568e4f85058a445ef86f7b24708e987418546360e4c41d6`

## Existing trust boundaries

The verifier authenticates the caller with Supabase Auth, loads the deal server-side using the service-role client, restricts submission to `deal.buyer_id`, loads buyer and seller profile wallets from the database, requires both wallets marked verified, and checks that the configured Safe has the three expected owners and threshold 2. It checks a transaction sender, token-contract target, successful receipt, at least three confirmations, a Transfer event from buyer to Safe, and the amount derived from server-side deal fields.

The monitor uses a server-side secret authorization RPC, loads eligible deals from the database, reads verified buyer/seller wallets, checks Safe owners/threshold, scans BNB logs, and checks the candidate transaction, receipt, confirmations, transfer amount, and deal fee before attempting persistence.

## Findings — must fix before relying on live deal funding

### P1 — Payment verification persistence is not atomic

In verifier v62, the code upserts `blockchain_transactions`, updates the deal to `payment_status=confirmed` / `status=funded`, then validates the 7.5% fee configuration and performs a second fee update. Errors from the fee update and audit-log insert are not checked. A fee configuration error can therefore be returned after the payment transaction and funded status have already been written; a later write failure can leave partially updated state.

Monitor v44 has the same multi-write pattern: transaction upsert, conditional deal update, then unchecked audit insert. These steps are not one database transaction/RPC.

Required remediation: verify every invariant (including fee configuration) before any write, then persist transaction binding, deal funding, locked fee split, scan cursor, and audit record through one atomic database RPC with explicit row-count/conflict checks.

### P1 — Transaction-hash uniqueness is vulnerable to a check-then-write race

Verifier v62 checks `blockchain_transactions.tx_hash` and `deals.payment_tx_hash` before an upsert using `onConflict: tx_hash`. Two concurrent requests can both pass the pre-check. The later upsert can conflict on the hash and update the existing transaction row unless the database constraint/RPC rejects the cross-deal binding. The application pre-check alone is not a concurrency guarantee.

Monitor v44 also upserts on `tx_hash` and then updates the deal separately. Its deal update is guarded by `payment_tx_hash IS NULL`, but the transaction row may already have been upserted before that guard is evaluated.

Required remediation: enforce unique transaction-hash binding at the database layer and use a single atomic RPC that refuses any existing hash bound to a different deal or transaction type. Do not use an upsert that can rewrite an existing hash's deal binding.

### P1 — Receipt/event evidence is weaker than the isolated canonical verifier

Verifier v62 accepts the first matching Transfer event and breaks out of the loop. It does not require exactly one matching event, nor bind the selected event's transactionHash/blockHash/blockNumber/logIndex to the requested transaction and receipt. It does not reject removed logs. It also calculates confirmations from the receipt block and latest block without checking canonical block hash consistency or re-reading the block hash.

Monitor v44 likewise takes the first matching event, does not enforce exact-one matching event, and does not pin receipt/log evidence to a canonical block hash. Its scan result is based on provider-returned logs and it subsequently inspects a receipt, but does not establish full transaction/receipt/log metadata consistency.

Required remediation: integrate the separately tested `bnb-deal-payment-receipt-verifier.ts` only through a fresh server-side expected-payment context; require exact transaction/receipt/log metadata binding, unique matching Transfer event, non-removed log, canonical block hash, strict topics/data, and sufficient confirmations. Browser input must never supply expected amount, buyer, token, Safe, or chain facts.

### P2 — RPC chain identity is assumed, not checked

Both functions select an RPC endpoint and call `eth_blockNumber`, but do not verify `eth_chainId == 56`. A misconfigured `BSC_RPC_URL` can therefore point at a different EVM chain while database configuration says chain 56.

Required remediation: check chain ID on each provider before using it, and keep the canonical chain/token policy server-side.

### P2 — Configured token address is trusted from the deal row

Both functions use `deal.token_contract` as the token contract to inspect and use its decimals. They do not independently enforce the canonical BNB USDT contract. If Web3Market supports only BNB USDT for deal funding, enforce `0x55d398326f99059ff775485246999027b3197955` server-side; if multiple assets are intended, validate against a server-controlled allowlist and bind symbol/decimals to it.

### P2 — Safe verification is incomplete for a payment policy

The current checks establish deployed code, owner set, and threshold, but do not verify Safe version/implementation identity or bind the Safe facts to a canonical block snapshot. The isolated refund/payment receipt components use stronger block-pinned evidence patterns and should be reused consistently.

## Safe work completed in this branch

- Restored deployed v62/v44 source for reproducible review.
- Added a separate read-only canonical BNB deal-payment receipt verifier and isolated negative tests.
- The isolated verifier is not yet wired into either deployed function. No production behavior has changed.

## CI status at review time

Workflow run: https://github.com/Aminzaki1972/Web3Market/actions/runs/43910878967

The workflow is still running. Steps through `Test canonical BNB Safe buyer refund receipt verification` completed successfully; `Test canonical BNB deal payment receipt verification` was in progress at the latest check. The workflow must not be described as passing until the run reaches completed/success.

## Release gate

Do not deploy or treat live deal funding as protocol-complete until:
1. the canonical receipt verifier is wired to a fresh DB-derived expected-payment context;
2. chain ID, token allowlist, Safe identity, exact-one Transfer, canonical receipt/block/log binding are enforced;
3. payment persistence is atomic and transaction-hash uniqueness is guaranteed by database constraints/RPC;
4. tests cover concurrency, replay, partial-write failure, wrong-chain RPC, wrong token, duplicate events, removed logs, reorg/canonicality, and stale deal state;
5. CI passes and the change is reviewed separately before any production deployment.


## Follow-up implementation on the isolated branch

A pure server-context builder was added at `supabase/functions/w3m-acquisition-verification/fresh-bnb-deal-payment-context.ts`. It derives the verifier expectation from the freshly loaded deal, buyer profile and seller profile rows; binds the authenticated actor to the buyer; requires pending payment state; pins BNB chain 56 and the canonical BNB USDT contract; validates verified wallets; and converts the database amount to 18-decimal base units without floating-point arithmetic.

Its isolated tests are in `fresh-bnb-deal-payment-context.test.ts` and are included in the W3M Protocol V1 CI workflow. This helper is not yet called by the recovered production Edge Function, and does not persist or change any database state.

The canonical receipt-verifier test suite also exposed and fixed one incorrect test expectation: transaction/receipt block metadata mismatch is rejected at the receipt validation guard. The verifier itself remains read-only and is not deployed.

Latest branch head at this update: `4490d7a3bdcdd006bf74f2f39853caafbf3cab18`. CI run `43912149380` is queued/in progress; no passing result is claimed yet.


## Atomic payment finalization candidate — isolated branch only

The development branch now contains a candidate replacement path for both recovered Edge Functions:

- `verify-deal-payment/index.ts` now derives expectations from the fresh server-loaded deal and verified buyer/seller profile rows, calls the canonical BNB receipt verifier, and sends its typed evidence to `w3m_finalize_deal_payment`.
- `deal-payment-monitor/index.ts` still discovers candidate transfers through bounded `eth_getLogs` scans, but now pins providers to chain ID 56, pins the scan token to BNB USDT, re-verifies each candidate through the same canonical receipt verifier, and uses the same atomic finalization RPC. It no longer writes a confirmed transaction and funded deal through separate upserts/updates.
- Same-hash retry requests are no longer short-circuited before receipt verification. The fresh-context builder permits only the exact same already-funded/confirmed deal/hash retry; the SQL RPC then returns idempotent success only if the matching confirmed payment row already exists.
- The RPC inserts rather than upserts the transaction row, locks the deal row, revalidates buyer/profile, chain/token/Safe, exact expected base units and 7.5% fee, then writes transaction, deal funding, fee split, and audit event in one database transaction.
- Added case-insensitive unique indexes on `lower(blockchain_transactions.tx_hash)` and `lower(deals.payment_tx_hash)`. They intentionally fail closed if existing case-variant duplicates are present; those records must be reconciled before applying this migration.
- Added a disposable schema fixture, SQL contract test, TypeScript RPC adapter test, and CI type-check steps for both candidate Edge Functions.

Files:
- `supabase/migrations/20261116050000_w3m_protocol_v1_atomic_deal_payment_finalization.sql`
- `supabase/tests/w3m-protocol-v1-atomic-deal-payment-finalization.test.sql`
- `supabase/tests/w3m-deal-payment-finalization-fixture.sql`
- `supabase/functions/w3m-acquisition-verification/deal-payment-finalization-rpc-adapter.ts`
- `supabase/functions/w3m-acquisition-verification/deal-payment-finalization-rpc-adapter.test.ts`

Important release caveats:
- This migration and both modified Edge Function entrypoints are candidate code on the development branch only. They have not been applied/deployed.
- The monitor's scan-cursor update on the no-candidate path remains a separate non-financial write; funding itself now goes only through the atomic RPC.
- Before any production rollout, inspect existing data for case-insensitive duplicate hashes, confirm RPC role claims in a disposable Supabase-compatible environment, run the full CI workflow, and review the monitor's secret-auth RPC and provider behavior.
- The original deployed versions remain unchanged in Supabase.
