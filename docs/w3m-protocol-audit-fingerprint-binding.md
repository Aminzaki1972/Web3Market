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

An initial run of the expanded workflow passed the original fingerprint tests but failed in the new manifest test suite. Review found that asynchronous `assertRejects` calls in the manifest tests were not awaited; these assertions were corrected. The latest correction commit (`0d8b6d8be486b3f6b7ff6d14ce843d0365392845`) subsequently completed GitHub Actions run 20 with conclusion `success`. This confirms the focused fingerprint/manifest tests and type checks passed for that commit. It does not establish end-to-end protocol readiness.


## 15. Agreement trigger and policy review (2026-11-07)

A second read-only inspection queried the live trigger definitions, RLS policies, and constraints. No database writes were performed.

- The existing `prevent_deal_agreement_tampering()` trigger blocks changes to `deal_id`, `party_role`, or `party_id`; once `agreed_at` is non-null it blocks clearing or changing that timestamp.
- The participant INSERT policy checks that the caller is the matching buyer/seller and that the party role matches the deal. It does not constrain an initial caller-supplied `agreed_at` value. The UPDATE policy is participant-scoped; the trigger protects an already-populated timestamp but does not verify a cryptographic signature.
- An AFTER trigger records agreement insert/update/delete events in `admin_audit_log`. This is operational audit logging, not a cryptographic signature ledger.
- `deal_terms` is unique per deal and contains `terms_snapshot`, `buyer_agreed_at`, and `seller_agreed_at`; the inspected RLS policy set grants participants SELECT. No server-side signing endpoint or signature-verification record bound to the terms snapshot was verified.
- `deal_multisig_signers.signature` remains Safe transaction signature data and is not suitable as agreement-signature storage.

Implementation consequence: retain the current timestamp protections and audit triggers. Do not replace or weaken them. The protocol needs a separate server-verified acceptance record that binds the deal ID, immutable terms snapshot hash/version, audit fingerprint ID/digest, party role and identity, signature scheme/domain, signer address, signature bytes, and verification timestamp. The server must validate the authenticated account-to-wallet relationship and recover/verify the signer before persisting acceptance. Any new append-only schema or function must be reviewed separately against the exact RLS and trigger definitions; no production migration is authorized or performed by this inspection.


## 16. Follow-up verification and proposed persistence boundary (2026-11-07)

The latest feature-branch commit `0d8b6d8be486b3f6b7ff6d14ce843d0365392845` completed GitHub Actions workflow run 20 with conclusion `success`. The workflow ran the focused fingerprint and persisted-manifest Deno tests and type checks. This is a verified focused CI pass, not a full acquisition-protocol integration test.

A fresh read-only inspection of the connected production Supabase project verified the following details:

- `code_audits.id` is a UUID primary key. `code_audits.project_id` is nullable and references `projects(id)` with `ON DELETE CASCADE`; `requested_by` also cascades on user deletion. Audit status is constrained to queued/scanning/analyzing/paused/completed/failed.
- `code_audit_files.audit_id` and `code_audit_findings.audit_id` reference `code_audits(id)` with `ON DELETE CASCADE`. Scanned file Git object SHA is stored as nullable text in `code_audit_files.sha`.
- `deals.id` is a UUID primary key. `deals.project_id` references `projects(id)` with `ON DELETE CASCADE`; buyer and seller references are restrictive.
- `deal_terms` is unique per deal and stores a non-null JSONB `terms_snapshot`, but the inspected policy set exposes participant SELECT only.
- `deal_party_agreements` has a unique (deal_id, party_role) constraint and its existing insert/update policies are participant scoped. Its existing timestamp trigger and audit-log trigger remain in place.
- `deal_multisig_signers` is the Safe signer workflow, with one row per (deal_id, signer_role); it is not agreement acceptance evidence.
- The production project has no deployed Edge Function named `w3m-acquisition-verification`. The browser-side `js/w3m-deal-agreement-client.js` exists but remains isolated and is not wired into the live Deal Room.

### Persistence design proposal — review only, not migration SQL

Use three separate append-only records rather than overloading the existing Safe signer or timestamp tables:

