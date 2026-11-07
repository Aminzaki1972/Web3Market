# W3M Protocol — Acceptance Ledger V1 (Design Only)

**Status:** proposed schema and transaction contract; not an applied migration.  
**Target:** isolated feature branch only. No database changes are made by this document.

## 1. Read-only schema facts

Inspection of the connected project found:
- `public.deals`: `id`, `project_id`, `buyer_id`, `seller_id`.
- `public.profiles`: `wallet_address`, `wallet_verified`.
- `public.code_audits`: `id`, `project_id`, `repo_owner`, `repo_name`, `commit_sha`, `status`, `completed_at`.
- `public.code_audit_files`: `audit_id`, `path`, `sha`.
- Existing `deal_party_agreements.agreed_at` is a timestamp, not cryptographic proof.

Do not repurpose `deal_party_agreements` or `deal_multisig_signers` as legal-signature evidence.

## 1A. Additional read-only findings: terms and state controls

A read-only inspection of the production schema added important facts:
- `public.deal_terms` already exists with `deal_id`, `terms_snapshot jsonb`, buyer/seller acknowledgement timestamps, dispute-resolution acknowledgement, delivery/inspection deadlines, and timestamps. It has no dedicated immutable terms version or stored cryptographic terms hash in the inspected columns.
- The inspected RLS policy for `deal_terms` grants participant SELECT only; no participant INSERT/UPDATE policy was found in the policy listing.
- `public.deal_party_agreements` stores only role, party ID, and `agreed_at`; participant INSERT/UPDATE policies exist. A trigger prevents changing its identity and prevents clearing/changing an already populated acknowledgement timestamp. This immutability is useful for the legacy timestamp record but does not make it a signed terms acceptance.
- `public.deals` has a state-transition trigger allowing `pending -> accepted`; `accepted` can then transition to funded/cancelled/rejected/disputed. The transition trigger itself does not require an EIP-712 acceptance pair.
- The reviewed frontend Deal Room currently writes `deal_party_agreements`; it does not read `deal_terms.terms_snapshot` to construct a canonical terms hash in the inspected acceptance handler.

Implications:
- `deal_terms.terms_snapshot` is a candidate source to investigate, not yet an authoritative versioned contract. Inspect its writer, content shape, and update history before adopting it.
- Do not infer that `deals.status='accepted'` proves both parties signed terms cryptographically. The database state trigger permits that status transition independently of the new ledger.
- A future server finalization/ Safe deployment gate must explicitly require the new persisted acceptance pair. Merely changing the UI or relying on the status string is insufficient.
- Do not modify these production objects during this protocol branch work; all findings above are read-only.

## 2. Proposed private schema

Create `w3m_private`, outside the exposed Data API schema.

### `w3m_private.deal_audit_bindings`

One immutable evidence binding per deal:
- `deal_id uuid primary key references public.deals(id)`
- `project_id uuid not null references public.projects(id)`
- `audit_id uuid not null references public.code_audits(id)`
- `fingerprint_id uuid not null`
- `fingerprint_digest bytea not null check (octet_length(fingerprint_digest)=32)`
- `repo_owner text not null`, `repo_name text not null`
- `commit_sha text not null check (commit_sha ~ '^[0-9a-fA-F]{40}$')`
- `binding_hash bytea not null check (octet_length(binding_hash)=32)`
- `created_at timestamptz not null default now()`
- Unique evidence identity across project/audit/repository/commit/fingerprint fields.
- Trusted transaction must verify deal/project match, completed audit status, exact commit SHA and persisted Git blob SHAs before insertion.
- No update/delete; changed evidence requires a new deal/evidence flow.

### `w3m_private.deal_acceptances`

One immutable acceptance per party role per deal:
- UUID primary key and foreign keys to deal, project, audit, and `auth.users`.
- Evidence snapshot: fingerprint ID/digest, binding hash.
- Terms snapshot: terms hash and positive terms version.
- Party: role constrained to buyer/seller, authenticated user ID, verified wallet address.
- Signature: full 65-byte ECDSA hex signature, not just a timestamp.
- Challenge: 32-byte nonce, unique globally; signature deadline and accepted timestamp.
- `unique(deal_id, party_role)`: at most one buyer and one seller acceptance per deal.
- `unique(nonce)`: each challenge can be consumed once across all deals.
- Acceptance row stores immutable evidence and terms identifiers to prevent later mutable joins from changing its meaning.

The write transaction verifies the authenticated user is the buyer/seller stored on the deal for that role, and that the current verified profile wallet equals the recovered EIP-712 signer.

## 3. Atomic transaction contract

The Edge Function authenticates the Supabase JWT and derives user ID from the verified JWT. Client-supplied user ID, role, wallet, terms, fingerprint, and typed-data domain are never authoritative.

The server loads the deal, participant identities, verified profile wallet, current terms, immutable audit binding, and completed audit/file evidence from trusted storage. It rebuilds the EIP-712 challenge and verifies the signature server-side.

