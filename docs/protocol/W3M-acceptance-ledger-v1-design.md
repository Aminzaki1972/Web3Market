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
- Uses `deals.status === 'accepted'` as a precondition for Safe deployment, so the existing acceptance/status transition must be traced before changing any acceptance semantics.

Consequences:
- The current timestamp row is a legacy UI acknowledgement only. It must not be treated as an EIP-712 signature or silently upgraded into cryptographic proof.
- The new acceptance ledger must remain separate from the legacy table until a reviewed cutover is designed. Do not change the existing browser upsert as part of this protocol-only work.
- A server-side transaction must not invent a terms version or hash from a UI label. Before implementation, define a canonical terms source, stable version identifier, and exact canonicalization rules; then make the challenge and finalization gate consume that same immutable snapshot.
- The current Safe status gate must be reviewed so that no new settlement/finalization path can interpret legacy `agreed_at` values as both-party cryptographic acceptance.

## 8. Revised implementation gates

1. Identify the authoritative deal-terms source and any existing deal status transitions that set `accepted`.
2. Define and review canonical terms V1 as an immutable server-owned artifact, including versioning and change policy.
3. Inspect the exact database constraints and grants for `deal_party_agreements`, `deals`, profiles, and the private schema permissions before proposing migration SQL.
4. Implement the atomic acceptance transaction in an isolated database only, with lock/unique-constraint concurrency tests and exact idempotent retry semantics.
5. Integrate the server endpoint behind a disabled feature flag; do not wire the live Deal Room or Safe flow until legacy/new acceptance semantics and rollback are reviewed.

## 9. Deployment gate

Design artifact only. No tables, functions, triggers, policies, migrations, or Edge Functions are created here. Before migration review, verify the actual profile-wallet flow, deal-term versioning source, audit ownership constraints, grants, and deployment identity. Test first in an isolated project with adversarial/concurrency tests. Production migration or deployment requires explicit approval.
