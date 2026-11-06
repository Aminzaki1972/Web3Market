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

## 12. Nightly progress: isolated test automation

Added `.github/workflows/w3m-audit-fingerprint-tests.yml` to run the focused Deno test file and type-check the fingerprint module on relevant pull-request and feature-branch changes. The workflow has been committed, but no successful run is claimed until GitHub Actions reports a completed passing run.

Additional schema search did not locate authoritative creation DDL for `deals`, `deal_party_agreements`, `code_audit_files`, or `code_audit_findings` in the inspected repository history. Existing migrations and application queries reveal only partial column usage. Therefore an append-only persistence migration is intentionally blocked pending complete schema and RLS inspection. Do not infer missing columns or add a speculative migration.

The next safe integration task is to identify the authoritative table definitions (or inspect the connected database read-only), then design the ledger table and server-only write path against the verified schema.

## 13. Read-only production schema inspection (2026-11-07)

The connected `web3market` Supabase project was inspected read-only. No SQL write, migration, or production change was performed.

Verified audit columns:
- `code_audits`: audit UUID, status, repository owner/name, commit SHA, engine version, audit type, file/line counts, scores, risk level, summary.
- `code_audit_files`: path, language, size, line count, selected tier, Git blob `sha`, and `scanned`.
- `code_audit_findings`: severity, category, title, status, file/line range, evidence, description, recommendation, confidence.

Verified deal columns:
- `deals`: project, buyer, seller, amount/currency, status, chain/Safe/payment fields and delivery/inspection timestamps.
- `deal_party_agreements`: deal, party role, party UUID and `agreed_at` timestamp only.
- `deal_terms`: a `terms_snapshot` JSONB field plus party timestamps and deadlines.
- `deal_multisig_signers`: signer identity/wallet, signature status/time, Safe transaction hash and signature text.

Security observations:
- `code_audits`, `code_audit_files`, and `code_audit_findings` have RLS and authenticated SELECT policies scoped to audit owner/admin.
- `deal_party_agreements` has participant INSERT/SELECT and UPDATE policies. A database trigger prevents changing the deal/party identity and prevents clearing or changing `agreed_at` once it is non-null. However, the trigger does not validate a signature or bind the timestamp to `deal_terms.terms_snapshot`; the INSERT policy also does not constrain a caller-supplied initial `agreed_at`. The timestamp is therefore tamper-resistant after it is set, but is not cryptographic acceptance evidence.
- `deal_terms` has a participant SELECT policy in the inspected policy set and stores `terms_snapshot`; no verified server-side cryptographic acceptance path binding signatures to that snapshot was established.
- `deal_multisig_signers.signature` relates to Safe transaction signing; it must not be repurposed as legal agreement signature evidence without a separate typed-data domain and verification path.

The persisted manifest builder now binds completed audit identity, exact commit SHA, engine/type, score summary, sorted scanned-file Git blob SHAs, and sorted finding evidence. It fails closed if the audit is incomplete, the commit is missing, scanned-file count differs, or any scanned file lacks a valid Git blob SHA. This is stronger than hashing display metadata alone.

## 14. CI follow-up

An initial run of the expanded workflow passed the original fingerprint tests but failed in the new manifest test suite. Review found that asynchronous `assertRejects` calls in the manifest tests were not awaited; these assertions have now been corrected. A rerun for the correction commit has not yet appeared in the workflow-run listing, so the expanded suite remains unverified until a subsequent run reports success. Do not mark this branch CI-clean yet.


## 15. Agreement trigger and policy review (2026-11-07)

A second read-only inspection queried the live trigger definitions, RLS policies, and constraints. No database writes were performed.

- The existing `prevent_deal_agreement_tampering()` trigger blocks changes to `deal_id`, `party_role`, or `party_id`; once `agreed_at` is non-null it blocks clearing or changing that timestamp.
- The participant INSERT policy checks that the caller is the matching buyer/seller and that the party role matches the deal. It does not constrain an initial caller-supplied `agreed_at` value. The UPDATE policy is participant-scoped; the trigger protects an already-populated timestamp but does not verify a cryptographic signature.
- An AFTER trigger records agreement insert/update/delete events in `admin_audit_log`. This is operational audit logging, not a cryptographic signature ledger.
- `deal_terms` is unique per deal and contains `terms_snapshot`, `buyer_agreed_at`, and `seller_agreed_at`; the inspected RLS policy set grants participants SELECT. No server-side signing endpoint or signature-verification record bound to the terms snapshot was verified.
- `deal_multisig_signers.signature` remains Safe transaction signature data and is not suitable as agreement-signature storage.

Implementation consequence: retain the current timestamp protections and audit triggers. Do not replace or weaken them. The protocol needs a separate server-verified acceptance record that binds the deal ID, immutable terms snapshot hash/version, audit fingerprint ID/digest, party role and identity, signature scheme/domain, signer address, signature bytes, and verification timestamp. The server must validate the authenticated account-to-wallet relationship and recover/verify the signer before persisting acceptance. Any new append-only schema or function must be reviewed separately against the exact RLS and trigger definitions; no production migration is authorized or performed by this inspection.
