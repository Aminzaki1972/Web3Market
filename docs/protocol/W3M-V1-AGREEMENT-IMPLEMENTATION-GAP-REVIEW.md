# W3M V1 Agreement — Implementation Gap Review

**Review target:** `feat/w3m-audit-fingerprint-binding-20261107` (PR #181)
**Review type:** Read-only source review. No production objects, secrets, deployments, live deals, or database records were changed.
**Purpose:** Compare the consolidated agreement draft with the current branch implementation before any live integration.

## Executive conclusion

The branch contains substantial V1 building blocks: canonical terms validation and hashing, terms publication/versioning RPC calls, EIP-712 challenge/acceptance handlers, immutable acceptance evidence, per-asset delivery evidence, a separate final-delivery confirmation, and server-side Safe/release gates.

However, the complete workflow is not yet ready to activate. The live Deal Room still uses the legacy timestamp acknowledgement when the rollout gate returns the legacy mode; when the gate reports V1, it currently displays a read-only notice that digital signing is disabled. The new agreement client and panel are separate modules and are not wired into the live Deal Room.

There is also a legacy-compatibility blocker: the branch's Safe deployment and release-preparation functions invoke V1 cryptographic finalization gates without an evident legacy/V1 mode branch. Existing legacy deals that have no V1 acceptance rows and evidence may therefore be blocked if these branch changes are deployed as-is. This must be resolved before merge/deployment while preserving the old-deal path.

## Verified alignment

### 1. Digital acceptance and immutable terms
- `supabase/functions/w3m-acquisition-verification/handler.ts` exposes authenticated actions for terms publication, status, preparation, and signature acceptance.
- `acquisition-terms.ts` validates the V1 schema, canonicalizes JSON deterministically, and computes a domain-separated SHA-256 hash.
- `20261107130000_w3m_v1_acceptance_ledger.sql` defines private append-only terms, audit-binding, challenge, and acceptance records.
- `_shared/w3m-v1-finalization-gate.ts` verifies the persisted buyer/seller acceptance pair against the same deal, audit fingerprint/binding, and current terms version/hash.
- The pure lifecycle helper defines sequential immutable version rules; it is not itself a database store.

### 2. Per-asset delivery and final confirmation
- `20261108110000_w3m_v1_asset_delivery_evidence.sql` defines append-only delivered/accepted/rejected event evidence and protects event rows against update/delete.
- The acquisition handler routes per-asset delivery, acceptance, and rejection through the server-side `w3m_transition_deal_asset_v1` RPC.
- `20261108150000_w3m_v1_final_delivery_confirmation.sql` defines a separate buyer final-confirmation record bound to the current terms version/hash and a digest of the accepted asset set.
- The shared finalization gate requires every included asset to have a latest delivery followed by buyer acceptance, and requires a non-stale final confirmation for the exact current terms and asset set.
- This matches the owner's approved distinction between asset-by-asset acceptance and a separate final confirmation.

### 3. Safe and release gates
- `create-safe/index.ts` invokes `assertW3MAgreementReady` before Safe deployment. This verifies the V1 cryptographic agreement pair and dispute state; it does not require delivery completion, which is appropriate if Safe creation is intended to precede asset handover.
- `prepare-deal-release/index.ts` invokes `assertW3MFinalizationReady` before release preparation. This requires the agreement pair, audit binding, all asset acceptances, final delivery confirmation, and then checks payment, dispute state, Safe, and release policy.
- No independent escrow smart contract is introduced by these reviewed paths; the settlement mechanism remains Safe multisig.

## Blocking gaps before live activation

### G1 — Live Deal Room is not connected to the V1 signing experience
**Evidence:** `js/deal-room.js` imports the legacy rollout gate, but its legacy branch still reads and upserts `deal_party_agreements.agreed_at`. When the gate returns `v1`, it renders a notice saying V1 digital signing is disabled. The new `js/w3m-deal-agreement-client.js` and `js/w3m-deal-agreement-panel.js` exist as isolated modules and are not imported by the live Deal Room.

**Required resolution:** Integrate the read-only canonical terms/status panel and the wallet signing client behind the V1 gate, with explicit buyer/seller role checks and server responses as the only authority. Do not treat the legacy timestamp as a V1 signature.

### G2 — Legacy deal compatibility at Safe and release gates
**Evidence:** `create-safe/index.ts` unconditionally calls `assertW3MAgreementReady`. `prepare-deal-release/index.ts` unconditionally calls `assertW3MFinalizationReady`. The former requires V1 acceptance evidence; the latter additionally requires per-asset acceptance and final delivery confirmation. No explicit legacy/V1 rollout-mode branch is present in these call sites.

**Risk:** Existing deals created before V1, with only legacy agreement timestamps and no V1 terms/acceptance/asset evidence, may be unable to deploy Safe or prepare release after this branch is deployed.

**Required resolution:** Define a trusted server-side deal rollout classification. For V1-classified deals, require the full V1 evidence gates. For pre-existing legacy deals, preserve their previously supported path under the legacy rules and clearly prevent that legacy path from being used to create new V1 deals. Do not infer the mode from client input or a client-visible label. Test both paths in an isolated environment before any production rollout.

### G3 — Safe settlement terminology in canonical terms
**Evidence:** `acquisition-terms.ts` currently requires a top-level `escrow` object with `funding_condition`, `release_condition`, and `dispute_hold=true`, while the product decision is Safe multisig settlement and explicitly excludes a separate escrow contract.

**Required resolution:** Before publishing canonical terms, make the schema wording unambiguous that funds are held and approved through the deal's Safe multisig workflow, not a separate escrow smart contract or unilateral Web3Market custody. Prefer a schema/property name that reflects Safe settlement, or explicitly define the existing field as Safe-only workflow conditions and update user-facing text consistently. Any schema change must be tested and included in the canonical version before publication.

### G4 — Commercial schedule fields are not all required by the canonical validator
**Evidence:** Article 7 and its Transaction Schedule include asking price and agreed discount, as well as final consideration, currency, platform fee, and seller net. The current validator requires final consideration amount/currency, exactly 7.5% fee, and seller net reconciliation, but it does not require named asking-price or discount fields.

**Required resolution:** Decide whether asking price and discount are contractual signed snapshot fields or only marketplace history. If they are part of the agreed transaction schedule, add explicit schema validation and trusted source mapping. If they are informational only, label them as such in the schedule. The final agreed consideration remains the sole basis for the 7.5% fee.

### G5 — Per-asset transfer details need a complete canonical representation
**Evidence:** The validator requires each included asset to have a type and description and requires a delivery checklist, but it does not currently require every asset to carry its own transfer method and expected evidence description as stated in the consolidated Article 3/9 wording.

**Required resolution:** Add the per-asset transfer method and expected evidence fields to the canonical terms schema and synchronization logic, or narrow the agreement wording to the exact fields the protocol will record. Do not publish a signed schedule that promises structured fields the protocol does not preserve.

### G6 — Final delivery confirmation UI integration
**Evidence:** The server action `confirm_delivery` and private confirmation RPCs exist. The agreement panel is a read-only renderer and exposes action hooks through options, but the reviewed live Deal Room does not wire the panel or buyer final-confirmation action.

**Required resolution:** Add a buyer-only final confirmation action after all included assets are accepted. The server must recompute and bind the accepted asset-set digest and current terms version/hash; the browser must not supply authoritative digests or bypass the server checks.

## Required test matrix before activation

1. New V1 deal: no signing until canonical terms and audit binding are published.
2. Buyer-only acceptance: Safe deployment remains blocked.
3. Seller-only acceptance: Safe deployment remains blocked.
4. Both parties sign different terms versions or hashes: blocked.
5. Both parties sign the same current terms and audit binding: agreement gate passes.
6. Safe deployment before delivery: permitted only after V1 agreement pair, deal eligibility, and Safe configuration checks.
7. Any included asset missing delivery or buyer acceptance: release preparation blocked.
8. Buyer final confirmation missing or stale after redelivery/terms change: release preparation blocked.
9. Open or unverifiable dispute state: Safe deployment/release preparation blocked.
10. Pre-V1 legacy deal: existing supported legacy path remains available and is not silently converted into V1 acceptance.
11. New deal cannot fall back to legacy timestamp acknowledgement once classified as V1.
12. Fee calculation: exactly 7.5% of final agreed consideration after discounts; seller net reconciles in the same currency and canonical rounding precision.
13. Safe workflow: no independent escrow contract and no unilateral platform release.
14. Failure, retry, replay, concurrent acceptance, redelivery, and dispute races are tested in isolation.

## Recommended implementation order

1. Resolve the legacy/V1 server-side rollout classification and compatibility behavior first.
2. Complete the canonical schema alignment for Safe settlement, commercial schedule fields, and per-asset transfer details.
3. Wire the V1 read-only panel and signing client into the live Deal Room behind the server-controlled V1 gate.
4. Wire the buyer final-delivery confirmation action.
5. Run the isolated end-to-end and adversarial test matrix.
6. Only after review and explicit approval, consider merge, migration, and production deployment.

**Safety status:** This review is documentation only. It does not change the live Deal Room, database, Edge Functions, Cloudflare, Safe configuration, or any existing deal.


## Production-schema read-only addendum — 2026-11-08

This addendum records a read-only inspection of the connected production Supabase schema. No SQL write, migration, data update, or deployment was performed.

### G2 — Additional verified database facts

- The production `public.deals` table has no `protocol_track`, `protocol_track_assigned_at`, or equivalent immutable classification field.
- RLS is enabled. The current authenticated INSERT policy requires a non-anonymous authenticated session and `buyer_id = auth.uid()`.
- A separate restrictive INSERT policy also requires the buyer and seller to differ, a positive deal amount, the fixed platform fee percentage, the expected multisig defaults, pending payment state, no pre-populated Safe/payment/release fields, and a seller matching the current owner of the referenced project.
- The production table has database triggers for fee locking/financial calculation, sensitive-field protection, state transitions, and deal lifecycle audit logging. Existing server and client paths depend on these controls.
- The current authenticated INSERT policy means the browser offer form is not merely a UI convenience: it is an authorized direct-insert path guarded by RLS and database triggers. Replacing it with a server-only creation path requires an explicit privilege/RLS compatibility design and regression coverage; it must not silently revoke the current offer workflow.
- The production schema currently has no durable server-side legacy/V1 classification. A missing V1 terms row therefore cannot be treated as a reliable legacy identity.

### G2 — Revised implementation requirements

1. Keep the current production INSERT policy and all deal triggers unchanged until a tested replacement is ready.
2. Add a durable, server-controlled protocol classification in an isolated migration. Prefer a private one-to-one registry or a protected column with column-level privilege analysis; do not trust a browser-supplied track value.
3. Ensure every deal INSERT receives `legacy` classification atomically by a database-side mechanism. Existing rows must be backfilled as `legacy` in the same reviewed migration.
4. Keep V1 deal creation disabled. When V1 creation is eventually enabled, only a service-role-only transactional creation path may promote the newly inserted deal to `v1` within the same transaction. The client must never choose or update this value.
5. Provide a server-side track lookup used by `create-safe`, `prepare-deal-release`, and the Deal Room status endpoint. Unknown, missing, duplicate, or unreadable classification must fail closed.
6. Dispatch gates by the authoritative track: legacy deals retain the previously supported legacy checks; V1 deals require the full V1 acceptance/finalization gates.
7. Add PostgreSQL tests for authenticated browser inserts, direct attempts to forge/change the track, backfill behavior, transactional V1 assignment, unknown-track behavior, and legacy/V1 Safe and release paths.

### Additional UI observation

The branch helper `js/w3m-deal-room-legacy-gate.js` currently treats a confirmed missing Edge Function / unsupported action, or a valid status response with `current_terms: null`, as permission to display the legacy agreement controls. This is a rollout UI signal, not a durable deal classification. It must be replaced with the authoritative server-returned `protocol_track` before V1 activation. The Safe and release Edge Functions must independently enforce the same server-side classification; the browser result is never an authorization decision.

### Scope boundary

This addendum is an implementation review only. Production inspection was read-only. No production data, schema, RLS policy, trigger, Edge Function, Safe, wallet, or transaction was changed. No migration or deployment is authorized by this addendum.


## Protocol-track registry implementation — 2026-11-08

The first isolated implementation slice is now present on the feature branch:

- Migration: `supabase/migrations/20261108180000_w3m_deal_protocol_track_registry.sql`.
- The migration locks `public.deals` while backfilling every existing row as `legacy` and installing an `AFTER INSERT` trigger. This prevents an insert from falling between the backfill and trigger installation.
- Every deal created through the current direct-insert path is assigned `legacy` by the database trigger. The browser does not supply the track.
- The registry is in `w3m_private`, with RLS and FORCE RLS enabled, and no direct table privileges for `anon`, `authenticated`, or `service_role`.
- Track updates/deletes are rejected by an immutable trigger.
- `public.w3m_get_deal_protocol_track(uuid)` is a service-role-only lookup RPC. Missing classification raises an explicit error; it does not fall back to legacy.
- PostgreSQL 16 regression test and a dedicated GitHub Actions workflow were added:
  - `tests/w3m-deal-protocol-track.sql`
  - `.github/workflows/w3m-deal-protocol-track-tests.yml`

### Deliberate limits of this slice

- This migration does **not** create a V1 assignment path. All current inserts remain legacy until a separate trusted, atomic V1 deal-creation transaction is implemented and tested.
- The shared track reader, acquisition status response, Deal Room browser gate, and all six Safe Edge paths now use authoritative server-side classification. V1-specific gates are conditional on an explicit v1 track; legacy checks remain in place.
- The registry migration and all branch changes remain isolated to the unmerged feature branch. The migration has not been applied to production or the live Supabase project.

**Current safety state:** no production migration, Edge Function deployment, Deal Room activation, Safe transaction, or PR merge was performed.


### Legacy acceptance write-path correction — 2026-11-08

A further read-only production-schema check established that `public.deal_party_agreements` has the unique key `(deal_id, party_role)`; `party_id` is a separate immutable identity field. Its database guard rejects changes to deal, role, party identity, or an already-recorded agreement timestamp.

The feature-branch Deal Room was attempting an upsert with conflict target `(deal_id, party_role, party_id)`, which does not match the production unique key. The branch code first corrected the conflict target, then moved to an insert-only acceptance write to avoid invoking the timestamp-immutability trigger on a duplicate race. A unique-violation response now reloads the row and treats it as success only when the authenticated party's existing agreement is already recorded. A regression assertion was added to `js/w3m-deal-room-legacy-gate.test.js`.

This is a source-level correction on the feature branch only. No production file or database object was changed. CI for the latest commit has not yet been confirmed.


### Protocol-track dispatch and legacy database guard review — 2026-11-08

The production deal_party_agreements schema was inspected read-only:

- RLS is enabled; FORCE RLS is not enabled.
- Authenticated users have SELECT, INSERT, and UPDATE table privileges. The anon role has no table grant in the inspected role-grant output; service_role has its normal broad table privileges.
- SELECT policy permits admins and the deal's buyer/seller (plus the row's own party ID).
- INSERT policy binds party_id to auth.uid() and requires party_role to match the caller's buyer/seller role on that deal.
- UPDATE has owner/participant restrictions in both permissive and restrictive policies.
- Unique index is exactly (deal_id, party_role); party_id is a separate immutable identity field.
- trg_prevent_deal_agreement_tampering prevents changing deal ID, role, party ID, removing an existing acceptance, or changing an existing agreed_at timestamp.
- An audit trigger records INSERT/UPDATE/DELETE activity.

