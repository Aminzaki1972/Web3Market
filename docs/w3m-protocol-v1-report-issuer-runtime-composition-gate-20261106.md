# W3M Protocol V1 — Report Issuer Runtime Composition Gate

Date: 2026-11-06
Branch: `w3m-protocol-v1-isolated-20261105`
Status: isolated engineering contract; no production changes.

## Purpose

Define the minimum safe runtime composition required to turn the existing pure acquisition-report pipeline into an authenticated, authoritative, persisted report issuer. This document is intentionally a gate, not a claim that runtime issuance is complete.

## Verified source state

The isolated branch currently contains:

- `report-issue-request-handler.ts`: authenticated POST boundary. The browser may submit exactly one field, `deal_id`; it rejects extra caller-controlled fields. Its dependencies are injected.
- `unified-evidence-aggregator.ts`: pure aggregation and deterministic decision composition. It explicitly expects provider/source reads to have happened in trusted server-side adapters.
- `protocol-orchestrator.ts`: pure composition of evidence aggregation, report batch construction, trusted signer registry mapping, and cryptographic verification. It does not access Supabase, persist rows, or authorize settlement.
- `report-registry-batch.ts`: canonical report/evidence/event row builder and signing callback. It does not provide key custody or persistence.
- `protocol-service.ts`: orchestrates and persists a prepared batch through the RPC adapter, but its caller must supply authoritative inputs, protected signing, and a server-side RPC client.
- `trusted-signer-registry-adapter.ts` and `signature-verifier.ts`: strict trusted-key mapping and signature policy checks.
- Existing provider adapters include GitHub repository and NiceNIC domain adapters, plus BNB payment/revenue-related adapters. Their presence alone does not establish that every required report evidence type is wired to authoritative production records.

## Non-negotiable trust boundary

The HTTP request may contain only:

```json
{ "deal_id": "<UUID>" }
```

The runtime must derive all of the following server-side:

1. Authenticated actor UUID from the verified Supabase access token.
2. Deal, project, buyer, seller, terms, and current deal state from authoritative database reads.
3. The exact selected Code Audit record and commit SHA; a caller-supplied audit ID or commit SHA is not trusted.
4. Both parties' agreement state from authoritative agreement records.
5. Payment evidence from independently verified chain facts and the persisted payment/deal binding.
6. Buyer acceptance and delivery state from authoritative deal records.
7. Dispute state from the deal and dispute records; any unknown or unresolved state blocks.
8. Seller asset-control and buyer transfer evidence from authenticated provider reads, bound to the exact deal, project, asset, and identities.
9. Optional revenue evidence only when the deal's trusted configuration requires it; its scope must be explicit and verified.
10. Report version, superseded report, issue/expiry timestamps, row IDs, signer key ID, and persistence RPC inputs from server-controlled logic.

Never accept evidence arrays, hashes, statuses, party IDs, wallet addresses, provider event claims, signer key metadata, or settlement flags from the browser.

## Required runtime composition order

1. Validate method, origin/CORS policy, bearer token, JSON shape, and exact UUID `deal_id`.
2. Authenticate the token and resolve the actor UUID.
3. Authorize the actor as a permitted participant/administrator for this report operation using authoritative deal membership.
4. Read a consistent server-side deal snapshot, including project, buyer/seller, deal terms, payment, delivery/acceptance, and dispute state.
5. Resolve the exact Code Audit and required provider records from trusted source tables/APIs. Bind every item to the deal and project; reject stale, missing, ambiguous, or mismatched records.
6. Construct the full `UnifiedEvidenceInput` on the server. The browser must not be able to override any member.
7. Load the current trusted signer registry from the service-role-only status view.
8. Obtain a signature using a protected signer adapter. No private key may be stored in source, browser code, ordinary function configuration, or logs. The chosen key custody service and operational owner must be explicit before a live signer is enabled.
9. Run `prepareAcquisitionProtocolBatch`; this recomputes the deterministic decision, builds the canonical envelope, and verifies the resulting signature against the trusted key registry for SETTLEMENT purpose.
10. Persist the report, evidence rows, and append-only events using the service-role-only batch RPC. Persistence must be atomic and idempotent for a request/report identity.
11. Verify the persisted report identity and immutable contents by reading back the canonical persisted record and recomputing the digest.
12. Return report identity, version, and decision status only. The response must retain `settlement_authorized: false` and `execution_enabled: false`.

