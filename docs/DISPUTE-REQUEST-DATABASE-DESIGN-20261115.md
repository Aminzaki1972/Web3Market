# Dispute Request and Administrative Review — Non-production Database Design

Date: 2026-11-15
Status: design only; not executable SQL; not approved for production
Scope: isolated Web3Market Deal Management branch. No paid resources, production writes, migrations, deployment, Safe changes, or funds movement.

## 1. Purpose

Define a forward-compatible database contract for the new dispute lifecycle without reusing the legacy `deal_disputes` row as a pending request. A participant's submission is a request only. It must not create a formally opened dispute, claim that the Safe is locked, or authorize a financial decision.

This design is deliberately not an executable migration. The original deal-schema migration source is still missing from the repository, and the full legacy function/policy/trigger/grant dependency graph has not yet been recovered and reviewed.

## 2. Proposed logical records

### A. `deal_dispute_requests` — mutable current-state projection

One row per submitted request, retaining the complete request lifecycle.

Required logical fields:
- `id`: generated UUID primary key.
- `deal_id`: UUID foreign key to the existing deal.
- `claimant_id`: authenticated participant user ID, derived server-side.
- `claimant_role`: buyer or seller, derived from trusted deal membership.
- `reason`: non-empty bounded text.
- `status`: constrained lifecycle state.
- `respondent_id`: the other deal participant, derived server-side.
- `response_deadline_at`: nullable server-calculated deadline using the deal's approved terms.
- `reviewed_by`, `reviewed_at`, `review_reason`: populated only by the authorized administrator after review.
- `created_at`, `updated_at`: server/database timestamps.

Initial status: `pending_admin_review`.

Proposed subsequent states:
- `approved_lock_pending`
- `lock_confirmed`
- `declined_hold`
- `declined_released`

Do not add a status implying a successful on-chain lock until a trusted verifier has checked the exact deal Safe, chain ID 56, successful receipt, required confirmations, expected lock event, and independently observed locked state.

The projection row may be updated only through trusted server-side transactional functions. Every state change must append an event in the same database transaction.

### B. `deal_dispute_request_events` — append-only lifecycle evidence

One row per lifecycle event, including:
- `id`: UUID primary key.
- `request_id`: foreign key to the request.
- `deal_id`: foreign key to the deal, retained for scoped queries and consistency checks.
- `sequence_no`: monotonically increasing per request; unique with request ID.
- `event_type`: constrained event name.
- `actor_user_id`: authenticated actor ID or an explicitly typed system actor.
- `actor_role`: server-derived participant/admin/system role.
- `payload`: validated JSONB containing the minimum evidence required for the event.
- `created_at`: database/server timestamp, never accepted from the browser.
- Optional integrity fields: `previous_event_hash` and `event_hash`, calculated by trusted code over canonical event content.

Events include request submission, respondent notification, response/evidence submission, administrator approval/decline, lock verification result, explicit declined-hold release, and relevant failed/retried operations.

Hash chaining can make tampering detectable but does not make a database absolutely immutable against privileged database operators. Do not market it as tamper-proof. Stronger external anchoring or independent retention would require separate review.

### C. Deal payout hold

A pending request must atomically create a deal-level administrative-review payout hold. The hold must be enforced by every trusted payout/release/refund instruction path, not only by a UI status.

The hold record/contract must support:
- deal ID and originating request ID;
- hold reason and state;
- server-created and server-released timestamps;
- release actor and mandatory reason;
- explicit confirmation that no other active hold remains before release.

A partial unique constraint should prevent more than one active dispute-review hold per deal. The exact representation must be reconciled with existing deal holds and payout paths before SQL is authored.

Do not rely on changing legacy `deals.dispute_status`: its current CHECK constraint has no pending-admin-review state. Do not loosen that CHECK until all legacy readers, triggers, functions, and settlement paths have been inventoried.

## 3. Transactional state transitions

### Participant submission
1. Verify Supabase session/JWT on the server.
2. Derive user ID from the verified session; ignore caller-supplied actor IDs/roles.
3. Lock the target deal row for the transaction.
4. Verify the user is exactly the buyer or seller on that deal.
5. Reject completed/cancelled/ineligible deals and any conflicting active hold/request.
6. Create request in `pending_admin_review`.
7. Create administrative-review payout hold.
8. Append the submission event.
9. Commit all records atomically.

No row is inserted into legacy `deal_disputes` at this stage. No Safe lock is claimed.

### Administrative review
1. Verify the server session and trusted administrator authority.
2. Lock the request and deal rows.
3. Recheck the current single-authorized-administrator rule from a trusted authority source.
4. Require a reasoned decision.
5. On approval, move to `approved_lock_pending`; retain the payout hold and start the separate Safe lock process.
6. On decline, move to `declined_hold`; retain the payout hold until a separate, explicit, reasoned release operation passes all checks.
7. Append the decision event in the same transaction.

