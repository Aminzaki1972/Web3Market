# Deal Management Additive Data Model Proposal

Date: 2026-11-15
Status: design only — not an executable migration

## Safety boundary

This proposal is for the isolated branch `prototype/deal-management-system-20261114` only. It has not been applied to Supabase. It does not create paid resources, alter production data, change existing policies, or authorize a merge/deployment.

## Source-of-truth findings

The live project currently uses UUID identifiers for `deals.id`, `deal_assets.id`, `deal_messages.id`, `deal_party_agreements.id`, and `deal_disputes.id`. The existing deal-related tables already store buyer/seller IDs, amounts, commission fields, Safe address/chain/token fields, asset delivery/acceptance fields, chat messages, initial dispute evidence, and basic agreement timestamps.

The live migration history records the original deal schema and security migrations, including:
- `20260828164812_secure_deal_lifecycle_v1`
- `20260828164836_lock_deal_client_writes_v1`
- `20260828173055_create_deal_room_messages_and_events`
- `20260828181630_build_multisig_dispute_resolution_v1`
- `20260828181707_secure_deal_terms_agreements_v1`
- `20260828184353_secure_deal_workflow_and_verification`
- later agreement, release-policy, delivery, nonce, RLS, and audit hardening migrations.

The repository's current `supabase/migrations` directory does not contain the original deal schema migration source files matching those early live migration-history entries. It does contain later audit migrations. Therefore, the exact historical SQL cannot yet be reviewed from the repository. This is a source-control gap, not a reason to reconstruct or overwrite the existing schema from guesswork.

## Proposed additive records

These are logical records and constraints to implement only after the original schema migrations and all existing constraints/RLS have been mapped.

### A. Immutable agreement versions

Proposed logical entity: `deal_agreement_versions`

Required fields:
- `id uuid primary key`
- `deal_id uuid not null references deals(id)`
- `version_number integer not null`
- `canonical_terms jsonb not null`
- `canonical_terms_hash text not null`
- `created_by uuid not null`
- `created_at timestamptz not null default now()`
- `supersedes_version_id uuid null references deal_agreement_versions(id)`

Required invariants:
- unique `(deal_id, version_number)`
- unique `(deal_id, canonical_terms_hash)`
- immutable after insertion; a change creates a new version
- hash is calculated server-side from a deterministic canonical representation; never trusted from the browser
- the version snapshot includes final gross price, 7.5% fee basis, currency/network, selected assets, delivery deadlines, optional buyer-review duration, dispute rules, and allocation rules
- a new version invalidates all approvals for earlier versions without deleting the earlier approval history

### B. Approval records bound to the exact agreement

Proposed logical entity: `deal_agreement_approvals`

Required fields:
- `id uuid primary key`
- `deal_id uuid not null references deals(id)`
- `agreement_version_id uuid not null references deal_agreement_versions(id)`
- `party_role text not null` with the intended roles buyer, seller, platform
- `actor_user_id uuid null` (the platform actor mapping is intentionally unresolved)
- `approved_terms_hash text not null`
- `approval_method text not null`
- `approval_evidence jsonb not null`
- `approved_at timestamptz not null`

Required invariants:
- approval hash must equal the immutable version hash
- approval is unique per version and party role; repeated requests are idempotent
- buyer/seller approval must be bound to the authenticated user and deal role on the server
- platform approval must be bound to a separately approved platform authority; do not infer that authority or use client-supplied role values
- any agreement revision leaves previous approvals intact as history but makes them ineligible for the current version

**Decision gate:** the exact platform approval authority/signing mechanism has not yet been specified. Do not implement the platform approval write path until it is specified.

### C. Append-only dispute evidence and review timeline

Proposed logical entity: `deal_dispute_events`

Required fields:
- `id uuid primary key`
- `deal_id uuid not null references deals(id)`
- `dispute_id uuid not null references deal_disputes(id)`
- `event_type text not null`
- `actor_role text not null`
- `actor_user_id uuid null`
- `payload jsonb not null`
- `previous_event_hash text null`
- `event_hash text not null`
- `created_at timestamptz not null default now()`

