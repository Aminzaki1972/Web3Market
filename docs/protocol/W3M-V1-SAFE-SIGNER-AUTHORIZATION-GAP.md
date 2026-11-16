# W3M V1 Safe Multisig — Signer Authorization Gap
**Review date:** 2026-11-11  
**Target branch:** `feat/w3m-audit-fingerprint-binding-20261107` (PR #181)  
**Review type:** Read-only source inspection; this document records findings only.

## Finding S1 — Platform Safe owner cannot submit a release signature through the current endpoint

Inspected:
- `supabase/functions/record-safe-release-signature/index.ts`
- `supabase/functions/execute-safe-release/index.ts`

The signature endpoint first authorizes only the deal buyer or seller by comparing the authenticated user ID with `deal.buyer_id` and `deal.seller_id`. It then assigns the signer role using only `buyer` or `seller`, and upserts on `deal_id,signer_role`. Therefore, even if the platform wallet is correctly configured as the third Safe owner, the platform owner has no supported signer identity/role through this endpoint and cannot contribute the third-owner signature.

The execution endpoint requires at least two stored signatures and checks that every stored signer address is a current Safe owner. It does not require the signer set to include the platform owner, which is acceptable only if any two of the three verified owners are intentionally permitted. The current recording endpoint nevertheless restricts the supported signers to buyer and seller, so the implemented workflow is not the full approved three-owner authorization model.

**Required correction before V1 activation:** define an authenticated, auditable platform-owner signer identity and authorization path; permit exactly the configured Safe owners to sign; bind each signature to the current Safe transaction hash and current owner set; prevent duplicate/stale signer records; and count valid distinct current owners against the on-chain threshold. Do not grant a platform service role the ability to fabricate an owner signature.

## Finding S2 — Threshold is read from Safe but then hard-coded to two

Both inspected functions read `getThreshold()` from the Safe. The signature endpoint rejects any threshold other than 2. The execution endpoint also rejects any threshold other than 2, and reports `required_signatures: 2`. Execution additionally requires exactly three owners and checks the configured buyer, seller, and platform owner addresses.

The approved configuration is **2-of-3 by default**, while the security rule requires checking the actual on-chain owner set and threshold dynamically. A fixed 2-of-3 check does not implement that dynamic rule and will reject any valid, explicitly approved Safe configuration with a different threshold/owner count. Conversely, simply removing the fixed checks would be unsafe unless the configured V1 policy and owner identities are validated explicitly.

**Required correction before V1 activation:** compare the on-chain owners and threshold against the deal's immutable approved Safe policy; use the verified on-chain threshold as the minimum number of distinct valid signatures; reject duplicate owners, stale owner snapshots, changed nonce, and signatures not matching the Safe transaction hash. Keep 2-of-3 as the default policy, not an unexplained magic number.

## Required regression tests

1. Buyer + seller signatures satisfy the default 2-of-3 policy.
2. Buyer + platform signatures satisfy the default 2-of-3 policy.
3. Seller + platform signatures satisfy the default 2-of-3 policy.
4. A non-owner cannot record a signature.
5. A platform signer can act only through the explicitly authorized platform-owner identity and verified wallet.
6. Duplicate signatures from one owner count once.
7. A signer removed from the current Safe owner set is rejected.
8. A changed Safe nonce or transaction hash invalidates prior signatures.
9. Threshold changes are handled from the current on-chain threshold and approved policy; unsupported policy changes fail closed.
10. Execution never proceeds with fewer distinct valid owner signatures than the current threshold.

## Status and safety

This is a source-level finding on the isolated feature branch. No code, database, Safe configuration, key, deployment, live deal, or funds were changed. The release path remains blocked from V1 activation until the signer authorization model, buyer refund path, agreement activation, and trusted V1 deal creation are completed and tested. No independent escrow contract is introduced or permitted.