A narrowly scoped database transaction must:
1. Lock the deal row using `SELECT ... FOR UPDATE`.
2. Reject ineligible, disputed, cancelled, or completed deals.
3. Re-check participant, role, verified wallet, current terms hash/version, and evidence binding.
4. Insert the acceptance. Unique constraints on nonce and (deal, role) are the concurrency boundary; a read-before-write check is not replay protection.
5. Reject uniqueness conflicts, except an explicitly implemented idempotent retry for the byte-for-byte identical request by the same authenticated user. Never overwrite a row.
6. Reload both persisted party rows under the lock.
7. Return both-accepted only if distinct buyer/seller users accepted the same deal, binding, fingerprint digest, terms hash, and terms version.
8. Commit insert and result atomically.

## 4. Immutability and permissions

- Keep tables in `w3m_private`, not exposed `public`.
- No direct table grants to anon/authenticated; no client writes or realtime exposure.
- Grant execution only on the narrow transaction function to the trusted server role.
- For SECURITY DEFINER: fixed safe `search_path`, schema-qualified references, revoke default PUBLIC execute, grant only to intended role.
- Reject UPDATE and DELETE with database triggers, including service-role application attempts.
- If ever moved to exposed schema, enable RLS as defense in depth with explicit least-privilege policies.

## 5. Finalization gate

Final evidence can be issued only after reloading persisted rows and verifying exactly one buyer and one seller acceptance; distinct identities matching the deal; same immutable binding, fingerprint digest, terms hash and version; valid signatures/nonces/deadlines/wallets; and deal remains eligible and undisputed.

This evidence does not prove escrow funding, asset transfer, or settlement. Safe settlement remains a separate gate.

## 6. Required adversarial and concurrency tests

- Concurrent same-nonce requests: exactly one insert succeeds.
- Concurrent same-role requests with different nonces: exactly one succeeds.
- Cross-deal replay, wrong user/role/wallet, unverified wallet: reject.
- Wallet, terms, audit commit, Git blob SHA, fingerprint, or binding changes: reject.
- Expired deadline, malformed/high-s signature, malformed nonce: reject.
- UPDATE/DELETE by authenticated and service roles: reject.
- Identical network retry returns only the same existing result; altered retry rejects.
- Different buyer/seller terms or binding: finalization blocked.
- Dispute/cancellation between challenge and acceptance: reject.

## 7. Existing Deal Room integration findings (read-only)

A review of `js/deal-room.js` on this branch found that the current Deal Room:
- Reads `deal_party_agreements` using only `party_role`, `party_id`, and `agreed_at`.
- Writes acceptance through a browser-side Supabase `upsert` keyed by `deal_id,party_role,party_id`.
- Displays a fixed dispute-resolution notice, but the inspected flow does not load a canonical, versioned acquisition-terms document or compute a terms hash before that upsert.
- Uses `deals.status === 'accepted'` as a precondition for Safe deployment and checkout auto-deploys Safe for that status.
- The inspected `js/offer-form-fix.js` creates a `deals` row with `status: 'pending'`; `js/offer-actions.js` delegates offer acceptance to the database RPC `act_on_marketplace_offer`. Its implementation and exact transition rules were not located in the reviewed source files.
- The inspected `js/deal-checkout.js` reads the deal and triggers `create-safe` when status is `accepted`; it does not verify an EIP-712 acceptance pair before that Safe deployment call.

Consequences:
- The current timestamp row is a legacy UI acknowledgement only. It must not be treated as an EIP-712 signature or silently upgraded into cryptographic proof.
- The new acceptance ledger must remain separate from the legacy table until a reviewed cutover is designed. Do not change the existing browser upsert as part of this protocol-only work.
- A server-side transaction must not invent a terms version or hash from a UI label. Before implementation, define a canonical terms source, stable version identifier, and exact canonicalization rules; then make the challenge and finalization gate consume that same immutable snapshot.
- The current Safe status gate must be reviewed so that no new settlement/finalization path can interpret legacy `agreed_at` values as both-party cryptographic acceptance.

## 8. Revised implementation gates

1. Retrieve and review the database definition of `act_on_marketplace_offer` and the exact trigger/RPC path that sets `deals.status = 'accepted'`; confirm all callers and privilege grants.
2. Trace the checkout-to-Safe path and specify a server-side cryptographic finalization gate before any new acceptance can authorize Safe deployment.
3. Define and review canonical terms V1 as an immutable server-owned artifact, including versioning and change policy.
4. Inspect the exact database constraints and grants for `deal_party_agreements`, `deals`, profiles, and the private schema permissions before proposing migration SQL.
5. Implement the atomic acceptance transaction in an isolated database only, with lock/unique-constraint concurrency tests and exact idempotent retry semantics.
6. Integrate the server endpoint behind a disabled feature flag; do not wire the live Deal Room or Safe flow until legacy/new acceptance semantics and rollback are reviewed.

## 9. Deployment gate

Design artifact only. No tables, functions, triggers, policies, migrations, or Edge Functions are created here. Before migration review, verify the actual profile-wallet flow, deal-term versioning source, audit ownership constraints, grants, and deployment identity. Test first in an isolated project with adversarial/concurrency tests. Production migration or deployment requires explicit approval.


## 7A. Additional live-path inspection: offer acceptance and Safe gates

