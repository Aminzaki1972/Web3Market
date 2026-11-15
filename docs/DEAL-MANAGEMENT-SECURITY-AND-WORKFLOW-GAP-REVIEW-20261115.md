# Deal Management Security and Workflow Gap Review

Date: 2026-11-15
Scope: read-only inspection of the currently connected Supabase project plus source review of the repository migration files. This document is not an authorization to change production.

## Critical incompatibility: dispute intake currently opens the dispute immediately

The live `public.open_deal_dispute(uuid,text)` function currently:
1. requires an authenticated user;
2. locks the deal row;
3. checks buyer/seller participation;
4. rejects completed deals;
5. inserts a dispute row;
6. immediately changes the deal status to `disputed`;
7. writes a legacy deal audit record.

This does not match the newly specified workflow where participant submission is only a dispute request, the administrator reviews and explicitly approves or declines it, and only approval begins the Safe lock workflow. Therefore the new Deal Room must not call this legacy function as its final dispute workflow. A new, separately reviewed request/review flow is required. Do not alter the existing function in production.

## Existing central audit coverage is partial, not a complete immutable ledger

The repository migration `20261023100000_add_audit_coverage_for_deal_and_support_events.sql` installs triggers for deal messages, disputes, party agreements, and multisig transaction records.

Observed coverage:
- Messages: audit on INSERT and DELETE; no UPDATE event in this trigger.
- Disputes: audit on INSERT and DELETE; UPDATE is logged only when status changes.
- Agreements: audit on INSERT and DELETE; UPDATE is logged only when `agreed_at` or `party_role` changes.
- Multisig: audit on INSERT and DELETE; UPDATE is logged only when status, action, or confirmations_count changes.
- Deal lifecycle has a separate trigger.
- The audit metadata deliberately excludes message bodies, attachment paths, signatures, transaction hashes, wallet addresses, financial values, and secrets.

This is useful activity metadata, but it is not the complete append-only evidence, agreement-version, administrative decision, financial allocation, or chain-verification history required by the new system.

The current `admin_audit_log` table has no table triggers of its own in the inspected schema. Client roles have no direct table grants, but `service_role` and `postgres` retain UPDATE, DELETE and TRUNCATE privileges. Therefore the table must not be described as cryptographically immutable or absolutely tamper-proof. A stronger design needs append-only application/database controls, separately protected privileged paths, and integrity verification. No such change is made here.

## Existing dispute and agreement constraints

- `deal_disputes` has UNIQUE(deal_id), allowing one dispute record per deal.
- Its status check currently permits `open`, `under_review`, `resolved`, and `cancelled`.
- `deal_party_agreements` has UNIQUE(deal_id, party_role) and a check allowing only buyer/seller.
- Agreement RLS binds buyer/seller writes to the authenticated participant and includes a restrictive owner-update policy.
- The current agreement tampering trigger must be preserved and reviewed before any versioned replacement is introduced.

## Administrator authorization and audit

- `admin_users` has a primary key on `user_id`; this does not enforce one active administrator globally.
- `public.is_admin()` delegates to `private.support_is_admin()`. The function definition alone does not prove a singleton administrator or owner-controlled appointment/replacement.
- Existing admin audit table grants are absent for client roles, while service_role has broad table privileges. Admin audit writes are performed by privileged backend paths/triggers.
- The new owner-only appointment/replacement mechanism remains unspecified. Do not create a singleton constraint, delete admin rows, or implement a promotion endpoint until the owner approval and recovery process is defined.

## Storage inventory relevant to deal chat

The inspected Storage buckets are:
- `project-media`: public; image/video MIME types.
- `support-attachments`: private; image/video MIME types.

No dedicated deal-chat attachment bucket was observed. Do not reuse the public project-media bucket for deal evidence. Before designing attachment persistence, inspect the complete Storage policies and decide whether a private deal-specific namespace can safely use the existing private bucket or needs a separately reviewed private bucket. Do not create a bucket in production.

## Existing Safe/deal schema remains legacy-compatible

The live database contains existing financial, Safe, delivery and release-policy records. The current constraints include a required-signatures value of 2 and legacy multisig actions. The database metadata does not prove dynamic on-chain owner/threshold checks, Guard enforcement, transaction simulation, actual Safe execution, or independent receipt/event verification.

