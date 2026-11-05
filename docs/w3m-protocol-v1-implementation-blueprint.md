# W3M Protocol V1 — Isolated Implementation Blueprint

**Status:** Feature-branch scaffold only  
**Branch:** `w3m-protocol-v1-isolated-20261105`  
**Production impact:** None intended. This branch must not be merged or deployed without explicit owner approval.

## 1. Objective

Introduce a deal-specific, evidence-driven verification layer between Deal Room and the existing Safe Multi-Sig settlement workflow.

The protocol is not a replacement escrow. Safe remains the custody and transaction-execution layer. W3M Protocol V1 produces a signed, time-bounded decision report and the backend settlement path must independently validate that report before preparing or executing a release.

## 2. Existing components identified in the repository

- Deal Room UI and client logic: `deal-room.html`, `js/deal-room.js`.
- Deal lifecycle and related records are referenced by existing SQL audit migrations, including `deals`, `deal_disputes`, `deal_party_agreements`, and `deal_multisig_transactions`.
- AI Passport Edge Function: `supabase/functions/public-project-passport/index.ts`.
- AI Code Audit Edge Function: `supabase/functions/w3m-code-audit/index.ts`. Completed audit records pin the repository commit SHA.
- Existing Safe release client calls are visible in `js/release-signing-fix.js` and `diagnostics/safe/deal-room-safe-diag-20260920-r3.js`.

## 3. Important integration gap

The production Safe settlement Edge Function implementations are not present in this repository tree under the expected `supabase/functions/<function-name>/index.ts` paths. The browser calls functions such as `prepare-deal-release`, `prepare-safe-release-tx`, and the Safe execution/finalization functions, but their server-side source is not currently available here to patch and review.

Therefore this branch deliberately does **not** change Deal Room behavior or claim that the settlement gate is enforced. Before integration, the authoritative Edge Function source must be brought under version control or otherwise made available for a controlled staging-only change. Do not attempt to infer or replace production function code from frontend calls.

## 4. New isolated database scaffold

Migration `20261105210000_w3m_protocol_v1_evidence_registry.sql` adds three new tables:

### `w3m_acquisition_reports`
Immutable report versions bound to a deal and project. Includes report version, status, engine version, evidence hash, report hash, signature metadata, issue time, expiry time, and supersession reference.

### `w3m_acquisition_evidence`
Evidence references and outcomes for a specific report. Supported categories:
- Project identity
- Code audit
- Ownership/control
- Asset transfer
- Deal agreement
- Payment
- Buyer acceptance
- Dispute check

### `w3m_acquisition_report_events`
Append-only lifecycle metadata for report creation, evidence attachment, signing, supersession, expiry, and settlement gate decisions.

All three tables have RLS enabled. Browser roles receive no privileges. Only server-side service-role functions receive SELECT/INSERT privileges. The service-role key must never be exposed to the browser.

The schema intentionally stores deal/project identifiers as text until the actual deployed column types and constraints are verified. This avoids guessing foreign-key types or creating an accidental dependency on production schema details.

## 5. Report decision rules

Allowed report statuses:
- `PASS`
- `INCOMPLETE`
- `BLOCKED`
- `REVIEW_REQUIRED`

A report may be `PASS` only if every mandatory evidence category required for that deal is present, current, successfully verified, and bound to the exact deal/project/parties/terms. A high Code Audit score cannot compensate for missing ownership or transfer evidence.

The report signature must cover a canonical envelope containing at least:
- Protocol and engine version
- Report ID and report version
- Deal ID and Project ID
- Buyer and seller references
- Exact Code Audit ID and commit SHA
- Evidence manifest hash
- Deal terms/payment reference
- Issue and expiry timestamps
- Decision status

The server must validate the signature against an active verifier key. Key rotation/revocation and signer authorization must be handled server-side. A hash proves integrity of submitted bytes; it does not prove that a claim is true.

## 6. Required backend workflow

1. Authenticate the caller and establish deal participation or trusted system context.
2. Load the canonical deal, project, agreement, payment, dispute, delivery, Passport, and Audit records server-side.
3. Pin the exact completed audit and commit SHA used as evidence.
4. Evaluate each mandatory evidence category independently.
5. Generate a canonical evidence manifest and SHA-256 digest.
6. Assign one of the four decision states. Never default missing evidence to PASS.
7. Persist the immutable report, evidence rows, and event records.
8. Sign the report envelope with the configured verifier key.
9. Return only the report summary and safe references to authorized Deal Room participants.

## 7. Settlement gate requirements

The gate must be added to the authoritative server-side settlement path, not only to the browser UI.

Before preparing a Safe release and again immediately before execution, the backend must verify:
- The referenced report exists and belongs to the exact deal.
- The latest report version is PASS and has not been superseded.
- The report signature and signer key are valid and not revoked.
- The report has not expired.
- The evidence manifest still matches the report hash.
- The exact audit commit remains the commit accepted for the deal.
- Payment is confirmed by the existing trusted payment-verification path.
- Buyer delivery acceptance is recorded.
- No unresolved dispute exists.
- Safe address, chain, token, amount, fee split, owners, threshold, nonce, and signatures match the existing release policy.
- The release has not already been finalized.

Any missing, stale, mismatched, expired, or unverifiable condition must fail closed.

## 8. Critical decisions before full integration

- **Custody:** retain existing Safe Multi-Sig; do not deploy the separate escrow contract from the earlier prototype.
- **Evidence truth:** define what proves domain, repository, cloud account, wallet, social account, and other asset control. Seller declarations alone are insufficient.
- **Asset transfer:** define per-asset proof and buyer acceptance. A generic checkbox is not proof of transfer.
- **Disputes:** an open dispute blocks settlement. Dispute resolution must follow the existing authorized process; no unilateral hidden bypass.
- **Expiry/revalidation:** changes to material deal terms, repository commit, ownership, payment, asset list, or dispute state invalidate or require a new report.
- **Test isolation:** use a disposable Supabase project and BNB Testnet only. Do not point test clients at production URLs or production secrets.

## 9. Current scope and non-scope

### Included in this branch
- Initial database schema draft.
- Integration blueprint and security requirements.
- No production database operations.

### Not yet implemented
- Acquisition Verification Edge Function.
- Verifier key management and report signing.
- Passport/Audit/ownership/delivery evidence adapters.
- Safe settlement gate integration.
- Deal Room report panel.
- End-to-end staging verification.

### Explicitly prohibited in this phase
- Merging to `main`.
- Applying migrations to production.
- Deploying Edge Functions to production.
- Changing Cloudflare production settings.
- Changing Safe owners, thresholds, addresses, or funds.
- Replacing the existing Safe settlement flow.

## 10. Completion criteria for V1

V1 is not complete until staging evidence demonstrates that:
1. Missing report cannot prepare or execute settlement.
2. INCOMPLETE, BLOCKED, and REVIEW_REQUIRED reports cannot settle.
3. A report for another deal/project/party is rejected.
4. Expired, superseded, or invalidly signed reports are rejected.
5. Material evidence changes require revalidation.
6. Open disputes block settlement.
7. Duplicate release is impossible.
8. Existing Safe policy and on-chain finalization checks remain enforced.
9. The test environment is demonstrably isolated from production.

**Current conclusion:** The repository contains useful source components and an isolated evidence-registry scaffold has now been started. The protocol is not yet integrated or active. The main blocker for safe settlement integration is obtaining the authoritative server-side Safe Edge Function source in the repository/staging workflow.