A second read-only inspection of the connected production project and this feature branch found:
- The current branch's `js/offer-actions.js` calls the Postgres RPC `act_on_marketplace_offer`. A read-only catalog lookup in the connected production database returned no matching function in any non-system schema (`to_regprocedure` was NULL). This is an integration mismatch that must be resolved before relying on this browser path; do not assume the RPC exists or that an Edge Function is automatically called instead.
- The production project has active `seller-offer-action` and `seller-offer-action-v2` Edge Functions. The inspected V2 handler authenticates the caller as the seller and updates `deals.status` directly to `accepted` after checking BNB payment configuration. It does not require buyer/seller EIP-712 acceptance rows, a terms version/hash, or an audit binding. The older handler also updates the status directly.
- The production `create-safe` Edge Function checks the caller is a deal participant or admin, requires `status='accepted'`, BNB Chain 56, verified and distinct buyer/seller/platform wallets, and verifies the deployed Safe configuration. It does not load or require the new EIP-712 acceptance pair or a canonical terms hash before deploying the Safe.
- The production `prepare-deal-release` Edge Function checks participant authorization, dispute state, funded/in-progress status, confirmed payment, verified buyer/seller wallets, Safe owners/threshold, and a release-policy RPC. It creates/updates release-policy and multisig records, but the inspected handler does not require the new acceptance ledger pair or signed terms evidence.
- The live Deal Room browser path still stores only `deal_party_agreements.agreed_at`; the branch's `js/w3m-deal-agreement-client.js` is deliberately isolated and is not imported by the live Deal Room.

Security interpretation:
- Offer acceptance, Safe deployment, and release preparation are separate trust boundaries. Each server-side boundary that relies on contractual consent must load and verify the same persisted buyer/seller acceptance pair from trusted storage; a UI check or `deals.status` check is insufficient.
- Safe deployment is not itself proof that both parties agreed to immutable terms. Likewise, release preparation must not infer signed consent from `accepted`, `funded`, or legacy timestamps.
- The missing `act_on_marketplace_offer` database RPC is a production integration discrepancy, not permission to create a replacement function blindly. First identify the actual deployed caller and expected response contract; then reconcile the frontend with the active seller-offer Edge Function in a separately reviewed change.
- These findings are read-only. No Edge Function, database object, Safe, deal, or production record was changed.

## 8A. Updated implementation gates

1. Resolve the frontend `act_on_marketplace_offer` RPC versus deployed seller-offer Edge Function mismatch. Confirm the canonical offer-action endpoint and its callers before editing either.
2. Define canonical immutable terms V1 and a trusted terms source; do not assume `deal_terms.terms_snapshot` is currently populated or authoritative.
3. Implement the acceptance transaction and persist exactly one immutable buyer and seller signature against the same deal, audit binding, fingerprint, and terms version/hash.
4. Add server-side enforcement at offer acceptance where consent is asserted, Safe deployment before any deal-specific escrow creation, and release preparation/finalization before settlement. Each gate must verify persisted acceptance rows, not client claims.
5. Preserve current production behavior while implementing behind an isolated test project/feature flag. Add negative tests proving legacy timestamps and status-only transitions cannot pass the new gates.
6. Reconcile response contracts, auth, RLS/service-role scope, idempotency, race conditions, dispute races, and rollback before any live wiring.


## 9. Canonical acquisition terms V1 — source-of-truth contract

The branch already contains a pure validator/canonicalizer/hash implementation in `supabase/functions/w3m-acquisition-verification/acquisition-terms.ts`. It validates a complete synthetic V1 document and computes a domain-separated SHA-256 hash. It does not load, authorize, persist, version, or publish a real deal's terms.

### 9.1 Required canonical document

The V1 schema identifier is `w3m-acquisition-terms-v1`. The canonical document binds:
- Deal, project, buyer, and seller identifiers.
- Project title/category snapshot.
- Audit ID, owner/repository, full commit SHA, and audit fingerprint digest.
- Exact decimal-string consideration, currency, platform fee, and seller net; fee plus seller net must reconcile exactly to consideration.
- Payment method, BNB Smart Chain ID 56, asset/token contract, and Safe address (which may be null before deployment).
- Included/excluded transfer assets, credentials/access handover, intellectual-property declaration, third-party dependencies, and data/privacy scope.
- Delivery deadline/checklist, inspection window/acceptance criteria, dispute procedure version/text, escrow funding/release conditions, dispute hold, governing-law/venue/language fields, risk acknowledgements, disclosures, creation time, and expiry time.

Monetary amounts are decimal strings, never JavaScript floating-point numbers. The current validator enforces exact fee-plus-net reconciliation; the percentage-to-fee calculation and asset precision/rounding policy must be resolved from trusted payment-token metadata before production acceptance. Do not silently assume two decimal places or trust a client-provided token precision.

### 9.2 Authority and immutability