1. **Audit fingerprint ledger** — one immutable row per verified audit snapshot. Proposed fields: UUID ID; audit ID; optional project ID; normalized repository; exact 40-character commit SHA; manifest schema; lowercase SHA-256 digest; canonical manifest JSONB; creation timestamp; creator/source metadata. The audit reference must use `ON DELETE RESTRICT`, not cascade, so a project/user deletion cannot silently erase evidence protected by the ledger. The record must only be inserted after the trusted server reloads all audit/file/finding rows, recomputes the manifest and digest, and confirms the audit is completed.
2. **Deal-to-fingerprint binding** — immutable row tying one deal to one fingerprint and to a hash/version of the exact `deal_terms.terms_snapshot`. A deal must not silently switch to a different fingerprint after acceptance begins. If terms are revised, create a new explicitly versioned agreement/binding workflow; do not overwrite the old evidence.
3. **Verified agreement acceptance** — one record per buyer/seller role, tied to the binding and containing the authenticated account ID, verified wallet address, chain ID, EIP-712 domain/version, terms version/hash, fingerprint digest, signature bytes, signature scheme, and server verification timestamp/result. The server must recover/verify the signer and compare it to the wallet address already verified for that authenticated account. Unique constraints must prevent multiple competing acceptances for the same binding and party role; exact identical retries may return the existing acceptance, while any changed digest/version/signature must fail closed.

A future final-report table should be separate from these evidence records and should be append-only. It must contain the two acceptance references, binding/fingerprint IDs, digest, audited commit, decision, evidence-check result, and issuance timestamp. A `PASS` report must not imply escrow funding, asset transfer, or on-chain settlement unless those are independently verified.

### Security and platform constraints

- Do not weaken or replace the current `deal_party_agreements` trigger, RLS policies, or Safe signer workflow.
- New ledger and acceptance tables must have RLS enabled and no direct browser INSERT/UPDATE/DELETE privileges. Prefer no browser access at all; the authenticated Edge Function should validate the caller and perform narrowly scoped server-side writes. Do not add a broadly callable `SECURITY DEFINER` function in `public`.
- The audit ledger must use restrictive foreign keys so evidence cannot disappear through existing `ON DELETE CASCADE` chains. The precise FK graph and deletion behavior must be integration-tested before any migration.
- Supabase announced that new `public` tables are no longer automatically exposed through the Data API by default (enforced across projects from 2026-10-30). These internal protocol tables should remain unexposed to browser roles; do not add grants merely to make them visible.
- Supabase CLI v3 changed hosted database command defaults: database commands target local by default and hosted changes require explicit remote targeting/confirmation. Any future migration workflow must explicitly target the intended environment and be reviewed before execution.

### Next implementation gates

1. Implement and test the server-side read/prepare/accept endpoint on the isolated branch only.
2. Use a pinned, reviewed EVM signature-recovery dependency and test EIP-712 domain, chain ID 56, deal ID, fingerprint digest, terms hash/version, party role, wallet, replay and cross-deal rejection.
3. Add the append-only schema migration only after the table design, FK deletion behavior, RLS, grants and trigger definitions are reviewed together.
4. Add tests for audit/project deletion restriction, unauthorized direct API access, immutable updates/deletes, terms changes after signature, dispute blocking and first-deal issuance.
5. Add final-report issuance only after the independent acceptance records and all evidence checks are verified.

No production schema change, migration, Edge Function deployment, deal update, signature request, Safe transaction or financial transfer was performed during this inspection.


## 17. Isolated EIP-712 signature-verification primitive (2026-11-07)

Added `agreement-signature.ts` and focused tests on this feature branch. The module pins `ethers@6.15.0`, consistent with the repository's existing pinned ethers asset, and constructs the typed-data payload on the server from expected values rather than accepting a client-provided domain or message as authoritative.

The typed acceptance binds:
- BNB Chain domain ID 56, domain name `Web3Market Deal Agreement`, version `1`;
- deal ID, fingerprint record ID, fingerprint digest, and immutable terms hash;
- terms version, buyer/seller role, expected wallet address, one-time nonce, and a short signature deadline (maximum 15 minutes);
- 65-byte ECDSA signatures with high-s signatures rejected, followed by signer recovery and exact wallet comparison.

Focused tests cover valid recovery, wrong-wallet rejection, replay/tampering across deal/fingerprint/digest/terms/role/nonce, expired or overlong deadlines, and malformed inputs. The focused workflow was expanded to run these tests and type-check this module. GitHub Actions run #31 on commit cfe8415448b29dd84ad93341412af898a6dfbd3b passed: all 18 tests (9 fingerprint, 3 manifest, 6 EIP-712) passed, and Deno type-check passed. The initial EIP-712 run failed only because Deno lacked permission for the two environment reads used by the transitive ws compatibility module; the workflow was narrowed to allow only WS_NO_BUFFER_UTIL and WS_NO_UTF_8_VALIDATE, after which both push and pull-request runs passed.

