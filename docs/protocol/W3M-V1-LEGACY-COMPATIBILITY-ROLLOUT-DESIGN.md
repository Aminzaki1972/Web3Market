# W3M V1 — Legacy Compatibility and Rollout Classification Design

**Status:** Design proposal for isolated implementation and review. Not a migration and not deployed.
**Scope:** PR #181 feature branch. Protect pre-V1 deals while ensuring new V1 deals cannot fall back to timestamp-only acceptance.

## Problem

The current branch calls the V1 cryptographic agreement gate unconditionally from Safe deployment and calls the V1 full-finalization gate unconditionally from release preparation. Those gates require V1 acceptance evidence (and, for release, per-asset delivery evidence plus buyer final confirmation).

Pre-V1 deals may have only legacy `deal_party_agreements.agreed_at` rows. They do not automatically have a V1 canonical terms version, audit fingerprint binding, EIP-712 acceptance pair, asset evidence ledger, or final-delivery confirmation. Deploying the unconditional V1 gates can strand these older deals.

Conversely, allowing a missing V1 record to mean “legacy” forever would let a newly created deal fall back to the old timestamp flow. That is not acceptable.

## Required invariant

A deal is assigned exactly one protocol track by trusted server-side logic:

- `legacy`: deal was created before V1 activation, or was explicitly created under the legacy track before the V1 cutover.
- `v1`: deal was created through the V1-enabled server path and is permanently subject to V1 canonical terms, EIP-712 acceptance, audit binding, asset evidence, and final confirmation gates.

The browser must never choose or change the track. A missing terms row, client parameter, mutable deal status, or legacy timestamp must never be sufficient to classify a deal as legacy.

## Proposed data model

Add an immutable protocol-track field to the deal record or to a private one-to-one deal protocol registry:

- `protocol_track`: constrained to `legacy` or `v1`.
- `protocol_track_assigned_at`: server timestamp.
- `protocol_track_source`: trusted creation path / rollout policy identifier.
- Optional immutable `protocol_track_reason` for audit diagnostics.

Backfill every existing deal to `legacy` in a reviewed migration. New deals remain `legacy` only while the V1 creation feature is disabled. Once V1 creation is activated, the trusted deal-creation transaction assigns `v1` at creation. Do not infer a track from timestamps alone after cutover.

The track must be immutable after creation. If the current deal-creation flow cannot assign it atomically, use a private registry written in the same transaction as deal creation. Do not add a client-writable column to `deals`.

## Gate behavior

### Safe deployment
- `v1`: require the V1 buyer/seller acceptance pair bound to the current canonical terms hash, current audit fingerprint binding, verified participant wallets, eligible deal status, valid Safe configuration, and a clear/verifiable dispute state.
- `legacy`: preserve only the exact previously supported legacy agreement requirements for that deal. Do not require V1 acceptance or asset-finalization records that did not exist when it was created.
- Unknown, missing, conflicting, or unreadable track: fail closed; do not deploy Safe.

Safe creation is allowed before asset delivery where the existing V1 workflow intends that ordering. It must not bypass agreement acceptance.

### Release preparation
- `v1`: require the complete V1 finalization gate, including both signatures, audit binding, each included asset delivered and accepted by the buyer, current final-delivery confirmation, payment verification, no open/unverifiable dispute, and verified Safe release conditions.
- `legacy`: preserve the previously supported legacy release rules for that deal only, with the existing Safe and payment checks. Never silently add V1 requirements to old deals or remove their existing protections.
- Unknown, missing, conflicting, or unreadable track: fail closed.

### Deal Room UI
- The server status response returns the authoritative track.
- `v1`: render the V1 canonical terms, signing, asset evidence, and final-confirmation controls. Never show legacy timestamp acceptance as a valid alternative.
- `legacy`: render the existing legacy flow and label it as a legacy agreement for that existing deal.
- Unknown/error: block agreement actions and show a neutral verification error.

## Migration and rollout sequence

