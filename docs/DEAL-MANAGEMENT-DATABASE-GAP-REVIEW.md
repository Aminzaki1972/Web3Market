# Deal Management Database Gap Review

Date: 2026-11-15

## Scope and safety

This is a read-only review of the existing Supabase project schema and migration history, prepared for the isolated Deal Management sandbox branch. No SQL migration was applied, no production row was changed, and no paid database branch or service was created.

The review is based on the currently visible `public` schema metadata, RLS policies, constraints, functions, and the project's recorded migration history. It does not establish that the new sandbox is integrated with these objects.

## Existing reusable database objects

The existing project already has durable tables for:

- `deals`: buyer, seller, project, amount, fee, payment, Safe deployment, delivery and lifecycle fields.
- `deal_assets`: per-deal assets with pending/delivered/accepted/rejected states and delivery/acceptance metadata.
- `deal_messages`: persistent buyer/seller messages with sender and translation metadata.
- `deal_party_agreements`: one row per deal and party role, currently limited to `buyer` and `seller`.
- `deal_disputes`: dispute request, evidence JSON, status and resolution metadata; currently constrained to one dispute row per deal.
- `deal_multisig_transactions`: Safe transaction intents/signature metadata, with actions currently limited to deposit, release-to-seller and refund-to-buyer.
- `deal_release_policies`: existing release-policy state.

Existing database functions include participant checks, dispute intake, delivery submission/confirmation, deal financial calculations, release-policy validation, and audit triggers. Existing migrations also include substantial RLS and client-write hardening.

## Confirmed gaps against the new Deal Management workflow

### 1. Agreement versioning and three-party approval

The current `deal_party_agreements` table has a unique key on `(deal_id, party_role)`, and its role constraint permits only buyer and seller. It does not represent immutable agreement versions, a canonical content hash per version, or a platform approval bound to that same version/hash.

Do not repurpose the current table by weakening its constraints. A separate versioned agreement model should be designed and reviewed, preserving existing data and behavior.

### 2. Dispute evidence exchange and decision record

The current dispute table stores initial evidence as JSON and has a single row per deal. The new workflow requires a durable, append-only sequence of claimant evidence, respondent notice/response and evidence, review actions, reasoned decision, exact allocation, and decision fingerprint. Existing columns alone do not demonstrate that complete sequence.

A separate append-only event/evidence/decision model or a carefully reviewed extension is required. Existing dispute records must remain readable and must not be silently rewritten.

### 3. Manager singleton

The current `admin_users` table is keyed by `user_id`, which allows multiple rows. Its visible self-read policy is not a singleton-owner appointment mechanism. The new policy requires exactly one active administrator platform-wide, with appointment/replacement controlled only by the platform owner and atomic replacement.

The owner-approval proof and owner-account recovery rules have not yet been specified. Do not implement an appointment or replacement path until those decisions are supplied. No second administrator is to be added.

### 4. Persistent activity and chat guarantees

Persistent chat rows exist, but the visible message table does not itself provide the complete immutable attachment archive, correction-as-new-entry behavior, or a unified actor/action audit contract required by the new workflow. Existing audit triggers cover some deal lifecycle/subworkflow/message metadata; their exact coverage must be mapped before extending them.

### 5. Safe execution and chain verification

The existing Safe transaction table records intent/signature fields, but schema presence is not proof of dynamic on-chain owner/threshold verification, Guard enforcement, transaction execution, receipt/log verification, or protection against alternate execution paths. These remain separate backend and chain-integration work.

## RLS observations requiring careful review

- Deal participant policies exist for reading deals, messages, assets, agreements, and Safe transaction records.
- The current dispute insert policy permits a participant to submit a dispute request; this must not be confused with a formally accepted dispute or a final administrative decision.
- Current agreement policies and constraints are designed around buyer/seller rows, not the new three-party version/hash approval model.
- The visible `admin_users` structure does not enforce a platform-wide singleton administrator.
- Do not broaden client privileges or weaken existing restrictive policies to make the prototype work.

## Safe implementation sequence

1. Preserve all existing tables, policies, triggers, and data.
2. Map current schema objects and their migration source files from the repository before authoring any migration.
3. Design additive tables for immutable agreement versions/approvals, append-only dispute evidence and decisions, and any missing activity metadata. Specify keys, idempotency, timestamps, actor binding, RLS, grants, and service-only write paths.
4. Design the administrator singleton only after owner-approval and recovery decisions are specified.
5. Add migration files to the isolated Git branch only. Do not apply them to the production Supabase project.
6. Validate migration syntax and policy behavior in a free local/test setup if available. If no free isolated database is available, report that database execution tests remain unrun; do not purchase a branch.
7. Integrate the UI and server functions only after schema contracts and authorization tests are ready.

## Current conclusion

The project has a substantial existing deal schema that should be reused, not replaced. The new sandbox still needs a reviewed additive data model and server-side integration. This review is documentation only and does not claim that the database integration is complete.