**Important boundary:** this is a pure cryptographic primitive, not a live acceptance endpoint. It does not authenticate Supabase users, query trusted deal/fingerprint/terms rows, compare the recovered wallet with the participant's verified profile wallet, consume the nonce atomically, persist signatures, or issue the final report. The deployed wallet verification flow confirms ownership of a wallet using a personal-message challenge and stores a verified wallet on the profile; the acquisition endpoint must still re-check that stored wallet at request time. No Edge Function deployment, schema migration, production write, or settlement action was performed.


## 18. Exact persistence boundary and deletion semantics (2026-11-07)

A further read-only schema review was completed before proposing any migration. No database writes were performed.

### Verified participant identity and deal state

- `public.profiles` contains `id`, `wallet_address`, `wallet_verified`, and `wallet_verified_at`. The current profile SELECT policy is self-only for authenticated users. A server function that uses a service-role client to load another participant's profile must first validate the caller's JWT with the public/anon client, then use a separate server-only service-role client for the narrowly scoped profile read. Never forward the user's Authorization header to the service-role client.
- The profile trigger definitions were inspected. Authenticated/anonymous clients cannot change `wallet_address`, `wallet_verified`, or `wallet_verified_at`; the verified wallet identity is controlled by trusted wallet-verification workflows. The acquisition function must nevertheless re-read `wallet_address` and `wallet_verified` at both prepare and accept time, and compare the recovered EIP-712 signer to the current profile wallet.
- The current `deals.status` values include `pending`, `accepted`, `funded`, `in_progress`, `completed`, `cancelled`, `rejected`, and `disputed`. The separate `dispute_status` values include `none`, `open`, `under_review`, `resolved_buyer`, `resolved_seller`, and `closed`. Final report issuance must block when status is `disputed` or dispute status is `open` / `under_review`; the existing deal state-transition trigger must not be weakened or bypassed.
- `deal_terms` has exactly one row per deal today and stores `terms_snapshot` as non-null JSONB. It has no terms-version column. Therefore, a protocol binding must carry its own server-assigned positive `terms_version`, canonical snapshot, and SHA-256 terms hash. It must not pretend the current table already versions terms.
- `deals.buyer_id` and `deals.seller_id` reference `profiles(id)`; participant IDs must be compared to the authenticated `auth.users.id`, not accepted from request JSON.

### Proposed append-only records (design only; not migration SQL)

1. **`w3m_audit_fingerprints`**
   - `id uuid primary key`; `audit_id uuid not null`; optional `project_id uuid`; normalized `repository text`; exact `commit_sha char(40)`; `manifest_schema text`; `digest char(64)`; canonical `manifest jsonb`; `created_at timestamptz`; server source/actor metadata.
   - Unique identity should prevent duplicate ledger entries for the same audit + manifest version + digest, while allowing a later audit or changed evidence to produce a new record.
   - FK to `code_audits(id) ON DELETE RESTRICT`. The existing audit rows currently cascade from project deletion and auth-user deletion, and their file/finding rows cascade from audit deletion. The restrictive ledger FK intentionally prevents those cascades from erasing an audit that has become acquisition evidence. This means project/account deletion can be blocked while a retained fingerprint exists; a retention/legal-erasure policy must be explicitly decided before migration.
   - Do not make the fingerprint depend on a nullable project FK alone; the durable evidence anchor is the audit row plus the repository and commit identity.

2. **`w3m_deal_fingerprint_bindings`**
   - `id uuid primary key`; `deal_id uuid not null`; `fingerprint_id uuid not null`; `terms_version bigint not null check (terms_version > 0)`; immutable `terms_snapshot jsonb`; `terms_hash char(64)`; `created_at timestamptz`; server actor/source metadata.
   - Unique `(deal_id, terms_version)`; FK to `deals(id) ON DELETE RESTRICT`; FK to `w3m_audit_fingerprints(id) ON DELETE RESTRICT`.
   - The binding stores the exact terms snapshot used for signing. A later terms revision creates a new version/binding; it must not update the old row or silently replace a fingerprint after either party has signed.
   - The deal FK restriction also intentionally blocks deletion of a project that would cascade-delete a deal with retained acquisition evidence. This lifecycle effect must be accepted and tested before migration.