1. Inspect all deal-creation paths, existing deal statuses, and current legacy Safe/release behavior in an isolated environment.
2. Add the immutable track registry/field and server-only assignment mechanism. Backfill existing deals as `legacy`.
3. Add tests proving authenticated browser users cannot assign or mutate the track.
4. Add server-side gate dispatch based only on the authoritative track.
5. Keep V1 creation disabled until the complete agreement UI, canonical schema, signature flow, delivery evidence, final confirmation, and isolated integration tests are ready.
6. Enable V1 assignment only in the trusted deal-creation path after explicit product-owner release approval.
7. Test legacy and V1 Safe deployment and release paths independently, including unknown-track and missing-record fail-closed behavior.
8. Deploy only after review, explicit approval, and a production backup/rollback plan.

## Mandatory regression tests

- Existing deal backfilled as `legacy` continues through the supported legacy path.
- Existing deal cannot be reclassified as `v1` by buyer, seller, or browser client.
- New deal while V1 creation is disabled receives the approved pre-cutover track and does not accidentally acquire V1 behavior.
- New deal after V1 activation is assigned `v1` atomically at creation.
- A V1 deal with no published terms, no audit binding, one signature, mismatched signatures, stale terms, or invalid wallet is blocked.
- A V1 deal cannot use `deal_party_agreements.agreed_at` to satisfy the V1 gate.
- A legacy deal cannot use an absent V1 row to bypass its legacy agreement or Safe/payment requirements.
- Unknown or unavailable protocol track blocks Safe deployment and release.
- Legacy release does not require new V1 asset evidence; V1 release always does.
- V1 release blocks for any unaccepted asset, stale final confirmation, unresolved rejection, open dispute, or unverified payment.
- Concurrent Safe creation, dispute opening, and release claims remain serialized by the existing atomic claim controls.

## Non-goals and safety

- This design does not authorize a new escrow contract. Safe Wallet remains the V1 multisignature settlement mechanism.
- It does not alter the 7.5% success fee or its basis: final agreed consideration after discounts.
- It does not change legal terms or select governing law, arbitration, or remedies.
- It does not apply a migration, update production data, deploy Edge Functions, or activate V1.
- Do not delete legacy acceptance records or remove the legacy UI until all legacy deals are settled and a separate migration/retention plan is approved.


## Implementation update — 2026-11-08

The first compatibility slice is now implemented on the isolated feature branch:

- w3m_private.w3m_deal_protocol_tracks stores one immutable server-owned classification per deal.
- Existing deals are backfilled as legacy; all current browser inserts are assigned legacy by the database trigger.
- The service-role-only w3m_get_deal_protocol_track(uuid) RPC is read by the shared Edge helper supabase/functions/_shared/w3m-deal-protocol-track.ts.
- The helper validates the deal ID, returned deal ID, track, assignment source, and assignment timestamp. Any RPC error, missing row, malformed row, or inconsistent source fails closed.
- The acquisition status action now returns protocol_track explicitly. For a legacy deal it returns the classification without querying V1 terms, signatures, asset evidence, or final delivery confirmation. For a v1 deal it continues to load and validate the complete V1 status.
- The Deal Room browser gate now enables legacy acceptance only when the authenticated status response explicitly says protocol_track: legacy. Missing/unsupported routes, absent terms, malformed payloads, and all non-200 responses are blocked.
- All six Safe Edge paths now read the authoritative track before proceeding: create-safe, prepare-deal-release, prepare-safe-release-tx, record-safe-release-signature, execute-safe-release, and finalize-safe-release.
- The V1 signature/finalization gate runs only for v1 deals. Legacy deals skip only the newly introduced V1-specific acceptance/asset-evidence gate; their existing endpoint checks for participant authorization, dispute state, funded lifecycle, payment confirmation, buyer-approved delivery, locked release policy, Safe/token/chain binding, signatures, and on-chain settlement remain in place.
- Unknown or unreadable track blocks all six paths. No client-supplied value can choose or upgrade the track.

The current CI batch on commit 27f4c2dae743d69afd609ee8d9d6c65a4439c820 has confirmed the Deno audit/handler suite, PostgreSQL 16 protocol-track registry tests, PostgreSQL 16 V1 ledger tests, PostgreSQL 16 asset-evidence tests, trust-badge tests, CDN integrity checks, and browser JavaScript syntax checks. The isolated Supabase Edge integration, profile-guard migration, and atomic audit-entitlement workflows were still running at the last status check; do not treat this batch as fully green until all are complete.

This remains branch-only. No production migration, Edge Function deployment, live Safe action, financial transfer, or PR merge occurred.