Any exception, incomplete source, signer mismatch, persistence ambiguity, or read-back mismatch must fail closed. A retry must not create a second conflicting report version or duplicate registry events.

## Source binding requirements

- Each evidence item must carry a stable source record identity and source version where available.
- Persisted evidence must identify its source table/provider, source record ID, source version, observed time, validity deadline, content hash, and deal/project binding.
- Do not populate `source_table` with guessed names. Resolve the actual table/provider mapping from the live schema and adapters before wiring it.
- GitHub evidence must bind to the exact immutable commit SHA selected by the authoritative audit record.
- NiceNIC/domain evidence must prove current control for the exact agreed domain and account identity, not merely a successful API response.
- BNB payment evidence must be tied to the exact deal, chain 56, expected token/Safe/amount, transaction and receipt facts, and canonical confirmation policy.
- Agreement, acceptance, and dispute evidence must be derived from the authoritative deal-room records, not caller assertions.

## Known blockers before live runtime issuance

| Gate | Current state | Required closure |
|---|---|---|
| Authenticated HTTP boundary | Pure handler exists; injected dependencies | Add a reviewed Edge Function entrypoint and tests for CORS, auth, exact request shape, and response handling |
| Authoritative deal loader | Deal Room read adapters exist for other protocol paths; no complete report-issuer loader established here | Read and bind all report inputs from the actual schema; reject inconsistent snapshots |
| Evidence source composition | Pure aggregator exists; provider adapters exist individually | Map each mandatory evidence type to an authoritative source and test stale/missing/cross-deal cases |
| Trusted signer registry | Isolated registry and verifier exist | Load current registry at issue time from the service-role-only view |
| Protected signing | Callback contract exists | Select and configure an approved protected key custody/signing service; no mock signer in any live path |
| Atomic persistence | Batch RPC adapter and isolated SQL tests exist | Runtime must call only after cryptographic verification; verify atomicity, idempotency, and read-back |
| Production deployment | Not authorized/performed | Separate explicit approval after testnet and security gates |

## Acceptance tests for the runtime issuer

The issuer is not ready until all of these are covered in CI:

- Missing/invalid bearer token; non-POST; disallowed origin; malformed JSON; extra JSON keys; malformed UUID.
- Authenticated non-participant cannot issue a report for another deal.
- Browser-supplied evidence, audit ID, commit SHA, parties, amount, wallets, or signer data are rejected as extra fields.
- Missing deal/project, mismatched buyer/seller, stale audit, wrong commit, missing provider event, wrong asset/domain, or cross-deal evidence blocks issuance.
- Payment mismatch, unconfirmed receipt, invalid chain/token/Safe/amount, unresolved dispute, or unaccepted delivery blocks issuance.
- Signer unavailable, revoked, expired, unknown, wrong-address, high-S, malformed, or fake signature blocks before persistence.
- Persistence failure rolls back the entire batch; duplicate/replayed issuance is idempotent and cannot create conflicting active versions.
- Read-back digest mismatch blocks the response.
- PASS, INCOMPLETE, BLOCKED, and REVIEW_REQUIRED outcomes are preserved exactly.
- Every successful response explicitly reports no settlement authorization and no execution enablement.

## Explicit non-actions

This work does not select a key custody vendor, create or store a private key, read or write production business rows, apply migrations, change production policies, deploy an Edge Function, call Safe, sign with a real wallet, broadcast a transaction, or move funds.

## Next implementation sequence

1. Inspect and map the exact authoritative source tables for each mandatory evidence type; record only schema facts verified from the repository/database metadata.
2. Implement a server-only deal/evidence snapshot loader with strict typed mapping and consistency checks.
3. Implement the report-issuer Edge Function entrypoint around the existing request handler and protocol service.
4. Keep the signer adapter disabled until a protected key custody service is explicitly selected and configured.
5. Add runtime integration tests with fake database/provider/signer adapters, then run the isolated CI workflow.
6. Only after those pass, perform a BNB testnet lifecycle and independent security review.

**Readiness rule:** the pure report engine is not a trusted live issuer. A report cannot be treated as settlement authorization merely because its decision status is PASS.