3. **`w3m_agreement_challenges`**
   - A short-lived server-issued challenge per binding + party role, with authenticated `party_id`, verified `wallet_address`, cryptographically random 32-byte nonce, `issued_at`, `expires_at`, and nullable `consumed_at`.
   - The challenge's identity, nonce, wallet, role, binding, and expiry are immutable. Only the one-way transition from unconsumed to consumed is permitted. Expired or consumed challenges are rejected.
   - A challenge record is needed because a nonce that is merely supplied by the browser cannot prove that the server issued it. The server creates the nonce and stores the challenge before returning typed data to the wallet.

4. **`w3m_verified_agreement_acceptances`**
   - One immutable accepted signature per `(binding_id, party_role)`; include `party_id`, verified `wallet_address`, `challenge_id`, `chain_id=56`, typed-data domain/version, `terms_version`, `terms_hash`, fingerprint digest, signature bytes, signature scheme, recovered signer, server verification timestamp, and verifier version.
   - Unique `(binding_id, party_role)`, unique `challenge_id`, and unique nonce/challenge consumption prevent competing acceptances and replay. FK references to binding, challenge, and auth user should be restrictive so accepted evidence is not erased by ordinary deal/account deletion.
   - Exact retries may return the existing acceptance only when the submitted signature and every bound field match byte-for-byte; any different signature or changed terms/fingerprint must fail closed.

5. **`w3m_acquisition_reports`**
   - Separate append-only final report with binding/fingerprint IDs, buyer and seller acceptance IDs, digest, audited commit, terms version/hash, decision (`PASS`, `BLOCKED`, `INCOMPLETE`, or `REVIEW_REQUIRED`), evidence-check result, verifier version, and `issued_at`.
   - A report may be issued only after both acceptances are independently verified and the live audit evidence is reloaded/recomputed. A `PASS` is not proof of escrow funding, asset transfer, or settlement.

### Atomicity, access, and UUID encoding

- The accept path must consume the challenge and insert the verified acceptance atomically. Two concurrent requests must not both consume the same challenge or create competing role acceptances. Use a narrowly scoped transaction/RPC path that is callable only by `service_role` (revoke execute from `PUBLIC`, `anon`, and `authenticated`); prefer `SECURITY INVOKER` with fixed search path and no browser grants. Do not add a broadly callable `SECURITY DEFINER` function in `public`.
- All new tables must have RLS enabled and no direct `anon` or `authenticated` INSERT/UPDATE/DELETE privileges. Browser reads should also be denied unless a separately reviewed requirement exists. The Edge Function authenticates the JWT first, checks deal participation, then uses its isolated server-only client.
- Existing UUID primary keys (`deals.id`, `code_audits.id`, and proposed ledger IDs) are not already `bytes32`. The EIP-712 helper currently accepts `bytes32`; the server must convert UUIDs deterministically to 32-byte hex by removing UUID hyphens and prefixing `0x`, with tests proving round-trip and fixed-width encoding. Never accept the converted value from the browser.
- The Edge Function must derive the terms hash from the server-loaded JSONB snapshot using the same canonical JSON rules on every request. It must load all scanned file rows and finding rows, rebuild the manifest, recompute the fingerprint, and compare both digest and repository/commit identity before prepare, accept, and final report issuance.
- The existing `deal_party_agreements` timestamp workflow, its triggers, and the Safe signer tables remain untouched. They are not substitutes for the new cryptographic acceptance ledger.

### Implementation decision

The exact table and function design is now sufficiently grounded to write a migration draft on the feature branch, but it is **not** approved for application to the connected production database. Before creating that draft, the remaining design review must settle retention/deletion behavior for audits, projects, deals, and accounts, and inspect the full deal-terms mutation path to confirm how revised terms are represented. No migration, SQL write, Edge Function deployment, or production data change has been performed.


## 19. Canonical deal-terms blocker found in the live flow (2026-11-07)

A final read-only check of the live data and Deal Room source found a prerequisite that must be resolved before implementing `prepare` / `accept`:

