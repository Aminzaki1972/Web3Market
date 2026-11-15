# Administrator authority integration review — 2026-11-15

Scope: repository inspection on `prototype/deal-management-system-20261114` and comparison with the tracked `main` sources. This document is design/review only. No Supabase project was queried or modified, no migration was applied, and no Edge Function was deployed.

## Findings: there are currently two different admin authorization signals

### A. Edge Functions and browser admin bootstrap use `public.admin_users`

The tracked code uses membership lookups such as `admin_users.user_id = auth user.id` in:
- `supabase/functions/admin-review/index.ts`
- `supabase/functions/w3m-trust-badge-approve/index.ts`
- `supabase/functions/w3m-code-audit/index.ts`
- `supabase/functions/ai-review-project/index.ts`
- `admin-mfa-setup-20260926.html`
- `js/code-audit.js`

These are currently the server-side membership source for several privileged features.

**Important repository gap:** a migration that creates or defines `public.admin_users` was not found in the tracked migration set inspected. It may have been provisioned outside the repository or in an untracked/older source. Its actual constraints, grants, RLS policies, write paths and current rows are therefore unknown. Do not assume the table is protected or that its membership is owner-controlled until its live definition and migration history are inspected in a separately authorized read-only review.

### B. SQL RLS helper uses `profiles.role = 'admin'`

The tracked support-chat migrations define:
- `private.support_is_admin()` as a SECURITY DEFINER lookup against `public.profiles.role`;
- `public.is_admin()` as a SECURITY INVOKER wrapper around that helper.

RLS policies in support-related migrations call `public.is_admin()`, with AAL2 checks on sensitive support access. The profile guard migration also exempts `public.is_admin()` from some privileged profile-field restrictions.

This means a user can be treated as an administrator by one path because they appear in `admin_users`, and by another path because their profile role is `admin`. The repository does not establish that these sets are always identical.

## Security consequence

Adding an owner-controlled administrator record without reconciling both legacy authorization paths would be unsafe:
- a removed administrator might still pass RLS because their profile role remains `admin`;
- a user removed from one source could remain privileged through the other;
- a new owner-appointed administrator might fail existing RLS checks if their profile role is not updated;
- changing the profile role directly would undermine the single-authority design and could preserve an independent privilege path.

Therefore, do not simply write the new administrator into `admin_users` and `profiles.role` as two independent updates. Do not treat a client-side admin list or hidden UI as enforcement.

## Recommended target model

Use one private server-owned authority record as the canonical source:
- immutable platform owner identity;
- exactly one active administrator identity;
- monotonically increasing authority generation;
- server timestamp and approval reference;
- a separate append-only appointment/replacement event history.

The canonical authority table must not be writable or readable by ordinary browser roles. Owner identity must be resolved from a protected server-side record, not from request JSON, user-editable metadata, email text, or a client-supplied role.

Every sensitive Edge Function must:
1. validate the bearer token using Supabase Auth `getUser(token)`;
2. load the current authority record from trusted storage;
3. authorize only if the verified `user.id` equals the current active administrator (and generation/state is current);
4. require AAL2 for privileged administrative actions according to the approved policy;
5. re-check authority inside the transaction for writes, preventing replacement races;
6. record the action with server-generated timestamp and actor identity.

The product owner appointment/replacement command must require a fresh authenticated owner session and an explicit step-up confirmation. The database transaction must atomically append the event, replace the current administrator, increment generation, and revoke the former administrator. Stale generation and concurrent requests must fail closed.

## Legacy compatibility and migration sequence

Do not flip authorization sources in one unreviewed deployment. The safe sequence is:

1. **Read-only inventory (first):** inspect the live Supabase schema and migration history for `admin_users`, `profiles`, all grants/RLS, current rows, all database functions/triggers, and every Edge Function/client consumer. Confirm whether `admin_users` was created outside the repository. No changes.
2. **Owner identity confirmation:** identify the owner's actual Supabase Auth UUID through a secure owner-controlled confirmation workflow. Do not infer it from a GitHub username, email address, display name or profile metadata. Define account recovery and compromise response before relying on this identity.
3. **Staging schema proposal:** add private canonical authority/current and append-only history tables in a new reviewed migration. Do not populate a production owner/admin row from assumptions.
4. **Single authorization adapter:** add a private SQL helper for RLS and a shared Edge Function authorization module that both read the canonical authority. Ensure former admins are rejected immediately.
5. **Compatibility bridge:** either replace legacy `admin_users` membership checks with the canonical adapter in every consumer, or provide a tightly controlled compatibility view backed by the canonical authority if all existing queries can safely use it. Do not keep independently writable copies. Reconcile `profiles.role` and remove its ability to grant administrator access; keep profile display/ordinary role semantics separate from privileged authority.
6. **Staging validation:** test all existing admin pages, audit entitlements, trust-badge approvals, support RLS, profile guards, dispute endpoints, and Edge Functions with owner, active admin, former admin, buyer, seller and anonymous identities. Include AAL1/AAL2, token refresh, concurrent replacement, replay, direct REST/RPC attempts and direct SQL privilege checks.
7. **Cutover:** only after successful staging review and explicit owner approval, switch every authorization consumer together. Keep a rollback plan that cannot accidentally restore former-admin access.
8. **Post-cutover verification:** query actual grants/policies and test former-admin denial, single-active-admin invariant and audit history. Run Supabase advisors and security tests.

## Do not do these things

- Do not update `profiles.role` to `admin` as the source of truth.
- Do not assume `admin_users` is safe or owner-controlled without inspecting its actual live DDL and grants.
- Do not let the current administrator appoint or delegate another administrator.
- Do not accept owner/admin IDs, role, generation, timestamps or approval booleans from the browser.
- Do not grant the administrator Safe signing authority or any way to bypass Safe threshold/Guard.
- Do not run migrations, edit production data, deploy Edge Functions, or change Auth settings as part of this review.

## Status

- The isolated TypeScript domain model and generation/replacement tests exist in the prototype branch.
- The latest code CI run for commit `74a9c573414f3efc44f850bc34f3dc025cdff62a` passed.
- The design document `docs/ADMIN-AUTHORITY-IMPLEMENTATION-PLAN-20261115.md` describes the target server architecture.
- This review identifies a material legacy authorization split that must be resolved before implementation.
- Live Supabase DDL, grants, migration history, and administrator rows remain unverified.