The Deal Room legacy upsert target was corrected to the real unique key on the branch. The original identity and timestamp trigger remains unchanged. No production policies, grants, triggers, or table data were modified.

The six Safe paths now branch on the shared, service-role-only protocol-track reader. For legacy deals, only the new V1-specific acceptance/final-delivery gate is skipped; existing participant, dispute, payment, delivery, release-policy, Safe, chain, token, signature, and on-chain checks remain. An unknown track fails closed.

CI on 27f4c2dae743d69afd609ee8d9d6c65a4439c820: Deno suite and PostgreSQL registry, ledger, and asset-evidence tests passed; trust-badge, CDN SRI, and browser syntax checks passed. Supabase Edge integration, profile guard, and audit entitlement jobs were still in progress at the last check.


### CI verification correction — 2026-11-08

The first Edge integration attempt exposed a test-harness omission: its disposable Supabase setup had not applied the new protocol-track registry migration. The handler correctly failed closed because the lookup RPC was absent. The integration workflow now applies that migration before starting the Edge Function.

The local-only fixture then overrides the disposable database's deal-insert trigger for exactly one synthetic V1 test deal; every other inserted test deal remains legacy. This does not add or enable a production V1 creation path. The real Edge integration now verifies both paths:
- V1 fixture: authenticated buyer/seller status returns the explicit v1 track and full agreement state; the test continues through signing, asset delivery, buyer acceptance, final confirmation, and redelivery/reconfirmation.
- Legacy fixture: authenticated participant status returns legacy and does not load V1 terms or evidence.