- The connected production database currently has 2 deal rows, 0 `deal_terms` rows, 2 `deal_party_agreements` timestamp rows, and 0 deals currently marked disputed or under active dispute review. This was an aggregate count only; no deal content was read or changed.
- The current `js/deal-room.js` `renderTerms()` renders a fixed “Dispute Resolution — Model B” notice and writes only `deal_party_agreements.agreed_at`. It does not load a `deal_terms.terms_snapshot`, and no `deal_terms` / `terms_snapshot` references were found in the current main-branch Deal Room or checkout JavaScript.
- The table and JSONB column exist in the database, but there are no rows today. Therefore the protocol currently has no populated canonical terms snapshot to hash and sign. A server endpoint must not hash an invented/default empty object, nor treat the generic UI notice as the full commercial agreement.

**Gate before the Edge Function:** define the authoritative acquisition agreement payload and its lifecycle. It must specify which server-owned values are included (at minimum deal/project identity, buyer and seller IDs, asset/scope being transferred, consideration and currency, platform fee, payment/escrow conditions, delivery obligations, inspection/acceptance, dispute procedure, and governing terms/version). The server must create or load this snapshot from trusted deal/project data, validate required fields, and persist the first version before issuing any EIP-712 challenge. Any revision must create a new version and invalidate outstanding challenges for older versions.

Until that canonical terms source exists and is populated, the EIP-712 primitive can be tested in isolation, but a live acceptance endpoint would sign a digest without a trustworthy legal/commercial document behind it. This is a **hard implementation blocker**, not a reason to bypass the gate. No live deal rows, terms, timestamp agreements, or payment/escrow state were changed.


## 20. Acquisition Agreement V1 — canonical payload specification (design only)

This section defines the first canonical agreement contract. It is a protocol specification, not legal advice, not a published user-facing contract, and not a database migration. It must be reviewed for the platform's intended jurisdictions and business model before any buyer or seller is asked to sign.

### 20.1 Server-owned identity and transaction fields

The server constructs the snapshot from authenticated database rows. The browser may propose values during negotiation, but it cannot authoritatively set the final signed values.

| Agreement field | Authoritative source / rule | Required before signing |
|---|---|---|
| `schema` | Constant, `w3m-acquisition-terms-v1` | Yes |
| `terms_version` | Server-assigned monotonically increasing integer per deal | Yes |
| `deal_id`, `project_id` | `deals.id`, `deals.project_id` | Yes |
| `buyer_id`, `seller_id` | `deals.buyer_id`, `deals.seller_id` | Yes |
| `project_title`, `project_category` | Current `projects.title`, `projects.category`, copied into immutable snapshot | Yes |
| `repository`, `commit_sha`, `audit_id`, `fingerprint_digest` | Verified completed audit and fingerprint ledger; no browser-supplied override | Yes for protocol-certified acquisition |
| `consideration.amount`, `consideration.currency` | Locked `deals.amount` and `deals.currency`; if a separately agreed token amount differs, both values and conversion/valuation rule must be explicit | Yes |
| `platform_fee.percent` | Locked `deals.platform_fee_percent` | Yes |
| `platform_fee.amount`, `seller_net.amount` | Server-computed from locked amount, percentage, and explicit currency precision/rounding rule; compare with persisted `platform_fee_amount` / `platform_fee` and `seller_net_amount` when present | Yes |
| `payment.chain_id`, `payment.asset`, `payment.token_contract`, `payment.safe_address` | Locked deal payment configuration; chain ID 56 is the EIP-712 signing domain for BNB Smart Chain, and payment chain/asset must be separately stated | Yes before on-chain payment is enabled; otherwise explicitly mark payment method pending/not enabled |
| `created_at`, `expires_at` | Server timestamps | Yes |

If any authoritative amount, currency, participant, project, audit, or payment value is missing or inconsistent, the server returns `INCOMPLETE` / `BLOCKED`; it must not substitute zero, empty string, a UI default, or a value inferred from the listing's asking price. In particular, `projects.price` / `asking_price` is not a substitute for the negotiated `deals.amount`.

### 20.2 Buyer/seller commercial declarations

The signed snapshot must include a structured `transfer_scope` object, confirmed by both parties:

- `included_assets[]`: each asset has a stable type, description, transfer method, and evidence/reference. Examples may include domain, source repository, deployed application, smart contracts, brand assets, documentation, customer records where lawful, and operating accounts.
- `excluded_assets[]`: explicit list; use an empty array only after both parties affirm that nothing is excluded.
- `access_and_credentials`: transfer method and timing, without storing passwords, private keys, seed phrases, API secrets, or other credentials in the agreement record.
- `third_party_dependencies[]`: hosting, APIs, licenses, SaaS subscriptions, vendors, and other dependencies, including whether they are transferable and any required third-party consent.
- `intellectual_property`: seller's declaration of ownership or authority to transfer, known third-party/open-source licenses, and any exceptions/disputes. A declaration is not independent proof of title.
- `data_and_privacy`: categories of data included, lawful transfer basis/consents required, and exclusions. Personal data must not be transferred merely because the project is sold.

