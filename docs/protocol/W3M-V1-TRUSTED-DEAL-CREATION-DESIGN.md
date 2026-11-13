# W3M V1 — Trusted Deal Creation Design

**Status:** Architecture proposal only. Not implemented, not enabled, and not a legal or commercial approval.
**Scope:** Future V1 deal creation after canonical acquisition terms, browser signing, delivery workflow, and rollout are approved.

## Current production path

The current offer form in js/offer-form-fix.js:

1. Authenticates the buyer with Supabase Auth.
2. Loads the project and verifies it is not sold and is not owned by the buyer.
3. Loads profiles.role and requires the buyer role.
4. Checks for an existing active deal for the same buyer/project.
5. Inserts directly into public.deals from the browser.
6. Optionally inserts the buyer's message into deal_messages.

Production RLS and database triggers currently constrain this direct INSERT. The branch-only protocol-track registry migration adds an AFTER INSERT trigger that assigns all existing browser/service inserts to legacy unless a future trusted V1 creation context is introduced. Therefore the existing offer form remains a legacy creation path after that migration is deployed.

Do not revoke the current authenticated INSERT privilege or redirect the offer form until a tested replacement exists. The existing insert path must remain available to create legacy deals during a staged rollout.

## Required invariant

A new V1 deal must be created with its immutable V1 protocol track in the same database transaction as the deal row. There must never be a committed deal row with a missing track, and there must never be a browser-controlled way to select v1.

All current browser INSERTs continue to receive legacy automatically. No client parameter, metadata field, terms-row presence, or timestamp may upgrade an existing deal.

## Proposed architecture

### 1. Authenticated Edge Function boundary

Create a dedicated V1 creation endpoint only after product-owner release approval.

The endpoint must:
- Authenticate the caller using the bearer token and Supabase Auth getUser.
- Derive the buyer identity from the authenticated user, not from a browser-supplied buyer ID.
- Read profiles.role from trusted database state; do not authorize using user_metadata.
- Load the target project and verify the seller/owner, project state, and buyer/seller distinction.
- Validate the submitted offer payload against the existing deal constraints and the fixed fee policy.
- Check for an existing active buyer/project deal while holding a transaction-scoped lock in the database.
- Never accept protocol_track or assignment_source from the browser.
- Never expose the service-role key to the browser.

### 2. Atomic database creation RPC

Use a narrowly scoped service-role-only SECURITY DEFINER RPC, owned by a trusted database role, to create the deal and its protocol assignment atomically.

The RPC must:
- Accept only the minimum validated deal fields and authenticated buyer identity supplied by the Edge Function.
- Re-check buyer/project ownership and all invariants that can be checked inside the database.
- Serialize the active buyer/project check and insert so concurrent offers cannot create duplicate active deals.
- Establish a transaction-local V1 creation context that only this RPC can use.
- Insert the deal row; the protocol-track insert trigger must assign v1 with assignment_source trusted_v1_creation only when that internal transaction context is valid.
- Return the newly created deal ID and protocol track.
- Roll back the deal row and track assignment together on any failure.

The transaction-local context must not be accepted from PostgREST request parameters or user metadata. The trigger must continue assigning legacy to every ordinary INSERT, including direct authenticated browser inserts and service-role inserts that do not originate from the trusted V1 creation RPC.

The exact internal context mechanism requires a dedicated security review and PostgreSQL regression tests before implementation. A plain client-settable custom setting is not sufficient evidence of trusted V1 creation.

### 3. Existing legacy offer path

Until V1 creation is explicitly enabled:
- js/offer-form-fix.js continues its existing authenticated direct INSERT.
- The registry trigger assigns legacy.
- Legacy acceptance continues through the existing Deal Room path.
- Legacy Safe deployment/release keeps the original checks and does not require V1 acceptance or per-asset finalization records.
- Unknown protocol track remains fail-closed.

After a future V1 cutover, the browser offer form may choose a V1-specific Edge Function only through a server-controlled feature rollout. It must not choose the track itself. The legacy route must remain available for already-started legacy deals and any explicitly retained legacy creation cohort.

## Transaction and security requirements

- Deal row and protocol-track row are committed or rolled back together.
- The immutable registry cannot be updated or deleted by browser roles.
- Existing deals cannot be reclassified from legacy to v1.
- The only v1 assignment source is trusted_v1_creation.
- RPC EXECUTE is revoked from PUBLIC, anon, and authenticated and granted only to service_role.
- The Edge Function authenticates the user before calling the RPC and passes the buyer identity it derived from that session.
- The database revalidates project owner, buyer/seller distinction, project eligibility, active-deal uniqueness, positive offer value, currency consistency, and all existing deals constraints.
- No new Safe, payment, or release action occurs during offer creation.
- Failure to read or assign protocol track aborts the complete transaction.

## Required regression and integration tests

1. Existing deals are backfilled to legacy.
2. Existing browser offer INSERT still succeeds under its current RLS/trigger rules and is classified legacy.
3. A service-role direct INSERT without the trusted V1 context is classified legacy.
4. A valid authenticated V1 creation request creates exactly one deal and one v1 registry row atomically.
5. A browser cannot pass protocol_track=v1 or assignment_source=trusted_v1_creation to the current direct INSERT path.
6. An authenticated non-buyer cannot create an offer.
7. A buyer cannot create an offer for their own project.
8. A buyer cannot create an offer for a sold/ineligible project.
9. A concurrent pair of requests for the same active buyer/project cannot create duplicate active deals.
10. An RPC failure rolls back both deal and registry state.
11. The V1 creation RPC cannot be called by anon or authenticated roles directly.
12. An existing legacy deal cannot be promoted to V1.
13. Unknown/missing track blocks all Safe deployment and release paths.
14. The complete local Supabase Edge integration covers Auth, PostgREST, RPC, and the V1 creation handler.

## Activation prerequisites

Do not implement or enable the V1 creation RPC until all of the following are true:
- Canonical W3M V1 agreement terms have received the required final legal and commercial approval.
- The Deal Room V1 acceptance UI and signing flow are fully connected and tested.
- Per-asset delivery and buyer final-confirmation UI are connected and tested.
- All six Safe endpoints have verified protocol-track dispatch and legacy regression coverage.
- The isolated integration suite proves the entire creation-to-finalization path without real funds.
- Product owner explicitly approves the V1 creation cutover.

## Non-goals

- No production RLS revocation or browser insert cutover in this design.
- No independent escrow contract; Safe Wallet remains the only settlement mechanism.
- No change to the approved platform success-fee policy.
- No invented legal terms, governing law, arbitration, remedies, or financial examples.
- No production migration, Edge Function deployment, Safe transaction, or financial transfer.
