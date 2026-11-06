# W3M Protocol V1 — mandatory evidence source map
Date: 2026-11-06
Branch: `w3m-protocol-v1-isolated-20261105`
Status: repository-source review only; isolated design artifact.

## Purpose and trust boundary

This map identifies candidate evidence sources that exist in the repository and the work still required to load them authoritatively for a signed Acquisition Verification Report. It does not claim that any draft migration is deployed, that a live database has these objects, or that a provider credential is configured.

The browser may submit only a deal identifier and user-authored statements that are explicitly treated as claims. The server must resolve identities, deal state, terms, provider observations, payment and agreement records from trusted sources. A provider response is evidence only when its subject, account/repository/domain identity, freshness, request provenance, and expected counterparty are checked. Missing, stale, ambiguous, or contradictory evidence must produce REVIEW_REQUIRED/BLOCKED, never PASS.

## Source map

| Evidence family | Repository-verified candidate | What it can prove | Current limitation / required runtime rule |
|---|---|---|---|
| Deal identity and parties | Isolated `w3m_read_dealroom_terms_snapshot(uuid)` reader; underlying `deals`, `deal_release_policies`, `projects`, `profiles` | Current deal/project/buyer/seller IDs, configured terms, wallets, Safe/token and policy snapshot | Reader is a draft migration and not proof of live schema. Server must authenticate actor and confirm actor is buyer or seller; independently compare all parties and project owner. |
| Canonical commercial terms | `w3m_current_deal_terms_json`, `w3m_deal_terms_versions` | Deterministic terms object/hash and immutable version | Draft agreement migrations only. Re-read and recompute before report issuance and again before PREPARE/FINALIZE; never trust client-supplied terms/hash. |
| Buyer/seller agreement | `w3m_deal_agreement_acceptances`; EIP-712 typed-data service and verifier | Signature recovery against verified party wallet and exact terms version/hash | Both parties must have accepted the same current version. A signature record alone is insufficient if wallet verification or terms have since changed. |
| Code audit | Existing `public.code_audits` and related audit feature; audit V2 migration adds `audit_type`, `payment_order_id`; report references need exact audit ID and repo identity | Audit status, engine/scope, project association, repo URL, score/findings where present in the selected audit record | Select only an audit tied to this deal's project and exact repository identity; reject failed/in-progress/stale audit. Verify engine version and immutable source commit, not merely latest score or browser-provided URL. Need inspect base table schema and audit service before writing a typed loader. |
| Paid audit payment | `public.audit_payment_orders`; `verify-audit-payment/payment-verification.ts` | Order price, chain 56, approved BNB-Peg BSC-USD contract, recipient, amount, unique tx hash, exact Transfer log and canonical block | Audit payment is a service payment, not proof that the deal purchase consideration was paid. Never use it as deal escrow evidence. Migration is review-only and payment verifier currently represents audit checkout. |
| Deal escrow / release policy | `deals`, `deal_release_policies`; Deal Room snapshot reader; Safe attempt/receipt/finalizer modules | Deal amount, fee split, seller/platform wallets, Safe/token/nonce and release policy | Must distinguish locked policy from live execution state. Verify chain, Safe, token, amount and recipients from fresh DB snapshot and canonical receipt. No transaction broadcast or release is authorized by report issuance. |
| Dispute state | Deal Room snapshot reader exposes the deal dispute state; SQL dispute guard checks deal dispute status plus unresolved dispute rows | Whether the deal is in a permitted undisputed state | Repository source review has not yet established a complete authoritative dispute-row loader and all relevant dispute status vocabularies. Preserve strict `dispute_status = 'none'` compatibility gate and block unknown/unclassified/open states. |
| GitHub repository/control | `github-repository-adapter.ts` and tests | Immutable GitHub repository ID, owner account ID/type, visibility, archived/disabled/fork state, default branch, authenticated account identity and admin permission observation | A metadata snapshot is not a transfer. Require exact repository ID and expected seller/buyer GitHub account IDs; admin permission alone is not proof of legal ownership. Transfer execution remains disabled; require fresh authenticated observations and explicit party approvals. |
| Domain ownership/control | `nicenic-domain-adapter.ts` and tests | Provider-backed domain identity and control observations supported by the adapter | Provider API capability/credential and exact domain/account binding must be verified at runtime. DNS text, screenshots, or a browser claim are not provider-confirmed ownership. Do not treat registrar data as proof of website/source-code ownership. |
| Asset transfer | Asset-transfer orchestrator plus GitHub/NiceNIC adapters | Provider-specific transfer readiness/approval evidence for supported asset types | Each asset type needs a registered adapter, exact immutable asset ID, from/to account IDs, fresh provider response, and explicit seller/buyer approval. Unsupported asset types remain REVIEW_REQUIRED. |
| Report signature and registry | `w3m_acquisition_reports`, `w3m_acquisition_evidence`, `w3m_acquisition_report_events`; batch RPC; trusted signer registry/verifier | Append-only report/evidence/event persistence and trusted issuer signature verification | `w3m_*` is the canonical isolated V1 ledger. The separate `acquisition_*` schema is not wired to the current registry adapter. Protected key custody and full issuer runtime composition remain unimplemented. |