- The canonical document must be assembled server-side from trusted deal, project, audit-binding, and payment-configuration rows. Client-supplied terms may be proposed input only; they are not authoritative.
- `deal_terms.terms_snapshot` is not authoritative until its writer, actual populated shape, mutation permissions, and update history are verified. No such writer was located in the reviewed frontend branch or the inspected database function catalog.
- Persist the exact canonical JSON bytes (or an equivalently lossless canonical representation), schema identifier, positive version, SHA-256 hash, authoring actor/source, and timestamps in a private server-owned record.
- Once published for signing, a version is immutable. Any material change creates a new version and a new hash; never update a published snapshot in place.
- A new version invalidates outstanding challenges for the prior version. If either party has already accepted the prior version, do not carry that acceptance forward: void the incomplete signing round and require both parties to sign the new version. The safer initial policy is to restart the acceptance round rather than mutate old evidence.
- Expired terms cannot receive new signatures. Expiry and challenge deadline are separate checks; both must be enforced server-side.
- Keep a durable history of superseded versions and reasons without overwriting prior evidence.

### 9.3 Hash and signing contract

- Hash input is the canonical V1 JSON with the domain prefix `w3m-acquisition-terms:v1\n`, using the existing deterministic key ordering and strict JSON-value validation.
- The EIP-712 challenge binds the resulting terms hash and version together with deal/audit fingerprint/binding, party role, expected wallet, one-time nonce, deadline, and BNB Chain 56 domain.
- The server must reconstruct the challenge from the persisted immutable version and current trusted deal/binding state. It must never accept a client-supplied typed-data domain or a client-supplied hash as proof.
- The canonical terms hash is not a legal opinion or a guarantee of enforceability. Governing law, venue, IP warranties, privacy disclosures, and dispute wording require qualified legal review before being presented as final contractual language.

### 9.4 V1 implementation blockers

1. Confirm trusted sources for every field, including project title/category, exact consideration and fee calculation, payment asset decimals, deadlines, transfer checklist, and dispute procedure.
2. Decide the fee rounding rule using trusted token decimals; add tests for tiny amounts, long decimal values, and fee/net reconciliation.
3. Add a private immutable terms-version store and transactional version publication in the isolated test project.
4. Add tests proving a changed term produces a different hash, a superseded version cannot be signed, an expired document cannot be signed, and one party's old acceptance cannot combine with another party's new-version acceptance.
5. Do not label the current synthetic fixture as an actual marketplace agreement or use its sample legal fields in production.



## 9. Follow-up read-only database verification (2026-11-07)

The production Supabase schema and trigger/function definitions were inspected read-only. No schema or data was changed.

### Confirmed deal and identity fields
- `public.deals` contains `id`, `project_id`, `buyer_id`, `seller_id`, `status`, `dispute_status`, `payment_status`, `safe_address`, `chain_id`, and Safe/payment lifecycle fields.
- `public.profiles` contains `wallet_address` and `wallet_verified`; the verified wallet is available as a trusted profile attribute but must be reloaded server-side at acceptance time.
- `public.code_audits` contains `id`, `project_id`, repository owner/name, `commit_sha`, `status`, and completion metadata.
- `public.deal_terms` exists and stores a mutable `terms_snapshot` plus acknowledgement/deadline fields. Its writer and canonical snapshot semantics still require review before it can be the signing source.
- `public.deal_party_agreements` remains a timestamp acknowledgement only. Its update trigger protects identity and an existing `agreed_at` timestamp, but it does not bind an EIP-712 signature to an immutable terms version.

### Critical settlement-path finding
The current `public.enforce_deal_state_transition()` trigger permits `pending -> accepted` without requiring an EIP-712 acceptance pair. The inspected `public.validate_deal_release_policy(uuid)` checks dispute state, confirmed payment, buyer delivery approval, and Safe configuration, but it does not check the new W3M acceptance ledger. The inspected Deal Room code also invokes Safe deployment based on `deals.status = 'accepted'`.

This means the existing `accepted` status is not cryptographic agreement proof and must not be treated as such. Before V1 can be activated, the actual Safe deployment and final release entry points must call a trusted server-side verification gate that reloads persisted acceptances and current evidence, and fail closed. The UI alone is not a security boundary.

### Function lookup
A read-only lookup for a public SQL function named `act_on_marketplace_offer` returned no match. The actual offer-acceptance path therefore remains unresolved and must be traced from the deployed frontend/RPC call and database function catalog before any cutover. Do not assume the earlier function name is accurate.

### Revised blockers before implementation
1. Inspect the exact `deal_terms` definition, writer, and RLS policies; define canonical terms bytes, versioning, and hash without inventing a version.
2. Trace every deployed Safe deployment/release invocation and identify all callable bypass paths.
3. Inspect `code_audit_files` and `code_audit_findings` constraints and RLS for complete trusted manifest loading.
4. Design the append-only private tables and one atomic acceptance RPC/transaction; keep it as an unapplied migration on the feature branch until reviewed.
5. Add a finalization predicate to every relevant server-side settlement entry point; legacy timestamp acknowledgements must never satisfy it.
6. Add integration and concurrency tests for the actual database transaction and Safe gate before deployment.

No production database migration, function deployment, Safe action, or financial transfer was performed.


## 10. Live Edge Function path review (read-only, 2026-11-07)

The active Supabase Edge Functions were inspected without invoking their business operations or changing their deployments.

