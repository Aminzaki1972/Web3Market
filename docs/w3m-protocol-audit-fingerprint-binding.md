# W3M Protocol — Immutable Audit Fingerprint Binding

Status: implementation specification on an isolated feature branch. This document does not represent a deployed or production-enabled capability.

## 1. Objective

Bind each acquisition agreement to one immutable, completed technical-audit snapshot. The snapshot must remain independently verifiable even when later audits are run or the source repository changes.

The final acquisition-verification report is a separate artifact. It may be issued only after the buyer and seller have accepted the same fingerprint and all other required protocol checks have passed.

## 2. Existing components and verified limitations

Repository inspection found no exported `computeAuditManifest`, `loadAuditManifest`, or `verifyCurrentAuditManifest` helpers in the indexed default-branch code. Do not assume these functions exist or import them until their implementation is located and verified. The isolated implementation therefore introduces a small, versioned fingerprint primitive in `supabase/functions/w3m-acquisition-verification/audit-fingerprint.ts`; it accepts a manifest supplied by a trusted caller and does not itself load or authorize database evidence.

The live Deal Room currently reads `deal_party_agreements` using `deal_id`, `party_role`, `party_id`, and `agreed_at`; its UI writes an `agreed_at` timestamp. This is a recorded UI acceptance, not proof of an EIP-712 signature. The separate `js/w3m-deal-agreement-client.js` is explicitly documented as an isolated browser-side coordinator and is not imported by the live Deal Room. Its tests exercise client-side validation, but repository inspection has not established a deployed server-side prepare/accept endpoint or persistent cryptographic acceptance store. The fingerprint integration must not treat the timestamp as a cryptographic signature.

## 3. Fingerprint record lifecycle

A fingerprint record represents one completed audit snapshot and is independent of any single deal.

Required logical fields (final SQL names/types must be aligned with the actual repository schema before migration):

- Stable record ID.
- Audit ID referencing `public.code_audits(id)`, with deletion restricted.
- Marketplace project ID when the audit is linked to a listed project; nullable only if the supported protocol flow explicitly permits an unlisted-project audit.
- Repository identity and exact audited commit SHA.
- Manifest digest and manifest schema/version identifier.
- Canonical manifest payload or a durable immutable reference to it.
- Creation timestamp and creator/source metadata.
- Integrity state and verification metadata, if required by the existing manifest implementation.

The record must be created only for an audit whose persisted status is `completed`, whose commit SHA is present and valid, and whose manifest has been recomputed from persisted audit evidence. A pending, failed, partial, or changed audit must never produce an accepted fingerprint.

## 4. Immutability and integrity

- Fingerprint records are append-only. Browser roles must not update or delete them.
- The database must reject changes to identity fields, commit SHA, manifest version, digest, and canonical payload after insertion.
- Use restrictive foreign keys so referenced audit evidence cannot be deleted while a fingerprint depends on it.
- Enable RLS. Grant no direct browser write access; writes must pass through the trusted server-side acquisition-verification function after authenticated-user and participant checks.
- Recompute and compare the digest when loading a fingerprint for signing and before final report issuance.
- Treat missing evidence, malformed hashes, mismatched project/repository identity, or digest mismatch as fail-closed conditions.
- A later audit must create a new fingerprint record; it must not mutate or silently replace a fingerprint already bound to a deal.

## 5. Deal binding and signatures

Add a binding from the acquisition deal/agreement to the fingerprint record. The binding must be explicit and unique for the intended audit snapshot.

Before either party signs, the server must:
1. Authenticate the caller and confirm that they are the buyer or seller for this deal.
2. Load the completed audit and its fingerprint record.
3. Verify project and normalized repository identity against the deal/listing context.
4. Recompute the manifest and verify the stored digest.
5. Prepare typed data that commits to the deal ID, fingerprint record ID, manifest digest, and the relevant agreement/terms version.

