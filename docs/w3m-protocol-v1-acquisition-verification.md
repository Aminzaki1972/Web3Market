# W3M Protocol V1 — Acquisition Verification Contract

## Scope

W3M Protocol V1 is an evidence-driven acquisition verification layer over the existing Web3Market Deal Room and Safe{Wallet} multi-signature settlement flow. It is not a replacement escrow contract and does not independently establish legal ownership.

All work in this branch is isolated. No production database migration, Edge Function deployment, website deployment, or Safe transaction has been performed by this change.

## Core records

The intended V1 domain records are:

- `acquisition_reports`: one versioned verification envelope per deal/report revision.
- `acquisition_evidence`: content-hashed references to Passport, code audit, repository commit, ownership, delivery, payment, agreement, and wallet-signature evidence.
- `acquisition_report_signatures`: EIP-712 acknowledgements over the exact report digest.
- `acquisition_report_events`: append-only state-transition history.

A preliminary schema is present in `supabase/migrations/20261106000100_w3m_protocol_v1_acquisition_verification.sql`.

## Verification state machine

- `draft`: evidence is still being assembled.
- `pending_review`: evidence manifest is frozen for verification.
- `pass`: all required evidence checks succeeded for this report revision.
- `blocked`: one or more mandatory checks are absent, failed, or inconsistent.
- `rejected`: the report was explicitly rejected.
- `expired`: the report's verification validity window ended.
- `revalidation_required`: a dependency changed, such as the audited repository commit or deal evidence.

A PASS must include a manifest hash and verification timestamp. A later evidence or source-commit change must not silently preserve PASS; it creates a new report revision or moves the current report to revalidation.

## Evidence and signature rules

1. Evidence is represented by a SHA-256 content hash and a typed evidence category. Store references and minimal metadata, not private documents or secrets.
2. Repository evidence must bind to the exact 40-character commit SHA. A branch name alone is not immutable evidence.
3. The report digest covers the deal identifier, report version, evidence manifest hash, source commit SHA (when applicable), decision, expiry, and protocol version.
4. EIP-712 signatures acknowledge that exact digest. The verifier must recover the signer address and compare it with the verified wallet bound to the relevant deal participant.
5. Signatures do not move funds, do not replace Safe owner confirmations, and do not themselves authorize execution.

## Verified implementation snapshot (2026-11-06)

The following is confirmed by source inspection on this isolated branch:

- The connected-wallet package endpoint loads a fresh Deal Room context, current BNB Safe facts, the persisted report bundle, trusted signer registry, and verifies the report before it issues a package.
- The package context composes the deterministic settlement gate with payment confirmation, buyer delivery acceptance, dispute state, Safe configuration, and report validity.
- The wallet submission endpoint records the browser-returned transaction hash as unverified. It does not treat the hash as proof of execution and does not finalize a deal.
- The finalization endpoint independently reads the attempt snapshot, fetches the BNB Chain receipt, checks canonical block/confirmations, Safe execution events, and exact seller/platform token transfers before calling the atomic finalization RPC.
- The browser finalization helper sends only the attempt ID and accepts only a server response with state `CONFIRMED`.

## Critical integration gaps — do not mark V1 complete yet

1. **Finalization-time acquisition revalidation:** the current finalization snapshot adapter verifies the attempt, package, participants, transaction state, Safe/token/recipient/amount bindings and receipt evidence, but the inspected adapter does not reload and revalidate the latest acquisition report/evidence/signatures at finalization time. Add a server-side finalization gate that checks the same report revision and current evidence state immediately before the atomic finalize RPC. Any unavailable or changed mandatory evidence must block.
2. **Registry schema alignment:** the runtime report loader currently reads `w3m_acquisition_reports`, `w3m_acquisition_evidence`, and `w3m_trusted_signer_key_status`. The new preliminary migration creates a separate `acquisition_reports` / `acquisition_evidence` / `acquisition_report_signatures` / `acquisition_report_events` set. These are not interchangeable. Decide and implement a deliberate migration/adapter path before applying the new migration to any database.
3. **Database contract verification:** inspect the existing RPC definitions for package issuance, attempt snapshot, submission recording, and atomic finalization. Confirm that each RPC binds the report ID/version and deal terms to the exact execution attempt and rejects stale or disputed state. Do not infer this from the TypeScript adapter alone.
4. **End-to-end verification:** run deterministic unit tests and isolated database integration tests for PASS, BLOCKED, EXPIRED, changed evidence/commit, missing or revoked signer, disputed deal, duplicate submission, receipt reorg/insufficient confirmations, wrong Safe event, wrong token/recipient/amount, and idempotent finalization.
5. **Deployment boundary:** do not deploy Edge Functions, apply migrations to production, connect the new path to the live Deal Room, or submit a real Safe transaction until the above checks pass and the owner explicitly approves a separate deployment step.

## Security boundaries

- Registry tables must be protected by RLS and must not be directly writable by anon/authenticated clients. Edge Functions must authenticate the caller, authorize deal participation, and use service_role only server-side.
- Event history is append-only.
- No secrets, private keys, seed phrases, or raw wallet credentials belong in these tables.
- A protocol PASS is a workflow decision based on configured evidence checks; it is not a legal opinion, independent smart-contract audit, guarantee against fraud, or proof of title.

## Next implementation sequence

1. Inspect the SQL definitions behind the existing W3M registry and Safe RPCs; map their actual inputs, locks, invariants, and returned states.
2. Align the preliminary acquisition schema with the runtime registry, or explicitly build and test an adapter/migration that preserves historical report integrity.
3. Implement finalization-time report/evidence/signature revalidation inside the trusted server-side transaction boundary, not in browser code.
4. Add adversarial tests for evidence changes between package issuance and finalization, report expiry, signer revocation, and dispute opening during the package window.
5. Run all isolated tests and inspect CI results. Apply the schema only to a dedicated test database after compatibility and RLS review; production remains untouched.