- `create-safe` authenticates the caller and checks that `deals.status = 'accepted'`, then proceeds with Safe deployment and records the Safe address/policy. The inspected function does not check for a persisted W3M EIP-712 buyer/seller acceptance pair or a W3M audit fingerprint binding before deployment.
- `prepare-deal-release` performs participant, dispute, payment, verified-wallet, Safe-owner/threshold, and release-policy checks. Its inspected source does not check a W3M acceptance ledger.
- `prepare-safe-release-tx`, `record-safe-release-signature`, `execute-safe-release`, and `finalize-safe-release` perform Safe transaction, signer, nonce, receipt, and token-transfer checks in their respective stages. Their inspected source did not show a W3M EIP-712 acceptance-pair gate.
- `finalize-safe-release` verifies Safe execution success and exact seller/platform token transfers before recording completion. This is valuable settlement evidence, but it is not a substitute for pre-deployment agreement verification.

### Consequence for V1
The protocol acceptance gate must be integrated into the earliest relevant server-side path, especially `create-safe`, and rechecked at the release preparation/finalization boundary. The acceptance pair must be loaded from trusted append-only storage and matched to the current deal, participants, terms version/hash, fingerprint, and binding. Until those integrations are implemented and tested in an isolated branch, the W3M protocol must remain non-production and the existing live flow must not be described as enforcing the new protocol.

### Terms snapshot finding
The live `public.deal_terms` table has a single `terms_snapshot jsonb` field, acknowledgement timestamps, deadlines, and created/updated timestamps; the inspected schema has no explicit terms version or terms hash. Its only listed RLS policy is participant SELECT. This does not establish immutable version history. The snapshot writer and all update paths must be traced before canonicalization; V1 must add its own versioned immutable terms record rather than assume the current mutable JSON is already a signed contract.

No live Edge Function was invoked, updated, or redeployed during this inspection.

## 11. Exact catalog constraints and RLS review (read-only, 2026-11-07)

A further catalog query confirmed the following production facts. This section records inspection only; no DDL or data writes were performed.

### 11.1 Referential integrity
- `deals.id` is the primary key. `deals.project_id` references `projects(id)` with ON DELETE CASCADE; buyer and seller reference `profiles(id)` with ON DELETE RESTRICT.
- `code_audits.id` is the primary key; `code_audits.project_id` references `projects(id)` with ON DELETE CASCADE.
- `code_audit_files.audit_id` and `code_audit_findings.audit_id` reference `code_audits(id)` with ON DELETE CASCADE. The inspected files table has no uniqueness constraint on (audit_id, path), and `sha` is nullable.
- `deal_party_agreements` has a unique constraint on (deal_id, party_role), a buyer/seller role check, and foreign keys to deals and auth.users.
- `deal_terms` has a unique constraint on deal_id and a cascading foreign key to deals. Its JSON snapshot is NOT NULL with an empty-object default; this alone does not establish a complete canonical contract.
- The private protocol evidence tables must not inherit cascading deletion from projects, audits, or deals if that could erase acceptance evidence. Before implementation, choose explicit RESTRICT/NO ACTION retention semantics and define a documented archival/retention process. Do not assume cascading foreign keys are safe for immutable legal/security evidence.

### 11.2 RLS and browser-write findings
- `deal_terms` has a participant SELECT policy only in the inspected policy listing; no participant INSERT/UPDATE policy was listed.
- `deal_party_agreements` has participant SELECT, INSERT, and UPDATE policies. INSERT checks that party_id is auth.uid() and the role matches the deal's buyer_id or seller_id. UPDATE has owner checks and a tamper-prevention trigger, but this still represents a timestamp acknowledgement, not a cryptographic signature.
- `code_audit_files` and `code_audit_findings` have authenticated SELECT policies limited to the audit requester or admin. No browser write policy appeared in the inspected listing.
- `deals` has buyer INSERT and participant/admin SELECT policies in the inspected listing; state changes are additionally governed by triggers.

### 11.3 Trigger and writer search
- The inspected non-internal triggers on `deals` include financial-field locks, fee synchronization, state-transition enforcement, sensitive-field protection, and lifecycle audit logging.
- `deal_party_agreements` has a tamper-prevention trigger and audit logging.
- A read-only function-definition search found an audit-log trigger function referencing `deal_party_agreements`; it did not reveal a trusted writer that publishes canonical `deal_terms.terms_snapshot` versions. No authoritative terms writer or version/hash source was established by this inspection.
- The actual offer-action browser code calls `act_on_marketplace_offer`, but the earlier read-only catalog lookup found no matching SQL function. This remains an unresolved deployed integration mismatch; do not invent a replacement RPC.