The new sandbox's policy that any Safe Guard failure blocks all outgoing transfers must be enforced on-chain, not merely by a database status or UI. No Safe setting, Guard, wallet, or funds were changed.

## Required non-production regression cases before integration

1. Participant submits a dispute request: status becomes pending administrative review; no Safe lock is claimed.
2. Payout instructions are blocked during pending administrative review.
3. Only the one authorized administrator can approve/decline; buyer/seller cannot call admin actions.
4. Approval creates a lock-pending state; lock is not confirmed until independent chain evidence matches chain ID, exact Safe, receipt, confirmations and locked state.
5. Decline leaves the payout hold in place until a separate explicit, reasoned release is recorded and independently validated.
6. Respondent is notified and can submit evidence before the agreement-defined deadline.
7. Every agreement approval binds to the same immutable version and server-calculated hash.
8. Agreement revision leaves old approvals as history but makes them ineligible for the new version.
9. Message edits/deletions and corrections are represented without silent loss; message content and attachments remain private to participants and authorized admin.
10. Unauthorized direct table writes, cross-deal reads, replayed requests, duplicate transaction hashes, concurrent approvals, and forged actor IDs are rejected.
11. Admin audit record tampering is detected or blocked through privileged-path controls; do not call the current log tamper-proof.
12. Guard failure blocks every outgoing path, including direct and alternate Safe execution paths.

## Source-control and migration limitation

The live Supabase migration history includes older deal migrations (August/September 2026) that are not present as SQL files in the current repository `supabase/migrations` directory. Only later audit coverage SQL is currently present in the inspected repository tree. This prevents safe reconstruction of the exact historical migration chain from source control.

Before authoring an executable additive migration, recover the canonical historical migration source from a trusted backup/source-control location and compare it with the live schema. Do not recreate existing tables or policies from inferred names.

## Current outcome

This is a documentation-only gap review. No production SQL was executed for writes, no migration was applied, no paid service was created, and no merge or deployment was performed.


## Additional source-history recovery and current Deal Room client review (2026-11-15)

### Historical migration recovery result

The Git tree at commit `b30263d155317dc936d82b862e1bfcf436f3b56a` (a historical repository snapshot) contains the October 2026 migration set, including the central admin audit log and deal/support audit coverage migrations. It does not contain the original deal lifecycle, agreement, dispute, or multisig schema-creation migrations. GitHub commit-history lookups for the expected August deal migration filenames also returned no file history.

This narrows the likely explanation: those original deal schema migrations were not present in the repository migration directory at the inspected historical snapshot either. The live Supabase migration history therefore cannot currently be reconstructed from the accessible Git repository. This is not evidence that the remote schema is missing; it is a source-control provenance gap.

Historical audit source files recovered and inspected:
- `20261023080000_create_admin_audit_log.sql`: creates `admin_audit_log`, enables RLS and revokes direct client-role access. It does not install immutability triggers or prevent privileged service-role mutation.
- `20261023100000_add_audit_coverage_for_deal_and_support_events.sql`: installs metadata-only activity triggers for messages, disputes, agreements and multisig rows. The audit design intentionally excludes sensitive message bodies, signatures, transaction hashes, wallet addresses and financial values.

### Current Deal Room UI is still using legacy direct table operations

The current branch file `js/deal-room.js` was inspected. Its live Deal Room path still:
- reads `deal_party_agreements` directly;
- upserts participant consent directly into `deal_party_agreements` using a browser-generated timestamp;
- inserts a dispute directly into `deal_disputes` with status `open`;
- sends chat messages directly into `deal_messages`.

Consequences:
1. The agreement button does not yet call a server-authoritative, version/hash-bound, three-party approval endpoint.
2. The dispute button bypasses the new pending-request/administrator-review state machine and writes the legacy dispute row directly.
3. A browser timestamp is not sufficient evidence of server-authoritative agreement acceptance.
4. The current UI is not yet wired to the new sandbox domain workflow.
5. Existing RLS and triggers may permit these legacy writes; this review does not claim that RLS alone is absent or bypassed. The incompatibility is the old workflow semantics and missing integration.