The seller's declarations must be explicitly labelled as seller-provided statements, not independently verified facts, unless a distinct verification record supports them. AI audit results describe the scanned repository at the bound commit; they do not prove ownership, revenue, legal compliance, absence of vulnerabilities, or transferability of every asset.

### 20.3 Delivery, inspection, and dispute conditions

The snapshot must include:

- `delivery.deadline` and a checklist of each deliverable, responsible party, and completion evidence.
- `inspection.window` and objective acceptance criteria; inspection starts only after the defined delivery event.
- `rejection_and_cure`: permitted reasons, notice channel, response/cure period, and what happens if a deliverable is incomplete.
- `dispute.procedure`: the exact process and roles. It must not claim that Web3Market is a licensed arbitrator or court. The current UI phrase “Dispute Resolution — Model B” is not sufficient as the full procedure and must be replaced with the reviewed final text before signatures.
- `escrow`: Safe address, chain, asset, signer threshold, funding condition, release condition, refund/dispute handling, and explicit statement that signing the agreement does not itself fund or release escrow.
- `termination`: conditions, deadlines, and consequences, consistent with the actual deal state machine.

A disputed deal, active dispute review, missing escrow configuration when escrow is required, or a contradictory payment state must block automated PASS and any release path. A report PASS is an evidence/acceptance result only; it is never an instruction to release funds.

### 20.4 Governing terms and risk acknowledgements

Required explicit fields:

- `governing_law` and `venue_or_process`: must be selected by the platform's legal review and parties where applicable; never infer a jurisdiction from user location, project location, or server location.
- `platform_role`: precise description of Web3Market's marketplace/technical role and what it does not guarantee.
- `fees_and_refunds`: platform fee basis, when earned, whether refundable, and who bears network fees.
- `risk_acknowledgements[]`: repository audit limitations, smart-contract/third-party risks, token/chain volatility and irreversible transactions, third-party transfer restrictions, and the distinction between wallet signature and legal identity.
- `disclosures[]`: material seller disclosures and buyer acknowledgements, each with an author, timestamp, and text/version.
- `language`: authoritative contract language and whether any translation is informational only.

No governing law, arbitration promise, guarantee, refund right, tax treatment, or legal status may be invented by the protocol. Until these terms are reviewed and adopted, the V1 agreement remains a technical draft and must not be represented as an enforceable legal contract.

### 20.5 Canonicalization and signing

- Store the exact immutable snapshot JSONB plus canonical UTF-8 JSON bytes or a deterministic canonical representation. Canonicalization must reject undefined values, non-finite numbers, sparse arrays, duplicate/ambiguous key forms, and non-plain objects; object keys are sorted and array order is preserved.
- Monetary values must be represented as decimal strings with explicit currency/token decimals, not JavaScript floating-point numbers. Define the rounding mode and scale per currency/asset before fee calculation.
- Compute `terms_hash = SHA-256("w3m-acquisition-terms:v1\\n" || canonical_terms_bytes)`; this is the selected V1 algorithm and is represented as a 32-byte hex value in EIP-712. The EIP-712 typed data binds this hash, fingerprint digest, deal UUID bytes32 encoding, terms version, party role, verified wallet, chain ID, nonce, and expiry.
- The EIP-712 domain's chain ID 56 binds the signature to BNB Smart Chain. Payment chain/asset fields remain explicit agreement fields and must not be inferred from the EIP-712 domain alone.
- The server independently rebuilds the typed data from persisted state and recovers the signer. Any mismatch, expired challenge, changed terms, changed audit evidence, wrong wallet, wrong role, wrong chain/domain, or replay returns a fail-closed result.
- A terms revision creates a new snapshot version and binding. It never overwrites an already signed version. Old unused challenges are invalidated, and existing signatures remain attached only to the exact historical version they signed.

### 20.6 Illustrative JSON shape (not production data)