### 11.4 V1 implementation consequences
1. Treat the current `deal_terms` JSON as untrusted/unversioned until its source and intended semantics are proven. The V1 server must assemble the canonical document from trusted deal, project, audit, and payment data.
2. Before manifest publication, verify each scanned file row is unique by normalized path, scanned, and has a valid Git blob SHA. Existing nullable `sha` and lack of a unique (audit_id,path) constraint require explicit server-side rejection of incomplete or duplicate evidence.
3. Store immutable terms versions, deal-audit bindings, consumed challenges/nonces, and acceptances in a private schema with no browser table grants. Enforce uniqueness and immutability in the database transaction, not only in TypeScript preflight helpers.
4. Use retention-safe foreign-key behavior for protocol evidence. A project/audit/deal deletion must not silently cascade-delete signed acceptance history.
5. Resolve the offer-action endpoint mismatch and canonical terms source before writing the first persistent version or authorizing Safe deployment.
6. Keep the production project read-only until an isolated migration and concurrency/security test suite passes and the user explicitly approves any production change.

## 12. Live acceptance and settlement entry-point verification (read-only, 2026-11-07)

The active Supabase Edge Function source was retrieved read-only from the production project. No function was invoked and no deployment was performed.

### 12.1 Current offer acceptance route
- The Deal Room browser helper calls RPC `act_on_marketplace_offer`, but a read-only `pg_proc` query returned no matching function in any non-system schema.
- The active Edge Function `seller-offer-action-v2` is version 39. It authenticates the seller, loads a pending deal, verifies seller ownership, reads the single enabled BNB Chain payment configuration, and updates the deal to `accepted`. It does not publish W3M terms, bind an audit fingerprint, or collect buyer/seller EIP-712 agreement signatures.
- The browser caller and active deployed offer function therefore do not yet establish one verified, canonical acceptance path. This mismatch must be resolved before protocol integration.

### 12.2 Current agreement UI
- The production `js/deal-room.js` loads `deal_party_agreements` and renders a button labelled “I Agree to Deal Terms”.
- Clicking it directly upserts `deal_id`, `party_role`, `party_id`, and `agreed_at` from the browser. It does not request an EIP-712 signature or call a trusted W3M acceptance endpoint.
- The UI text says “Deal Terms”, but the displayed content is the dispute-resolution notice; no canonical terms-version document is loaded by this section.
- This legacy acknowledgement must not be interpreted as a W3M cryptographic acceptance.

### 12.3 Current deployed Safe and release functions
The following active production Edge Functions were retrieved for source inspection only:
- `create-safe`, version 56, source SHA-256 `d888f48d48c87563e20e43318f9187c0f02d9a46fbe5e037cadbb5520b918e07`: verifies caller identity/participation, deal status `accepted`, BNB chain ID, verified buyer/seller wallets, distinct Safe owners and deployer configuration. It then can broadcast a Safe deployment transaction and persist the Safe/release policy. It does not check a W3M acceptance ledger or signed terms/fingerprint binding. This function is a direct transaction-producing entry point and must be gated server-side before any deployment transaction.
- `prepare-deal-release`, version 43: checks participant identity, dispute state, releasable deal status, confirmed payment, Safe/token configuration, on-chain Safe owners/threshold/nonce and the existing release-policy RPC. No W3M acceptance-pair check is present in the inspected source.
- `prepare-safe-release-tx`, version 37: checks deal/payment/escrow readiness, buyer delivery acceptance, Safe and release details before creating/updating a release transaction. No W3M acceptance-pair check is present.
- `record-safe-release-signature`, version 24: verifies a Safe transaction typed-data signature against a current Safe owner and stores it; this is the Safe transaction signature, not the earlier buyer/seller W3M agreement acceptance.
- `execute-safe-release`, version 28: checks dispute state, two Safe signatures, Safe owners/threshold/nonce and transaction hash before execution. No W3M acceptance-pair check is present.
- `finalize-safe-release`, version 25: verifies the mined Safe transaction and exact token transfers before marking the deal completed. No W3M acceptance-pair check is present.

### 12.4 Required V1 gate coverage
The persisted, exact-version acceptance predicate must be enforced inside every direct server entry point that can:
1. deploy the deal Safe (`create-safe`);
2. prepare the release policy/transaction (`prepare-deal-release`, `prepare-safe-release-tx`);
3. accept or record release signatures where a bypass could otherwise proceed (`record-safe-release-signature`);
4. execute the Safe transaction (`execute-safe-release`);
5. finalize the deal and mark the project sold (`finalize-safe-release`).

The gate must reload evidence from trusted persistence and fail closed on missing, ambiguous, stale, mismatched or unreadable records. UI hiding/disablement is supplementary only.

### 12.5 Terms revision history correction in pure policy
A review of the V1 acceptance helper found that its first draft treated any prior acceptance for a deal/party role as a permanent block and required exactly two total rows per deal. That conflicts with the immutable terms-version lifecycle: a revised terms document must retain old signed acceptances as history while requiring a fresh buyer/seller pair for the new version.

The helper and tests were corrected on this feature branch:
- acceptance uniqueness is now scoped to deal + terms version + party role, while nonce reuse remains rejected;
- reusing an existing version number with a different terms hash is rejected as a version conflict;
- strict finalization filters the exact expected terms version, then requires exactly one buyer and one seller row with matching project/audit/fingerprint/binding/terms evidence;
- older acceptance versions remain retained as historical evidence and do not invalidate the current pair.

This is still pure TypeScript policy logic. It does not replace the required database uniqueness constraints, atomic RPC, trusted Edge Function integration, or integration tests.