Final verified CI batch for code commit a2e70035f2a7e7638be83a1fa250c0d818dfbc83:
- W3M Audit Fingerprint / handler / Safe source tests: 159 passed, 0 failed; Deno type-check passed.
- W3M V1 Supabase Edge Integration: passed against isolated local Supabase Auth, PostgREST, RPC, and the actual Edge Function.
- W3M Deal Protocol Track Registry PostgreSQL 16 tests: passed.
- W3M V1 Ledger PostgreSQL 16 migration/concurrency/privilege tests: passed.
- W3M V1 Asset Delivery Evidence PostgreSQL 16 tests: passed.
- Security remediation checks: passed (CDN SRI, browser JavaScript syntax, profile-guard migration).
- Isolated W3M trust badge checks: passed.
- W3M atomic free audit entitlement: all four jobs passed.

All listed jobs in this batch completed successfully. These results are isolated CI tests only; no production migration, Edge Function deployment, live Safe action, financial transfer, or PR merge occurred.


### Legacy acceptance duplicate-race hardening — 2026-11-08

The Deal Room now uses INSERT rather than UPSERT for a first-time legacy agreement acceptance. This avoids attempting to rewrite an immutable agreed_at timestamp when two browser sessions submit concurrently. If the database returns unique violation 23505, the client reloads the agreement and treats the operation as successful only if the same authenticated party already has a recorded agreed_at value. All other errors remain visible and the action stays retryable.

