# W3M Protocol V1 — Acquisition Verification Contract

## Scope

W3M Protocol V1 is an evidence-driven acquisition verification layer over the existing Web3Market Deal Room and Safe{Wallet} multi-signature settlement flow. It is not a replacement escrow contract and does not independently establish legal ownership.

All work in this branch is isolated. No production database migration, Edge Function deployment, website deployment, or Safe transaction has been performed by this change.

## Core records

- `acquisition_reports`: one versioned verification envelope per deal/report revision.
- `acquisition_evidence`: content-hashed references to Passport, code audit, repository commit, ownership, delivery, payment, agreement, and wallet-signature evidence.
- `acquisition_report_signatures`: EIP-712 acknowledgements over the exact report digest.
- `acquisition_report_events`: append-only state-transition history.

The schema is introduced by `supabase/migrations/20261106000100_w3m_protocol_v1_acquisition_verification.sql`.

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

## Settlement gate — required integration, not yet wired

Before any release transaction can be prepared or executed, the server-side release path must independently load the latest report for the deal and require all of the following:

- report status is `pass`;
- report has not expired;
- evidence manifest hash is present and matches the stored evidence set;
- the exact required evidence categories are verified;
- the report's repository commit matches the commit referenced by the accepted code audit, where repository audit evidence is required;
- required buyer/seller acknowledgements are valid for the exact report digest;
- deal is not disputed, cancelled, or otherwise ineligible;
- the Safe address, chain, transaction target, calldata, and threshold are independently validated by the existing Safe release logic.

Any missing, stale, mismatched, or unavailable mandatory evidence must fail closed. Recheck the gate at both release preparation and immediately before Safe execution; never trust a client-supplied PASS flag.

## Security boundaries

- Tables are RLS-enabled and deny direct access to anon/authenticated roles. Edge Functions must authenticate the caller, authorize deal participation, and use service_role only server-side.
- Event history is append-only.
- No secrets, private keys, seed phrases, or raw wallet credentials belong in these tables.
- A protocol PASS is a workflow decision based on configured evidence checks; it is not a legal opinion, independent smart-contract audit, guarantee against fraud, or proof of title.

## Remaining implementation

1. Implement authenticated Edge Functions to create reports, add evidence, compute canonical manifests, verify evidence, and validate EIP-712 signatures.
2. Add deterministic unit tests for manifest ordering/hash stability, signature recovery, authorization, expiry, commit mismatch, and state transitions.
3. Integrate the server-side PASS gate into both `prepare-deal-release` and the Safe execution endpoint.
4. Add end-to-end tests for PASS, BLOCKED, EXPIRED, changed commit, missing signature, disputed deal, and Safe transaction mismatch.
5. Review and apply the migration only in a dedicated test database. Do not apply it to production until schema compatibility and RLS are verified.