### 12.6 Regression verification after terms-history correction
- The first test attempt exposed a TypeScript fixture typo (`termsHash` was used where a persisted record requires `terms_hash`). The fixture was corrected; the implementation itself was not weakened to satisfy the test.
- Corrected feature-branch head: `e4f7b124ad928208c41a202935905a2ac06dd703`.
- GitHub Actions run `42368675810` completed successfully: the complete configured Deno test step passed and the Deno type-check step passed.
- This run verifies the pure module/test suite only. It does not verify a database transaction, production Edge Function, Safe deployment, or settlement flow.


## 13. Frontend-to-server call-path trace (read-only, 2026-11-07)

The feature-branch frontend sources and currently deployed offer/Safe functions were compared. No production code or configuration was changed.

### 13.1 Offer action mismatch is confirmed

The feature-branch `js/offer-actions.js` obtains the authenticated Supabase user and calls:

```ts
client.rpc('act_on_marketplace_offer', {
  p_offer_id, p_action, p_amount, p_currency, p_message
})
```

The active production Edge Function `seller-offer-action-v2` instead accepts `deal_id` and `action` (`accept` or `reject`) and updates `deals.status` to `accepted` after seller-ownership and BNB payment-configuration checks. These are different contracts. The deployed Edge Function does not establish that the browser RPC call reaches it. The earlier read-only database function catalog lookup found no SQL function named `act_on_marketplace_offer`.

**V1 consequence:** do not silently redirect the RPC, create an assumed RPC replacement, or treat `seller-offer-action-v2` as the confirmed browser route. The canonical offer-action contract and intended state transitions must be resolved before wiring acceptance publication. Any acceptance implementation must be independent of the legacy `accepted` status.

### 13.2 Safe deployment direct caller is confirmed

The feature-branch `js/deal-room.js` calls `sb.functions.invoke('create-safe', { body: { deal_id: deal.id } })` after a browser-side check that the loaded deal status is `accepted`. A direct HTTP fallback also posts to the same deployed Edge Function when the SDK reports a fetch error.

The active production `create-safe` function (version 56; source SHA-256 `d888f48d48c87563e20e43318f9187c0f02d9a46fbe5e037cadbb5520b918e07`) independently authenticates the caller, loads the deal and verified buyer/seller wallets, checks participant/admin access, `accepted` status, BNB Chain 56, distinct Safe owners and deployer configuration. It then creates/broadcasts the Safe deployment transaction when needed and persists the Safe/release policy.

The function does **not** load or verify a W3M persisted acceptance pair, immutable terms version/hash, audit fingerprint, or deal-audit binding before it can broadcast the deployment transaction. The browser check is not a security control.

**V1 consequence:** the server-side W3M evidence gate must execute inside `create-safe` before any Safe deployment transaction is constructed or broadcast. Until that gate exists and is integration-tested, this entry point is a production bypass relative to the proposed V1 protocol.

### 13.3 Safe and release gate inventory remains mandatory

The earlier source review still applies: release preparation, Safe transaction preparation, Safe signature recording, execution, and finalization must each enforce the persisted current-version evidence predicate at the appropriate boundary. A Safe transaction signature is not a W3M agreement signature. No function was invoked and no live transaction was attempted during this trace.

### 13.4 Current implementation boundary

This trace establishes two concrete integration facts, but it does not establish an authoritative canonical contract source or a safe transactional persistence design. The production `deal_terms.terms_snapshot` remains mutable/unversioned with no confirmed writer semantics. Therefore no migration, acceptance endpoint, or terms publisher should be written against guessed fields. The next V1 implementation work is limited to tracing the canonical deal/offer terms producer and defining the exact server-owned input contract, followed by an unapplied isolated migration and database-backed tests.

No production database writes, Edge Function deployments, PR merges, Safe calls, or financial transfers were performed.


## 14. Isolated browser agreement-client CI coverage (2026-11-07)

The existing isolated browser coordinator `js/w3m-deal-agreement-client.js` was found to have five focused tests in `deal-agreement-client.test.ts`, but that test file was not included in the W3M protocol CI workflow. This meant its wallet/domain/terms-version checks were not continuously enforced by the branch's normal test run.

The workflow was updated on the feature branch to:
- Trigger on changes to `js/w3m-deal-agreement-client.js` and its Deno test file for both pull-request and branch-push events.
- Include `deal-agreement-client.test.ts` in the protocol test command.

Verification:
- Commit: `7b7157e2eaaa5e779fdfc4d444c23e81683ae88a`
- Pull-request workflow run: `42368975472`
- Result: **74 passed, 0 failed** across nine test files.
- Deno type-check step: success.
- Workflow job: `fingerprint-tests`, conclusion success.

This validates the pure browser coordinator and existing pure modules only. It does not validate a deployed Edge Function, authenticated database persistence, atomic nonce consumption, or Safe/release integration. The client remains isolated and is not imported by the live Deal Room. No production changes or transactions were made.


## 15. Canonical deal-terms source and live schema verification (read-only, 2026-11-07)

### 15.1 Browser-side offer creation is not a terms publisher

