# Active Offer Concurrency Audit

Date: 2026-10-18

## Scope and safety

Read-only inspection of the live Supabase project `hzhqlexnhtukfljcvnyd` and source review for the `feature/offer-notifications-email` branch. No production data, schema, Edge Functions, or deployment settings were changed.

## Results

1. A read-only query grouped deals by `(buyer_id, project_id)` for active statuses `pending, accepted, funded, in_progress, disputed` and returned no groups with more than one row. No active duplicate buyer/project pairs were found by this query at the time of the audit.
2. The `deals` table has no unique index enforcing one active deal per buyer/project. Therefore, concurrent submissions can still race even though the current data audit found no duplicates.
3. Existing `deals` triggers include:
   - `deals_financials_on_insert` → `enforce_deal_financials_on_write()`
   - `trg_sync_deal_fee_amount` → `sync_deal_fee_amount()`
   - `trg_web3market_deal_fee` → `set_web3market_deal_fee()`
   - `deals_fee_lock` → `lock_deal_fee()` on updates
   - state-transition and sensitive-field protection triggers
4. Two separate BEFORE INSERT triggers set deal fee/financial fields, and the financial validation trigger also calculates them. Their exact ordering and rounding behavior should be preserved and covered by tests; do not add another fee-calculation path in the new create-offer operation.
5. The live public schema has deal-related RPCs, but the earlier source audit did not find the expected `act_on_marketplace_offer` function in the live database. Do not assume an existing RPC can be reused without checking its actual definition.

## Recommended next implementation

Use a server-owned create-offer operation that serializes concurrent requests for the same buyer/project pair within one PostgreSQL transaction (e.g. a transaction-scoped advisory lock). After locking, it should:
- derive the buyer from `auth.uid()` and verify the buyer role;
- load the current project, derive seller from `projects.owner_id`, and reject self-offers;
- enforce that the listing is eligible for offers, including existing test-mode and sold/unavailable rules;
- check active statuses `pending, accepted, funded, in_progress, disputed`;
- reject a second offer with a clear conflict response rather than silently changing the amount or reusing a deal with different terms;
- insert one pending deal only when no active deal exists, relying on existing database triggers for fee calculation;
- keep notification/email work outside the transaction and best-effort.

Before writing the migration, inspect the exact live project eligibility columns, deal currency/default constraints, and relevant insert policies. Add an explicit concurrency test with two simultaneous submissions. The completed $10 reference deal must not be used for testing.

## Release gate

This report is an audit record only. No RPC, migration, index, frontend, or production configuration was changed. Do not apply a migration, deploy an Edge Function, merge the offer-notifications PR, or alter existing deals without a separate reviewed rollout.
