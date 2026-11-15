# Web3Market — Owner-Controlled Administrator Authority (Sandbox Design)

Date: 2026-11-15  
Scope: isolated prototype branch only. No production database, Supabase Auth, RLS, Edge Function, Cloudflare, or account settings were changed.

## Approved policy

- Exactly one active Deal Management administrator exists at a time.
- The product owner alone appoints the initial administrator and explicitly approves every replacement.
- The administrator cannot appoint, invite, promote, delegate, or replace another administrator.
- Buyer/seller accounts cannot access administrator workspaces or privileged dispute actions.
- The previous administrator loses privileged access atomically when a replacement takes effect.
- The administrator may decide dispute outcomes and financial allocations, but cannot sign, bypass Safe permissions/threshold/Guard, or certify chain execution.
- Owner approval must be authenticated and recorded. A client-supplied owner ID, role, approval flag, or timestamp is never trusted.

## Sandbox model added

Files:
- `prototype/deal-management/admin-authority.ts`
- `prototype/deal-management/admin-authority.test.ts`

The pure model now:
- requires the authenticated owner identity to match the designated owner for appointment/replacement;
- rejects owner-as-admin, blank IDs/references, same-admin replacement, invalid or backward timestamps;
- increments an authority generation for each replacement;
- requires the caller's expected generation to match the current generation (compare-and-swap) to reject stale/replayed replacement attempts;
- creates an immutable replacement event naming the previous administrator, new administrator, generation, approval reference and timestamp.

This is a domain model only. It does not authenticate a Supabase user, persist state, prevent concurrent production requests, or create a cryptographically tamper-evident audit log.

## Required production architecture — not implemented

1. **Owner identity and recovery**
   - Resolve the owner from a protected server-side owner record, not user metadata or request JSON.
   - Require a fresh authenticated session and a step-up/re-authentication ceremony for appointment/replacement.
   - Define a recovery process for owner account compromise/loss before production launch. No recovery authority is inferred here.

2. **Single source of truth**
   - Store exactly one current authority row in a private, non-client-writable schema/table.
   - Store appointment/replacement events in a separate append-only authority history.
   - Deny direct INSERT/UPDATE/DELETE to anon/authenticated clients.
   - Do not expose service-role credentials to browsers.
   - Enforce one-current-admin structurally and transactionally, not only in UI or TypeScript.

3. **Atomic replacement**
   - Server command verifies the current owner session, expected generation, existing active administrator and target account.
   - In one database transaction: append the owner-approved event, replace the current administrator, increment generation, and revoke the old administrator's active authority.
   - Concurrent or stale requests fail closed; no intermediate state with two active administrators.
   - Idempotency key and unique generation prevent replay/duplicate replacement.

4. **Every privileged request**
   - Edge Function verifies the bearer token with Supabase Auth `getUser(token)`.
   - Loads the current authority from trusted server-side storage on every privileged operation; never trusts role claims from `user_metadata`, browser payloads, or cached UI state.
   - Checks current admin ID and current generation. Former admins are denied immediately after replacement.
   - Re-checks authority within the transaction for writes to prevent time-of-check/time-of-use races.
   - AAL2/step-up authentication is required for sensitive owner and financial-adjudication actions.

5. **Audit and privacy**
   - Authority events include owner actor ID, previous/new admin IDs, generation, timestamp assigned server-side, approval reference, reason, request correlation ID and outcome.
   - Append-only to application roles; no silent update/delete.
   - Do not store raw access tokens, recovery secrets, or unnecessary identity data.
   - Admin workspace reads and each privileged action are separately audited.

6. **Separation from Safe**
   - Admin authority permits only review/decision workflows.
   - It does not grant Safe ownership, signatures, threshold bypass, Guard bypass, or direct fund movement.
   - All transfers require the configured Safe permissions and independent on-chain execution verification.

## Acceptance tests required before production

- No owner or admin identity may be self-promoted from an ordinary client request.
- A non-owner cannot appoint or replace the administrator.
- Current administrator cannot appoint/delegate/replace another administrator.
- Exactly one active administrator remains throughout replacement.
- Former administrator is denied immediately after successful replacement.
- Stale generation, replay, concurrent replacement, duplicate idempotency key, and target=owner/current-admin all fail safely.
- Buyer/seller cannot read admin workspace or execute admin-only dispute actions.
- Admin cannot impersonate buyer/seller.
- Owner approval, replacement, revocation and each privileged action produce server-timestamped immutable audit events.
- Owner account recovery and compromise response are tested.
- No admin action can sign or bypass Safe transactions.

## Explicit exclusions / unresolved before production

- No owner account ID, admin account ID, email, or credential is specified by this design.
- No owner recovery delegate or emergency override is invented.
- No production migration, RLS policy, Edge Function, Auth setting, or deployment was created.
- The existing generic `admin_users` list and `admin-review` function are not automatically made the authority source by this prototype. They require a separately reviewed migration and compatibility plan before adoption.