The production administrator authority source is currently inconsistent: `is_admin()` reads `profiles.role`, while `admin_users` is not a singleton-enforced source. Owner appointment/recovery rules are unresolved. Therefore this design does not authorize an admin endpoint or select an authority source.

### Respondent response
The respondent is derived from the deal's other participant. The response deadline is calculated server-side from the approved agreement terms and trusted clock. Messages/evidence are appended; they do not themselves approve a financial outcome.

### Hold release after decline
A declined request does not automatically release the hold. A separate administrative action must:
- identify the exact request and deal;
- include a mandatory reason;
- verify the request is in the expected declined state;
- verify no other active hold or unresolved safety condition exists;
- append a release event;
- update the hold projection atomically.

## 4. Required database and API security boundaries

- Revoke direct `INSERT` into legacy `deal_disputes` from client roles as part of a reviewed migration, after confirming no legitimate live client path depends on it.
- Do not use legacy `open_deal_dispute` as the new request endpoint.
- Client roles must not directly insert/update/delete request, event, or hold records.
- RLS must be enabled on every new table. Participant read access must be scoped to the exact deal participants; administrator reads must use the verified current authority model.
- All mutations must use server-side transactional operations with verified identity and trusted database membership.
- Avoid exposing SECURITY DEFINER functions in `public`. If a privileged function is proven necessary, place it in a non-exposed schema, pin a safe search_path, check auth identity inside the function, and grant EXECUTE only to the intended server role.
- Do not rely on caller-supplied role, actor ID, timestamp, status, reviewer ID, Safe address, or chain-verification booleans.
- Add idempotency keys and unique constraints for request submission and event sequence. Retry must return the original outcome, not create a second request or event.
- Concurrency tests must cover simultaneous participant submissions, simultaneous admin decisions, retries, and hold release racing with payout attempts.
- Every payout path must check the active hold transactionally immediately before constructing/signing/submitting any Safe transaction. A DB hold alone cannot stop an independently executable Safe transaction; on-chain protection remains a separate required layer.

## 5. Legacy compatibility and migration preconditions

Before executable SQL:
1. Recover canonical historical deal schema SQL from a trusted backup or other authoritative source where possible.
2. Inspect complete definitions and dependencies for `open_deal_dispute`, `is_admin`, `is_deal_participant`, all relevant triggers, policies, grants, and payout/release functions.
3. Confirm every production caller of `open_deal_dispute` and direct `deal_disputes` INSERT.
4. Confirm all legacy payout/release/refund paths and any out-of-band Safe execution assumptions.
5. Design additive tables and policies without dropping/recreating legacy tables.
6. Use the installed Supabase CLI's documented migration creation command to create a real migration file; never invent a migration filename.
7. Run isolated database tests and security advisors before any production change is even proposed.

If the canonical source cannot be recovered, keep the migration blocked and document the remaining uncertainty. Do not infer missing constraints or silently replace legacy functions.

## 6. Acceptance tests required before integration

- Buyer and seller can each submit a request only for their own deal.
- A participant cannot submit on behalf of the other participant or another deal.
- Submission creates a pending request + active hold + event atomically.
- Submission never inserts an immediately open legacy dispute.
- Direct client INSERT into legacy disputes and all new request/event/hold tables is denied.
- Pending review blocks every payout/release/refund server path.
- Only the single currently authorized administrator can review; participants and unknown users are denied server-side.
- Approval enters lock-pending, not lock-confirmed.
- Lock-confirmed requires independently verified matching chain evidence.
- Decline retains the hold until explicit authorized release.
- Respondent response deadline uses server time and approved terms; silence never means acceptance.
- Duplicate retries are idempotent.
- Concurrent submissions/decisions/releases cannot create contradictory state.
- Cross-deal reads and writes are denied.
- Event history is append-only for application roles; privileged tampering limitations are documented and detectable controls tested.
- No database/UI/admin status can bypass Safe Guard or Safe threshold.

## 7. Explicit non-goals

This document does not:
- create or apply a Supabase migration;
- alter production grants, RLS, tables, functions, triggers, or data;
- decide the unresolved owner-controlled administrator appointment/recovery protocol;
- select or change Safe owners/threshold;
- deploy a Safe Guard or claim an on-chain lock;
- authorize AI to decide disputes or allocate money;
- create a separate escrow contract;
- introduce paid infrastructure or subscriptions.

## Current status

Design drafted for review in the isolated GitHub branch only. Implementation remains blocked on historical schema/dependency recovery and the unresolved administrator authority protocol. No production database operation was performed.