The feature-branch `js/offer-form-fix.js` creates a `public.deals` row with only:
- `project_id`, `buyer_id`, `seller_id`
- `amount`, `currency`
- `status = pending`

It may separately add a free-form chat message to `deal_messages`. It does not create a `deal_terms` row, does not publish a canonical terms document, and does not bind a specific audit. The offer form is therefore not a canonical terms publisher.

### 15.2 Checkout and Deal Room currently use different evidence models

`js/deal-checkout.js` reads `deals` as the canonical deal record and, when status is `accepted`, can call `create-safe` automatically if the Safe is not yet deployed. It does not require a W3M acceptance pair before making that call.

`js/deal-room.js` reads legacy `deal_party_agreements` rows and writes timestamp-only agreements from the browser using an upsert. The displayed copy is a short Model B dispute-resolution notice; it is not a complete versioned acquisition agreement and is not an EIP-712 signature.

### 15.3 Production schema facts verified read-only

The live `public.deal_terms` schema contains:
`id`, `deal_id`, `buyer_agreed_at`, `seller_agreed_at`, `dispute_resolution_accepted`, `delivery_deadline`, `inspection_deadline`, `terms_snapshot` (JSONB, default empty object), and timestamps. It has no terms version or digest columns. No non-internal trigger exists on `deal_terms`, and a read-only function-definition scan found no database function referencing `deal_terms` or `terms_snapshot`.

The live schema also has deal-level duplicates for some deadlines and agreement timestamps. The database currently contains two deals, zero `deal_terms` rows, zero legacy timestamp agreement rows in `deal_terms`, and two `deal_party_agreements` rows with `agreed_at` set. These two legacy rows are not cryptographic acceptance evidence and are not counted by the V1 ledger.

### 15.4 Exact unresolved policy inputs

The current V1 terms validator intentionally requires more than a price and a project identifier: project identity, a bound audit and commit fingerprint, exact consideration/fee/net amounts, payment method and chain, transfer scope, access/credentials, intellectual property, data/privacy, delivery checklist and deadline, inspection window and acceptance criteria, dispute procedure, escrow funding/release/hold conditions, governing law/process/language, risk acknowledgements, disclosures, creation and expiry timestamps.

The live `projects` schema has candidate descriptive fields such as `transfer_terms`, `assets`, `domain_ownership`, `github_ownership`, `ownership_declaration`, and `reason_for_sale`; however, no verified application contract currently defines which fields are authoritative, how they are normalized, or whether the seller's declarations are frozen at offer time. The live deal and terms tables also do not define governing-law, inspection-criteria, or complete dispute-procedure policy sources.

**V1 safety decision:** do not automatically copy mutable project metadata into a signed contract, do not infer legal terms from free-form descriptions, and do not fabricate governing-law or dispute clauses. The official V1 terms publisher must consume an explicitly approved, server-owned terms input contract. Until those required inputs have an authoritative source, publication must fail closed and no agreement challenge may be issued.

### 15.5 Data integrity implications for the upcoming isolated persistence design

- Existing `deal_party_agreements` timestamps are historical UI acknowledgements only; they cannot satisfy the V1 signature predicate.
- Existing empty/missing `deal_terms` rows cannot be interpreted as an implicit default agreement.
- The current `deal_terms` unique constraint on `deal_id` supports only one mutable row, not immutable history.
- A future V1 store must append versioned canonical terms and acceptance evidence in a private, server-owned persistence boundary. It must retain historical signed evidence even if a project, deal, or audit lifecycle later changes; foreign-key cascade deletion is not acceptable for the evidence record.
- No production DDL, data writes, Edge Function invocations, deployment, Safe calls, or financial transfers were performed in this verification.


## 16. Placeholder-policy fail-closed validation (2026-11-07)

A further review of `acquisition-terms.ts` found that the validator accepted literal placeholders such as `Pending legal review`, `TBD`, and `Placeholder` in governing-law, dispute, escrow, and inspection policy fields. The test fixture itself used `Pending legal review` for governing-law and therefore demonstrated that a non-final policy value could pass the structural validator.

The validator was hardened to:
- Reject known placeholder values and phrases in required policy text.
- Require non-empty string entries in delivery checklists, inspection acceptance criteria, and risk acknowledgements.
- Apply the policy-text check to inspection window, dispute procedure/version, escrow funding/release conditions, and governing-law/process/language fields.
- Keep all tests synthetic; this validation does not determine legal sufficiency or approve legal terms.

Regression tests now explicitly reject placeholder governing-law, venue, dispute, escrow release, inspection window, and blank checklist/criterion/risk items.

Verification:
- Latest branch head before this documentation update: `297a903fcf7d6c118d47937ba5be0a5efdcf233e`
- Pull-request workflow run: `42369272586` — success.
- Push workflow run: `42369268901` — success.
- Test result: **76 passed, 0 failed** across nine test files.
- Deno type-check: success.

This only closes a structural placeholder-validation gap. It does not establish the truth, enforceability, or legal adequacy of user-supplied terms. The production terms source remains unresolved and no terms can be published from the current live deal flow without an approved authoritative input contract.