## Runtime composition contract

1. Authenticate the request with the shared strict Bearer parser; derive actor ID from verified auth context, never from request JSON.
2. Accept only a validated `deal_id` from the browser. Load deal, parties, project, policy and dispute state from authoritative server-side sources.
3. Load the current immutable terms version and both party acceptances. Recompute canonical terms/hash and verify both signatures against the currently verified party wallets.
4. Resolve the exact project repository and/or domain asset identifiers from the accepted listing/deal record. Do not infer them from user-submitted URLs.
5. Load the exact eligible code audit record, including engine version, completion state, repository ID/full name, immutable commit SHA, and findings/report digest. If any required field cannot be selected unambiguously, stop.
6. Run provider adapters server-side with least-privilege credentials. Persist raw provider response digests, normalized observations, provider request IDs, fetched-at timestamps, adapter versions, and immutable subject IDs. Never persist credentials or expose provider response secrets.
7. Load payment and escrow evidence into separate evidence namespaces. Audit checkout payment must never be conflated with deal consideration or Safe release.
8. Aggregate evidence deterministically. Any missing, stale, mismatched, contradictory, unsupported, or revoked evidence must prevent PASS.
9. Sign only through an explicitly selected protected key-custody service. Until one is chosen and configured, issuer signing stays disabled; no mock/test private key may be used in a live path.
10. Persist the report/evidence/events atomically through the canonical `w3m_*` registry RPC, read the report back, recompute the canonical digest, and verify the persisted signature before returning it.
11. The response must keep `settlement_authorized: false` and `execution_enabled: false`. Report issuance is not a payment instruction or a Safe execution authorization.

## Required test matrix before runtime wiring is considered complete

- Actor not in deal; buyer/seller swapped; project owner mismatch.
- Deal or policy changed between initial read and report persistence.
- Only one party accepted; parties accepted different terms versions; wallet changed/revoked/unverified.
- Audit belongs to another project/repository; wrong GitHub repository ID; wrong immutable commit; audit incomplete/failed/stale.
- GitHub owner/account mismatch; fork/archived/disabled/private repository; missing admin permission; provider 401/403/404/429/5xx and malformed payload.
- Domain subject mismatch, provider account mismatch, stale provider response, unavailable registrar adapter.
- Missing, duplicate, open, unknown, or unclassified dispute state.
- Audit-payment order paid but deal consideration unpaid; deal escrow receipt present but audit payment absent; ensure namespaces cannot substitute for one another.
- Duplicate evidence identity, duplicate registry batch, replayed report, stale signer, signature mismatch, read-back digest mismatch.
- Any source unavailable or inconsistent => REVIEW_REQUIRED/BLOCKED; no signed PASS.

## Repository evidence reviewed

- `supabase/functions/w3m-acquisition-verification/github-repository-adapter.ts`
- `supabase/functions/w3m-acquisition-verification/nicenic-domain-adapter.ts`
- `supabase/functions/w3m-acquisition-verification/deal-agreement-service.ts`
- `supabase/functions/verify-audit-payment/payment-verification.ts`
- `supabase/migrations/20261102000100_audit_v2_contracts_and_payment_orders.sql`
- `supabase/migrations/20261102000200_audit_v2_guest_checkout.sql`
- `supabase/migrations/20261107010000_w3m_protocol_v1_dealroom_terms_reader.sql`
- `supabase/migrations/20261107040000_w3m_protocol_v1_deal_agreement_acceptances.sql`
- `supabase/migrations/20261105210000_w3m_protocol_v1_evidence_registry.sql`

