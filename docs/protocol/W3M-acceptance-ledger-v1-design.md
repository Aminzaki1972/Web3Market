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