The current file also displays legacy Safe and platform-resolution language. Any replacement must preserve the approved rule that Safe remains the sole deal-funds vehicle, while actual Safe execution and Guard enforcement remain separate unimplemented integration work. The local preview must not be presented as a production workflow.

### Required integration order

1. Recover canonical schema provenance as far as possible; document which original migrations are absent rather than reconstructing them by guesswork.
2. Build and test server-authoritative database contracts for agreement versions/approvals and dispute requests/review, using additive migrations only after full schema/RLS/trigger/grant comparison.
3. Implement and test authenticated server functions that bind caller identity to the deal participant or the single authorized administrator.
4. Replace the legacy browser direct writes in the Deal Room with those server functions; keep chat persistence separate from legal consent and financial decisions.
5. Run isolated database tests for RLS, privilege boundaries, duplicate/retry behavior and concurrency before any production deployment.
6. Only then proceed to Safe testnet integration and end-to-end workflow validation.

No UI code or database migration was changed as part of this review.


## Fail-closed Deal Room client change (2026-11-15)

The isolated branch now disables the legacy agreement-approval and dispute-submission buttons in `js/deal-room.js` and removes the obsolete dispute modal. The previous direct browser writes to `deal_party_agreements` and `deal_disputes` were removed from this client file.

The UI now states that the new server-authoritative workflow is not connected yet. This is an intentional safety barrier: it prevents browser timestamps from being presented as binding three-party approvals and prevents dispute submissions from bypassing the new administrative review state machine.

Verification performed against the committed client source:
- No direct INSERT/UPSERT/UPDATE/DELETE calls remain against `deal_party_agreements` in `js/deal-room.js`.
- No direct INSERT/UPSERT/UPDATE/DELETE calls remain against `deal_disputes` in `js/deal-room.js`.
- The obsolete dispute modal is absent.
- Chat still uses the legacy `deal_messages` path; it is not yet the fully authenticated, permanent archive/attachment workflow.

The sandbox GitHub Actions workflow now also runs `node --check js/deal-room.js` when that client file changes. Run `43667143165` completed successfully for commit `6ffb725bc9db313f5dbeabb0e354900badac91d5`.

This is a fail-closed client-side guard, not a backend authorization boundary. It does not implement the new agreement/dispute endpoints, database persistence, single-admin authorization, Safe lock, or on-chain settlement.


## Deterministic agreement snapshot primitive (2026-11-15)

Added `prototype/deal-management/agreement-snapshot.ts` and tests. The sandbox primitive:
- serializes JSON objects with recursively sorted keys;
- preserves array order;
- normalizes strings to Unicode NFC;
- rejects unsupported/lossy values, non-finite numbers, unsafe object keys, normalized-key collisions, and excessive nesting;
- computes a SHA-256 digest over the canonical JSON.

Tests cover key-order invariance, array-order sensitivity, Unicode normalization, unsupported values, unsafe keys, and top-level object validation.

This is a tested deterministic serialization primitive only. It is not yet called by a trusted Edge Function, does not persist immutable agreement versions, and does not verify wallet signatures or platform approval authority. The platform approval decision gate remains open. No database migration or deployment was performed.


## Latest sandbox verification (2026-11-15)

The latest relevant workflow run after adding the canonical agreement snapshot tests and the Deal Room syntax check completed successfully: run `43667434900`, with **114 passed, 0 failed** in the Deno sandbox suite and the `node --check js/deal-room.js` step successful. This run tested commit `44d0a699c359451359413cbef7d638b53ccc6615`; the current branch head contains only a subsequent documentation/PR-description update.


## Fail-closed Deal Room authorization policy model (2026-11-15)

Added `prototype/deal-management/deal-authorization.ts` and focused tests. The policy derives buyer/seller/admin role from an authenticated user ID plus a trusted deal roster, rejects unknown users, restricts administrative review/decision/hold-release actions to the sole active administrator, prevents admin impersonation of a buyer/seller participant, and fails closed if the trusted roster contains multiple active admins.

Verification boundary: this is still a pure policy model. It does not verify Supabase JWTs, load trusted rows, or protect a deployed Edge Function/database by itself. A future Edge Function must obtain the identity from the verified session and load deal/admin membership from trusted database records before invoking equivalent checks. The unresolved owner-controlled appointment and recovery protocol remains a blocker for implementing the live singleton-admin write path.

