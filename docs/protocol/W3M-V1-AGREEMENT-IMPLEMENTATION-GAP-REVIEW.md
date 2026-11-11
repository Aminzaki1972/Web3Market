# W3M V1 Agreement — Implementation Gap Review

**Review target:** `feat/w3m-audit-fingerprint-binding-20261107` (PR #181)
**Review type:** Read-only source review. No production objects, secrets, deployments, live deals, or database records were changed.
**Purpose:** Compare the consolidated agreement draft with the current branch implementation before any live integration.

## Executive conclusion

The branch contains canonical terms validation and hashing, terms publication/versioning RPC calls, EIP-712 challenge/acceptance handlers, immutable acceptance evidence, per-asset delivery evidence, a separate final-delivery confirmation, and server-side Safe/release gates. The live Deal Room now loads authoritative protocol status, renders canonical terms/hash and per-asset evidence, wires seller delivery and buyer per-asset acceptance/rejection, and wires the buyer's separate final-delivery confirmation.

The complete workflow is not yet ready to activate. The Deal Room intentionally keeps digital signing disabled pending final legal and commercial approval of the agreement text and canonical schedule. The verified-wallet EIP-712 signing adapter and agreement prepare/sign/accept client exist, but must remain gated until that approval and final activation review. V1 deal creation also remains disabled; current offer creation is classified legacy.

Legacy compatibility has been addressed on the feature branch: server-authoritative protocol classification dispatches Safe and release checks to V1 gates only for explicitly V1-classified deals, preserves legacy checks for legacy deals, and fails closed for unknown classifications. Historical completed-release retries are constrained to read-only verification of the exact already-recorded transaction. These changes remain isolated to the unmerged branch and require current CI completion before any deployment.

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

### G1 — Live Deal Room signing activation remains gated

**Current branch state:** `deal-room.html` imports `js/w3m-deal-agreement-client.js` and `js/w3m-deal-agreement-panel.js` for authoritative V1 status. The live panel renders canonical terms/hash, buyer/seller acceptance state, and per-asset evidence. It wires seller delivery registration, buyer asset acceptance/rejection, and the separate final-delivery confirmation. `js/wallet-manager.js` contains a strict verified-wallet EIP-712 signing adapter, and the agreement client contains the prepare/sign/accept flow.

**Remaining activation gate:** The live Deal Room deliberately does not expose or invoke the signing action yet. It continues to show a disabled-signing notice until agreement wording, jurisdiction/dispute inputs, and the canonical schedule receive final legal and commercial approval and an explicit activation review. Legacy timestamp acknowledgement is never treated as a V1 signature.

### G2 — Legacy deal compatibility at Safe and release gates

**Resolution on the feature branch (not deployed):** The private immutable protocol-track registry backfills existing deals as legacy and classifies current browser-created deals as legacy at insert time. A trusted service-role-only lookup is authoritative. The Deal Room status endpoint and all six Safe/release Edge paths dispatch by this track: explicit V1 deals require V1 evidence gates, legacy deals retain their previous checks, and unknown/missing classifications fail closed. V1 creation remains disabled; the future trusted atomic creation path is design-only. PostgreSQL tests cover backfill, inserts, immutability, permissions, RLS, and fail-closed behavior. The Safe historical-completion retry is read-only and only accepts the exact already-recorded transaction hash.

**Safety note:** These changes are isolated to PR #181. They have not been applied to production; current isolated CI must pass before merge/deployment.

### G3 — Safe settlement terminology in canonical terms
**Evidence:** `acquisition-terms.ts` currently requires a top-level `escrow` object with `funding_condition`, `release_condition`, and `dispute_hold=true`, while the product decision is Safe multisig settlement and explicitly excludes a separate escrow contract.

**Resolution on the feature branch (not deployed):** The canonical validator now requires `safe_settlement` with `method: "safe_multisig"`, funding/release conditions, and a dispute hold. It explicitly rejects the ambiguous legacy `escrow` property and any separate-contract method. This matches Article 8 and the Transaction Schedule's Safe Wallet-only wording. Regression tests cover the required method, missing/legacy field, and placeholder conditions. No canonical terms have been published or signed; the final schema/hash still requires review before activation.

### G4 — Commercial schedule fields are not all required by the canonical validator
**Evidence:** Article 7 and its Transaction Schedule include asking price and agreed discount, as well as final consideration, currency, platform fee, and seller net. The current validator requires final consideration amount/currency, exactly 7.5% fee, and seller net reconciliation, but it does not require named asking-price or discount fields.

**Resolution on the feature branch (not deployed):** Canonical terms now require a signed commercial snapshot containing the seller asking price and an optional agreed fixed-amount discount, both in the deal currency. These are historical schedule inputs; they do not calculate or override the independently agreed final consideration. The final consideration remains the sole basis for the 7.5% platform fee. Regression tests cover missing fields, currency mismatch, optional no-discount, and a negotiated final price that differs from the simple asking-price-minus-discount arithmetic. No sample monetary values are added to the agreement text.

### G5 — Per-asset transfer details need a complete canonical representation
**Evidence:** The validator requires each included asset to have a type and description and requires a delivery checklist, but it does not currently require every asset to carry its own transfer method and expected evidence description as stated in the consolidated Article 3/9 wording.

**Resolution on the feature branch (not deployed):** Each canonical included asset now requires its own transfer method, responsible party, and expected-evidence description in addition to type and description. These fields are part of the immutable canonical terms JSON and therefore are covered by the agreement hash and both parties' signatures. The existing asset checklist sync continues to derive one delivery item per signed included asset; delivery events record the actual handover evidence separately. Regression tests reject missing or placeholder per-asset fields. No production schema or data was changed.

### G6 — Final delivery confirmation UI integration

**Resolution on the feature branch (not deployed):** The live Deal Room panel exposes final confirmation only to the buyer, only after both parties accepted the current terms and every included asset is accepted. The callback invokes the server `confirm_delivery` action; the server recomputes and binds the accepted asset-set digest and current terms version/hash. The browser does not supply authoritative digests. UI and client regression tests exist; isolated Edge integration remains part of current CI verification.

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


---

## Re-verification addendum — 2026-11-11

**Reviewed branch head:** `1dcced7a2a671fb0a5f68cfc2395e6d9f2e65408`  
**Review mode:** read-only source inspection plus review of the completed GitHub Actions runs associated with this branch. This addendum changes documentation only; it does not activate V1 or authorize deployment.

### Confirmed Deal Room wiring boundary

- `deal-room.html` imports the read-only agreement status client and panel. The panel displays published canonical terms/hash, party acceptance state, per-asset delivery history, seller delivery registration, buyer per-asset accept/reject, and buyer final-delivery confirmation.
- The live Deal Room does **not** invoke `signAndSubmitW3MDealAgreement`. The EIP-712 prepare/sign/accept coordinator exists in `js/w3m-deal-agreement-client.js`, but the page's legacy-gate path deliberately renders a disabled-signing notice for an explicitly V1-classified deal until legal/commercial approval and activation review.
- Legacy timestamp acceptance remains confined to the server-classified legacy path. A missing, malformed, unavailable, or unknown protocol-track response is blocked; the browser helper does not choose the track itself.
- The browser status/panel integration is therefore partial and intentionally gated, not a completed live V1 signing journey.

### Protocol-track and deal-creation boundary

- The isolated registry migration backfills existing deals as `legacy` and assigns `legacy` to every ordinary browser-created deal through a database trigger.
- The migration contains no trusted V1 creation transaction. V1 deal creation remains disabled; a future trusted atomic creation path is still a separate implementation requirement.
- The server-side track lookup is service-role-only, and missing classification fails closed. This protects the rollout boundary without silently treating an unknown deal as legacy.

### Rechecked CI evidence

The completed branch runs inspected on 2026-11-11 report:

- Acquisition/fingerprint and related browser/server regression suite: **164 passed, 0 failed**; Deno type-check passed.
- Safe policy/authenticity suite: **57 passed, 0 failed**; Deno type-check passed; BNB Testnet read-only check passed.
- Local Supabase Edge integration: passed with isolated Auth, PostgREST, RPC, and the actual Edge Function process. The job log explicitly reports Auth, audit binding, terms publication, private RPC, EIP-712 acceptance, replay rejection, participant authorization, and per-asset delivery/acceptance.
- PostgreSQL 16 migration/concurrency/privilege checks and the protocol-track and asset-evidence jobs in the associated CI batch were reported successful in the branch review record.
- These are CI/disposable-environment results. They do not establish production migration, production Edge deployment, live wallet signing, Safe deployment, or an on-chain deal settlement.

### Remaining V1 release blockers — unchanged

1. Final legal/commercial approval of the consolidated acquisition agreement and deal-specific schedule, including the still-unresolved jurisdiction and dispute inputs. No missing legal terms are invented here.
2. A reviewed and tested Deal Room EIP-712 signing activation that uses the current verified wallet and server-issued challenge, and that cannot fall back to timestamp consent for V1 deals.
3. Trusted atomic V1 deal creation, with all existing browser-created deals remaining legacy until that path is separately implemented and tested.
4. A complete isolated end-to-end acceptance run that proves the full sequence, including final delivery confirmation, dispute/release serialization, exact Safe settlement evidence, and recovery behavior.
5. Deliberate review of the large stacked PR history/diff before any merge consideration.

**Safety boundary:** PR #181 remains a draft and unmerged. No production migration, Edge Function deployment, Cloudflare change, Safe deployment, wallet signature, transaction, or funds movement was performed. No independent escrow contract is introduced; settlement remains Safe-only. No V2 work is included.
