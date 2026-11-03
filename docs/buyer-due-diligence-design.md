# W3M Buyer Due Diligence — Buyer Dashboard Prototype

**Status:** isolated design/prototype only  
**Target:** authenticated buyer dashboard only  
**Branch:** `prototype/w3m-buyer-due-diligence`

## Product placement and access boundary

This feature belongs **only inside the signed-in buyer dashboard**. It is not a public website page, public project badge, seller dashboard feature, or general visitor tool.

- Entry point: Buyer Dashboard → **Project Due Diligence**.
- A buyer starts a report from a marketplace listing they are permitted to view.
- Reports and buyer notes are private to the requesting buyer by default.
- Sellers do not receive access to the buyer's private report, saved notes, or decision history.
- Seller-provided facts may be included only as clearly labelled claims/evidence, not as verified facts.
- Access must be enforced server-side on every read, create, update, export and delete operation. Hiding a menu item is not authorization.
- A buyer must not be able to inspect private repositories, non-public listing data, seller accounts, internal platform records, or another buyer's reports.
- Any future seller response or shared report must require a separate, explicit sharing action and a clearly scoped shared copy. It is not part of this prototype.

The official W3M Passport remains a separate identity/status program for eligible, approved Web3Market marketplace listings. Due Diligence research never creates, upgrades, or publishes a Passport.

## Prototype contents

- `buyer-dashboard-preview.html`: static visual preview of the feature entry inside the buyer dashboard.
- `buyer-due-diligence-demo.html`: static sample report detail page intended to be opened from that dashboard.
- Both pages use illustrative data only. No Supabase client, API calls, external services, secrets, writes, authentication, or production integration.
- The preview pages are design artifacts, not production-ready access control.

## Buyer journey

1. Buyer signs in and opens the Buyer Dashboard.
2. Buyer chooses a listed project and selects **Run Due Diligence**.
3. The system checks listing visibility and buyer authorization server-side.
4. The report is created from permitted public evidence and the listing's explicitly available information.
5. The buyer sees progress, evidence provenance, technical findings and unknowns.
6. The buyer can save private notes and revisit reports from **My Due Diligence Reports**.
7. The buyer decides whether to contact the seller or submit an offer; the report does not automatically submit an offer or alter a deal.

## Proposed report sections

1. **Project snapshot** — marketplace listing reference, canonical website, public repository, report timestamp and commit/hash where applicable.
2. **Evidence register** — source URL, source type, observation, collection time, evidence class and confidence.
3. **Technical review** — link to an existing W3M AI Code Audit result; do not silently rerun it or copy its score as an overall trust score.
4. **Risk register** — severity, status (`confirmed`, `likely`, `needs_verification`), evidence, impact and suggested buyer question.
5. **Change history** — timestamped snapshots and material changes only after a properly secured monitoring service exists.
6. **Private buyer notes** — visible only to the report owner unless they explicitly share a separate copy.
7. **Buyer checklist** — ownership/control, IP and licensing, revenue proof, liabilities, admin access, deployment, contracts, dependencies and handover.
8. **Limitations** — what was not checked, unavailable sources, rate limits, stale evidence and model uncertainty.

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

- Authenticated buyer session and server-side authorization for every report operation.
- Verify the buyer can access the marketplace listing and each referenced audit.
- Enforce report ownership in database policies; never trust a buyer ID supplied by the browser.
- No seller, other buyer, public visitor, or ordinary support account can read private buyer reports by default.
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
2. Validate both static buyer-dashboard and report-detail UI with sample data only.
3. Design a read-only evidence collector with strict limits and no Passport writes.
4. Test in an isolated, non-production environment with synthetic/public test targets.
5. Design and test buyer-only authorization, row-level access and private report ownership.
6. Security and cost review.
7. Only then request explicit approval for a production integration.

## Acceptance criteria

- Entry point exists only in the buyer dashboard after sign-in.
- Every backend operation checks buyer identity, listing visibility and report ownership server-side.
- Reports and private notes are private to their buyer by default.
- All sample data is visibly labelled illustrative.
- No network requests or writes are made by either demo page.
- No Passport serial or verification badge is generated.
- Evidence and interpretation are visually distinct.
- Missing or unverified information is displayed as unknown, not assumed safe.
- Code Audit results are referenced only when a real saved audit ID and commit are available.