This matches the production INSERT RLS policy and immutable identity/timestamp trigger. No UPDATE, DELETE, RLS, trigger, or production database changes were made. Regression coverage is included in the existing Deno workflow.


### Final protocol-track and legacy-flow CI verification — 2026-11-08

The follow-up browser legacy-acceptance hardening is also verified on code commit 7dea807d4a288ff5c71648bc4622d5b4a4fe2bdd:

- W3M Audit Fingerprint / handler / Safe source tests: 159 passed, 0 failed; Deno type-check passed.
- W3M V1 Supabase Edge Integration: passed with the registry migration applied in isolated local Supabase. The test exercised a synthetic V1 deal and a separate legacy deal; the test-only V1 fixture override exists only in the disposable CI database.
- W3M Deal Protocol Track Registry PostgreSQL 16 tests: passed.
- W3M V1 Ledger PostgreSQL 16 migration/concurrency/privilege tests: passed.
- W3M V1 Asset Delivery Evidence PostgreSQL 16 tests: passed.
- Security remediation (CDN SRI, JavaScript syntax, profile guard): passed.
- Isolated W3M trust badge checks: passed.
- W3M atomic free audit entitlement: all jobs passed.

The live Deal Room legacy acceptance now uses INSERT-only writes. On a duplicate-key race, it reloads and confirms the same party's existing accepted row before treating the result as success. This avoids updating an immutable acceptance timestamp.

A separate architecture proposal, docs/protocol/W3M-V1-TRUSTED-DEAL-CREATION-DESIGN.md, documents the future atomic V1 creation boundary. It is design-only: no V1 creation RPC or Edge Function was added, no browser INSERT privilege was revoked, and current offer creation remains legacy.

These checks are branch CI only. No production migration, deployment, Safe transaction, financial transfer, or PR merge occurred.