## Explicit non-claims

This is a source-derived map, not a live Supabase schema inspection. No production or connected database was queried; no migration was applied; no Edge Function was deployed; no signing key was created; no provider credentials were read; no Safe transaction or funds were touched.

## Critical sequencing finding — first-report / agreement circular dependency

A source review after the isolated CI pass found a first-deal deadlock that the current SQL fixture sequence does not expose.

### Verified dependency chain

1. `w3m_current_deal_code_audit_json(deal_id)` reads the latest `w3m_acquisition_reports` row and its mandatory `CODE_AUDIT` evidence to construct the current audit binding.
2. `w3m_current_deal_terms_json(deal_id)` embeds that result in the canonical terms object.
3. `w3m_read_deal_agreement_signing_snapshot(deal_id)` calls the terms/audit readers.
4. `prepareDealAgreementAcceptance`, `w3m_register_deal_terms_version`, and `w3m_insert_deal_agreement_acceptance` all require a non-null current Code Audit binding.
5. The final acquisition report is expected to include `DEAL_AGREEMENT` evidence proving both parties accepted the terms.

Therefore, when no prior W3M report exists, agreement signing cannot start; when agreement signing cannot start, the first complete report cannot be issued. The SQL test fixture currently inserts a prior PASS report and CODE_AUDIT evidence before it creates the acceptance records, so it exercises the already-seeded path and masks the first-issuance deadlock.

### Required V1 correction — independent immutable Audit Manifest snapshot

Do not weaken the report's Code Audit evidence and do not fabricate a preliminary PASS report. Introduce a separate pre-agreement audit-manifest snapshot lifecycle:

- A trusted server loader selects the exact completed `code_audits` row for the deal's project and canonical repository, then loads every `code_audit_files` and `code_audit_findings` page.
- Recompute the complete `w3m-audit-manifest-v1` digest from the full persisted rows.
- Persist the manifest snapshot independently of `w3m_acquisition_reports`, keyed uniquely to the exact audit ID and bound to project ID, repository owner/name/URL, commit SHA, audit type, completion time, manifest version/hash, and file/finding counts.
- Permit writes only through a narrowly scoped service-role RPC. The RPC must independently check the completed audit identity, project/repository binding, immutable commit and counts; never accept browser-supplied audit evidence or digest as authoritative.
- Make the signing snapshot and canonical deal terms read this independent immutable manifest snapshot. The report issuer must recompute the manifest from source rows and compare it with the same snapshot before issuing the report.
- Keep final report evidence as a separate report-specific row referencing the exact audit ID, commit SHA, and manifest digest. Agreement signatures bind the audit snapshot; the report then proves the same complete manifest.
- Preserve the existing completed-audit immutability guard and fail closed on missing, duplicate, stale, mismatched, or unrecomputable snapshots.

### Mandatory regression tests before changing the current agreement migration

- First deal: completed Code Audit exists, but no W3M acquisition report exists; buyer and seller can prepare and accept the same terms version.
- The first report can then be issued only after both acceptances exist and must reference the exact same audit ID, commit SHA, and manifest digest.
- Wrong project, repository, audit ID, commit, audit type, completion timestamp, manifest hash, file count, or finding count is rejected.
- Missing or stale manifest snapshot blocks signing and report issuance.
- Any source file/finding mutation after audit completion is rejected; recomputation mismatch blocks issuance.
- A later audit or changed project repository invalidates the previous binding and requires a new terms version and both new acceptances.
- No report, agreement, or settlement path can use a client-supplied manifest digest.

### Release status

This is a repository-source finding and design correction only. No migration was changed or applied, no production database was queried or modified, no Edge Function was deployed, and no signing key or provider credential was created. The current green CI run proves the existing isolated tests pass; it does not prove the first-report lifecycle is free of this deadlock.