The buyer and seller must sign the same fingerprint record ID and digest. A party signature for another deal, another party role, another terms version, or another digest must be rejected. Replays should be idempotent only when every bound value is identical.

## 6. Final report issuance gate

The final acquisition-verification report is distinct from the audit fingerprint. It may be issued only when all of the following are true:

- The deal exists and is in an eligible non-disputed state.
- The buyer and seller are the verified participants.
- Both parties have valid, independently verified signatures over the same fingerprint and current agreement version.
- The fingerprint still verifies against the persisted audit evidence.
- Required ownership, asset-transfer, and other protocol evidence checks pass.
- No blocking dispute, stale evidence, or integrity mismatch exists.

The report must include the deal ID, fingerprint record ID, manifest digest, audited commit SHA, terms/agreement version, both acceptance references, decision outcome, and issuance timestamp. It must not claim that funds were transferred or settlement completed unless separately verified on-chain.

## 7. First-deal behavior

A deal with no previously issued final report must be a supported first-class path. The flow must not require a prior report as an input or use a previous report as proof of the audit fingerprint.

For a first deal:
1. Load or create the independent fingerprint from the completed audit.
2. Bind that fingerprint to the deal.
3. Collect buyer and seller signatures.
4. Verify all other protocol evidence.
5. Issue the final report only after the complete gate passes.

If no completed audit exists, return an explicit `INCOMPLETE` result. If a digest or identity check fails, return `BLOCKED`. If evidence needs human assessment, return `REVIEW_REQUIRED`. Only fully satisfied requirements may return `PASS`.

## 8. Required tests before merge

- Create a fingerprint from a completed audit and verify stable digest reproduction.
- Reject fingerprint creation for pending, failed, or incomplete audits.
- Reject malformed or absent commit SHA.
- Reject project/repository mismatch.
- Reject direct update/delete attempts against fingerprint records.
- Reject unauthorized browser-role reads/writes according to the intended privacy model.
- Verify buyer and seller can sign only the same fingerprint and terms version.
- Reject signature replay across deals, roles, terms versions, or changed digests.
- Change or add audit evidence after fingerprint creation and verify the integrity check blocks signing/report issuance.
- Run the first-deal path with no prior final report and prove the final report is issued only after both signatures and all evidence gates pass.
- Verify disputes and stale evidence prevent report issuance.
- Run the complete acquisition-verification test suite and CI.

## 9. Safe implementation boundaries

This branch is for code and migration review only. Do not apply migrations to production, change production data, deploy, activate live settlement, or execute financial transfers as part of this work. A migration must be reviewed against the actual table definitions, RLS policies, existing triggers, and Edge Function authorization path before it is considered ready.

## 10. Current verification status

Repository review confirms the audit table is present and the Deal Room uses `deal_party_agreements` for timestamp-based UI acceptance. The isolated typed-data client exists with component tests, but a live server-side signing/acceptance path and report-issuance runtime have not been verified. The exact persisted audit-evidence schema, RLS policies, agreement-acceptance storage, and report issuance path still require direct inspection before a database migration or runtime integration can be authored. No schema change or live transaction has been performed.

## 11. Isolated implementation checkpoint

Added `audit-fingerprint.ts` and `audit-fingerprint.test.ts` on this feature branch. The primitive creates a deterministic canonical JSON envelope and a domain-separated SHA-256 digest, binding the audit ID, normalized repository identity, exact 40-character commit SHA, manifest schema version, and manifest payload. It rejects malformed identifiers, missing/short commit hashes, non-finite numbers, unsupported values, circular references, and non-plain objects.

The tests cover key-order stability, evidence/commit sensitivity, malformed commit rejection, non-JSON input rejection, and case normalization. These tests have been authored but have not yet been executed in this environment. This is a cryptographic utility only: it is not yet connected to persisted audit evidence, authorization, RLS, deal signatures, or report issuance. It must not be described as an end-to-end protocol implementation.
