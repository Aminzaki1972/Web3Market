# W3M Buyer Due Diligence — Prototype Design

**Status:** isolated design/prototype only  
**Target:** Web3Market marketplace buyers  
**Branch:** `prototype/w3m-buyer-due-diligence`

## Product boundary

Buyer Due Diligence is an evidence-organizing report that helps a buyer inspect a listed project before making an offer. It is **not** a W3M Passport, investment recommendation, legal opinion, penetration test, smart-contract certification, or guarantee that a project is legitimate or safe.

The official W3M Passport remains a separate identity/status program for eligible, approved Web3Market marketplace listings. Research alone must never create, upgrade, or publish a Passport.

## Prototype contents

- `buyer-due-diligence-demo.html`: standalone, static UI with clearly labelled illustrative data.
- No Supabase client, API calls, external services, secrets, writes, authentication, or production integration.
- The demo can be opened as a static page in a branch preview, if the hosting provider creates one.

## Proposed report sections

1. **Project snapshot** — marketplace listing reference, canonical website, public repository, report timestamp and commit/hash where applicable.
2. **Evidence register** — source URL, source type, observation, collection time, evidence class and confidence.
3. **Technical review** — link to an existing W3M AI Code Audit result; do not silently rerun it or copy its score as an overall trust score.
4. **Risk register** — severity, status (`confirmed`, `likely`, `needs_verification`), evidence, impact and suggested buyer question.
5. **Change history** — timestamped snapshots and material changes only after a properly secured monitoring service exists.
6. **Buyer checklist** — ownership/control, IP and licensing, revenue proof, liabilities, admin access, deployment, contracts, dependencies and handover.
7. **Limitations** — what was not checked, unavailable sources, rate limits, stale evidence and model uncertainty.

## Reuse decisions from legacy Passport research

Potentially reusable as design/logic patterns after a security review:
- Public website metadata and canonical URL extraction.
- RDAP/domain registration lookup.
- Public GitHub repository metadata.
- DeFiLlama public protocol data, where relevant.
- Evidence classification: `verified_public_fact`, `source_claim`, `candidate_only`, `unresolved`.
- Snapshot comparison as a future monitoring concept.

Do **not** copy the old public `research` endpoint as-is. Its public unauthenticated shape (`verify_jwt:false`), wildcard CORS and external fetch workload require a new threat model, abuse controls, quotas and SSRF review. Do not reuse the legacy `monitor` worker until its secret-validation RPC, RLS, tables and authorization model have been independently inspected.

The legacy Passport persistence endpoint currently rejects external issuance (HTTP 410 in the previously reviewed source). Keep that separation.

## Existing W3M Code Audit integration

The existing Code Audit UI and Edge Function already provide repository-level analysis and findings. The future report should reference an audit by its saved audit ID and repository commit SHA, then display its existing result with its original limitations. It must not invent a score when no audit exists.

The audit endpoint is a production service. This prototype does not call it.

## Required security design before any backend work

- Authenticated user session and server-side authorization.
- Verify the user can access the relevant marketplace listing/report.
- Strict URL allow-listing and DNS/IP checks on every redirect; block private, loopback, link-local and metadata IP ranges (IPv4 and IPv6).
- Bounded response size, content types, redirect count, timeout, concurrency and per-user/IP quotas.
- Do not fetch arbitrary user-supplied URLs from a privileged network context.
- Never expose service-role keys or provider secrets to browsers.
- Store source URLs, hashes, timestamps, fetch outcomes and evidence provenance.
- Treat scraped page text and repository content as untrusted data, never as instructions to an AI model.
- Separate raw evidence from model-generated interpretation; preserve source citations.
- Log access and changes; define retention/deletion policy.
- Monitoring must be opt-in, bounded, authenticated and revocable.

## Suggested delivery sequence

1. Review and threat-model the legacy research/monitor code and existing Code Audit data contract.
2. Validate the static UI with sample data only.
3. Design a read-only evidence collector with strict limits and no Passport writes.
4. Test in an isolated, non-production environment with synthetic/public test targets.
5. Security and cost review.
6. Only then request explicit approval for a production integration.

## Acceptance criteria for the prototype

- All sample data is visibly labelled illustrative.
- No network requests or writes are made by the demo.
- No Passport serial or verification badge is generated.
- Evidence and interpretation are visually distinct.
- Missing or unverified information is displayed as unknown, not assumed safe.
- Code Audit results are referenced only when a real saved audit ID and commit are available.