The GitHub Actions run triggered by the source-module commit completed successfully with 114 passed and 0 failed. Because that run's commit preceded the separate test-file commit, a subsequent run on the latest branch head is required to confirm the new authorization tests themselves.


## Production read-only schema/security recheck (2026-11-15)

The active Supabase project `web3market` was queried read-only. No DDL, data writes, function deployments, or settings changes were made.

### Confirmed current dispute contract

- `deal_disputes.status` CHECK permits only `open`, `under_review`, `resolved`, and `cancelled`; it has no `pending_admin_review` state.
- `deal_disputes.deal_id` is UNIQUE, so the current table supports at most one dispute row per deal.
- Existing participant INSERT RLS policy allows a buyer/seller to insert a `deal_disputes` row when `opened_by = auth.uid()` and the user is a deal participant. Therefore the current path can create an immediately active `open` dispute without a separate manager approval record.
- Existing SELECT policy allows `is_admin()`, the opener, or either deal participant to read.
- An existing audit trigger records dispute INSERT/UPDATE/DELETE into `admin_audit_log`, but this is not an append-only evidence/review state machine and does not create a distinct pending-request phase.
- Current `deals.dispute_status` CHECK includes `none`, `open`, `under_review`, `resolved_buyer`, `resolved_seller`, and `closed`. The current status constraints do not encode the new administrative-review lifecycle.

### Administrator source mismatch

- Read-only counts at inspection time: `admin_users` contains exactly 1 row; `profiles.role='admin'` contains exactly 1 row; those rows match.
- This is only a snapshot, not a singleton guarantee. `admin_users` has `user_id` as its primary key and does not enforce a global single-row constraint.
- `public.is_admin()` delegates to `private.support_is_admin()`, which checks `profiles.role='admin'`; it does not use `admin_users` as the authority source.
- Consequently, the new single-active-admin / owner-only appointment rule is not enforced by the current schema. Do not treat today's row count as proof of the appointment/replacement protocol.

### Existing security controls that must be preserved

- `deals` has financial-field and state-transition protection triggers, plus the fee-lock/fee-sync triggers. A new implementation must be tested against all of them; do not write around them.
- `deal_party_agreements` permits only buyer/seller roles, has UNIQUE `(deal_id, party_role)`, and includes update protection/audit triggers. It cannot represent version-bound three-party approvals.
- `deal_assets` has a status CHECK for pending/delivered/accepted/rejected, a unique `(deal_id, asset_name)`, and an update-protection trigger.
- `deal_multisig_transactions` constrains actions to deposit/release_to_seller/refund_to_buyer, requires exactly 2 signatures, and has an audit trigger. This does not prove dynamic Safe owner/threshold validation.
- `deal_messages` has participant insert/select policies and an audit trigger for message metadata; it is not yet the required server-timestamped, correction-linked, attachment-backed permanent archive.
- The existing `is_deal_participant(uuid)` helper is SECURITY DEFINER in the exposed `public` schema. Its exact grants and every call path must be checked before any new endpoint relies on it.

### Security Advisor snapshot

The Supabase Security Advisor returned unrelated/general findings at the time of inspection: 9 RLS-enabled tables without policies (including internal audit tables), 4 public SECURITY DEFINER functions callable by anon, 7 callable by authenticated, and leaked-password protection disabled. These findings are not evidence that the deal tables themselves lack RLS. They should be triaged separately; do not make broad unrelated security changes as part of this Deal Management patch.

### Implementation consequence

Do not insert into `deal_disputes` for a request awaiting manager review. A safe design needs a separate request state/record and append-only request events (or a carefully reviewed additive equivalent), plus server-side identity and authorization. The current production status CHECK and UNIQUE constraint must remain intact until a forward-compatible transition is separately reviewed. The current manager authority source and owner-controlled replacement protocol must be resolved before enabling admin review/decision writes.

Historical original deal-creation migrations are still absent from the repository's tracked migration directory; the current live migration history exposes versions/names, not their original SQL bodies. The PR #74 historical dispute-release guard migration was inspected as a later guard patch only; it is not a substitute for the missing original schema migrations and is not copied into this branch.
