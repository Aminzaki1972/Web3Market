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