Required invariants:
- append-only; client UPDATE/DELETE denied
- event sequence is serialized per dispute and hash-linked to its predecessor
- evidence item events preserve source, submitted-by, server timestamp, content hash, and immutable storage object reference
- claimant evidence, respondent notice, respondent response, evidence review, admin approval/decline, decision reason, exact financial allocation, and final settlement status are separate event types
- the event table is not itself proof that a Safe lock or payout occurred; those facts require independent chain verification
- client users may submit only events allowed for their authenticated deal role; administrative decision events are server-only and require the single active admin authority

The current `deal_disputes` row remains the compatibility/current-state record until a separately reviewed transition plan exists. Do not remove its one-dispute-per-deal constraint without a product decision.

### D. Durable deal activity timeline

Proposed logical entity: `deal_activity_events`

Required fields:
- `id uuid primary key`
- `deal_id uuid not null references deals(id)`
- `actor_role text not null`
- `actor_user_id uuid null`
- `event_type text not null`
- `event_payload jsonb not null`
- `occurred_at timestamptz not null default now()`
- `request_id text null`
- `idempotency_key text null`
- `previous_event_hash text null`
- `event_hash text not null`

Required invariants:
- append-only, with server-generated timestamps and server-derived actor identity
- unique idempotency key within a deal when supplied
- corrections are new events referencing the corrected event; no silent edit/delete
- never duplicate secrets, session tokens, private keys, or unnecessary message bodies in the activity log
- chat message bodies remain in `deal_messages`; the activity timeline records message metadata/event references only

### E. Chat archive and attachment metadata

The existing `deal_messages` table is reused. Before any extension, map its current triggers, RLS, grants, and message metadata audit coverage.

If attachment metadata is not already represented elsewhere, a separate `deal_message_attachments` entity may be needed with:
- message/deal references
- immutable storage object key (not a public URL)
- content type, byte size, content hash, uploader identity, server timestamp
- scan/verification state
- access controlled by deal participation and admin review rules

No bucket or storage policy should be created until the existing Storage buckets and policies are inventoried. No attachment should be exposed through a public bucket.

## Access-control contract

- All exposed tables require RLS.
- Do not rely on UI visibility or user-editable `user_metadata` for authorization.
- Buyer/seller role and deal membership must be derived server-side from trusted database records and authenticated identity.
- No client INSERT/UPDATE/DELETE access to administrative decisions, platform approvals, hash-chain fields, or settlement verification records.
- Avoid broad `SECURITY DEFINER` functions. Any truly privileged function requires a private/non-exposed schema, explicit authentication/authorization checks, a fixed search_path, and restricted EXECUTE grants.
- A database hold is not an on-chain Safe lock.
- A stored Safe transaction intent is not proof of execution.
- Chain verification and Safe Guard enforcement remain separate requirements.

## Administrator singleton — intentionally not designed for deployment yet

The current `admin_users` table allows multiple rows. The new rule requires one active administrator globally and owner-only appointment/replacement. The platform-owner proof, owner-account recovery, reauthentication, session revocation, and atomic replacement protocol have not been specified. Do not add a unique index, delete admin rows, or create an appointment RPC until those controls are decided and reviewed.

## Required validation before an executable migration

1. Recover and review the exact source SQL for the original deal-related migrations from the canonical migration source; do not reverse-engineer a replacement from current column names.
2. Inventory all existing foreign keys, unique/check constraints, triggers, RLS policies, grants, Storage buckets, and functions touching the deal tables.
3. Confirm the unresolved platform approval authority.
4. Produce an additive migration with explicit rollback/forward-recovery notes and no destructive statements.
5. Test migration application, RLS isolation, concurrent approvals, event ordering, duplicate/idempotent submissions, and unauthorized writes in a free local database only.
6. Run Supabase security advisors and regression tests.
7. Keep all work on the isolated Git branch until separately approved.

## Current status

This document defines a safe target data contract. It is not a migration and does not claim database implementation or runtime integration is complete.