```json
{
  "schema": "w3m-acquisition-terms-v1",
  "terms_version": 1,
  "deal": {
    "deal_id": "<server UUID>",
    "project_id": "<server UUID>",
    "buyer_id": "<server UUID>",
    "seller_id": "<server UUID>"
  },
  "project": {
    "title": "<copied from project row>",
    "category": "<copied from project row>"
  },
  "audit": {
    "audit_id": "<verified audit UUID>",
    "repository": "<normalized owner/repository>",
    "commit_sha": "<40-character commit SHA>",
    "fingerprint_digest": "<64-character digest>"
  },
  "consideration": {
    "amount": "<decimal string>",
    "currency": "<currency or token symbol>"
  },
  "platform_fee": {
    "percent": "<decimal string>",
    "amount": "<decimal string>"
  },
  "seller_net": {
    "amount": "<decimal string>",
    "currency": "<same currency or explicitly converted currency>"
  },
  "payment": {
    "method": "safe_multisig",
    "chain_id": 56,
    "asset": "<explicit asset>",
    "token_contract": "<verified contract or null>",
    "safe_address": "<verified Safe or null>",
    "status_at_signing": "configured_or_pending"
  },
  "transfer_scope": {
    "included_assets": [],
    "excluded_assets": [],
    "access_and_credentials": {},
    "third_party_dependencies": [],
    "intellectual_property": {},
    "data_and_privacy": {}
  },
  "delivery": {
    "deadline": "<ISO-8601 timestamp>",
    "checklist": []
  },
  "inspection": {
    "window": "<duration>",
    "acceptance_criteria": []
  },
  "dispute": {
    "procedure_version": "<reviewed version>",
    "text": "<reviewed procedure>"
  },
  "escrow": {
    "funding_condition": "<explicit condition>",
    "release_condition": "<explicit condition>",
    "dispute_hold": true
  },
  "governing_terms": {
    "governing_law": "<legally reviewed selection>",
    "venue_or_process": "<legally reviewed selection>",
    "language": "en"
  },
  "risk_acknowledgements": [],
  "disclosures": [],
  "created_at": "<server timestamp>",
  "expires_at": "<server timestamp>"
}
```

### 20.7 Build gate

Before implementation, the team must decide and record: (1) the legally reviewed agreement text and jurisdiction model; (2) accepted asset and payment/currency types; (3) exact decimal and fee rounding rules; (4) required versus optional transfer evidence by project type; (5) escrow conditions and dispute workflow; (6) retention/deletion and account-erasure policy. Until those decisions are settled, implement only pure schema validation and canonicalization tests using synthetic fixtures. Do not create production terms, request wallet signatures, migrate the database, or alter live Deal Room behavior.


## 21. Pure V1 terms validator added on the feature branch (2026-11-07)

Added two isolated modules under `supabase/functions/w3m-acquisition-verification/`:

- `acquisition-terms.ts`: validates the V1 terms envelope, server-shaped IDs, project/audit identity, full commit SHA, fingerprint digest, decimal-string consideration and fee values, BNB Chain ID 56, transfer scope, delivery checklist, inspection criteria, dispute procedure, escrow hold, governing terms, risk acknowledgements, and timestamps. It also canonicalizes the full JSON structure and computes a domain-separated SHA-256 terms hash.
- `acquisition-terms.test.ts`: synthetic tests for valid terms, key-order stability, deterministic hash, missing audit/delivery evidence, floating-point money, wrong chain, same buyer/seller, invalid expiry, sparse arrays, undefined, non-finite values, and circular references.
- Updated `.github/workflows/w3m-audit-fingerprint-tests.yml` to include the new module and tests in focused Deno test/type-check runs.

This is deliberately a pure validation/hash layer. It does not create real terms, load deal data, calculate and persist fee snapshots, authenticate participants, store signatures, or authorize settlement. Synthetic fixture values are test-only and are not platform terms. CI must pass on the latest branch head before this module is considered verified.


### 21.1 CI verification for the V1 terms validator (2026-11-07)

The latest focused GitHub Actions run for commit `13b9fd1af9136912895e9ad8adf6b3136e24485b` completed successfully:

- 9 audit-fingerprint tests
- 3 persisted-manifest tests
- 6 EIP-712 signature primitive tests
- 9 acquisition-terms V1 validation/canonicalization tests
- Total: **27 tests passed**, plus Deno type-check passed for all four modules.

Run: `42345922797` (success). This validates the isolated pure modules only; no end-to-end Edge Function, database persistence, wallet session, or escrow workflow has been tested or deployed.
