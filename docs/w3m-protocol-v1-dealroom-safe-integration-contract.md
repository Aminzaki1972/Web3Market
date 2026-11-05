# W3M Protocol V1 — Integration Contract for Deal Room and Safe

**Branch:** `w3m-protocol-v1-isolated-20261105`  
**Status:** Contract specification only; no live integration or deployment  
**Purpose:** Define the exact server-side boundary required before any Safe release can be prepared or executed.

## 1. Non-negotiable architecture

- Safe remains the custody and multi-signature execution layer.
- W3M is a verification gate, not a replacement escrow contract.
- Browser code may display a report but must never create, sign, approve, or authorize a PASS report.
- Only a trusted server-side verifier may assemble evidence from authoritative records, evaluate it, persist it, and sign the report.
- Every Safe release preparation and execution request must independently revalidate the latest report.
- Missing, stale, mismatched, unsigned, expired, superseded, or unverifiable evidence must fail closed.
- No production database, Edge Function, wallet, Safe, Cloudflare setting, or deployment is changed by this contract.

## 2. Required Edge Function boundary

The eventual implementation should expose one server-side function named `w3m-acquisition-verification`. It must authenticate the caller and enforce role/deal participation before processing any action.

### Action: `create_report`

Input (all identifiers are opaque strings; do not trust client-supplied evidence facts):

- `deal_id`
- Optional `requested_reason` for audit logging only

The function must load the canonical deal and related records itself. It must not accept client-provided `status`, `evidence`, `evidence_hash`, `report_hash`, `signature`, `payment_confirmed`, `seller_control_verified`, or `delivery_accepted` as authoritative inputs.

Output:

- `report_id`
- `deal_id`
- `project_id`
- `status`
- `engine_version`
- `evidence_hash`
- `issued_at`
- `expires_at`
- Sanitized `issues[]`

### Action: `get_report`

Input: `deal_id`, `report_id`.

The function must confirm that the caller is an authorized participant or administrator for that deal. Return only the sanitized report and evidence summary; never expose signing keys or internal secrets.

### Action: `validate_settlement`

Input:

- `deal_id`
- `report_id`
- `settlement_stage`, restricted to `PREPARE` or `EXECUTE`

The function must reload the latest report and canonical deal state, validate the signature and key status, enforce expiry and supersession, and verify the evidence hash before returning authorization. The response is an internal server-to-server decision, not a browser authorization token.

## 3. Evidence adapter contract

Every adapter must return a normalized evidence record matching the decision engine interface:

- Unique evidence ID
- One of the eight approved evidence categories
- Result: `PASS`, `MISSING`, `FAILED`, `STALE`, or `REVIEW_REQUIRED`
- Mandatory flag
- Exact deal and project binding
- SHA-256 hash of a canonical, minimized evidence snapshot
- Observation timestamp and explicit expiry
- Authoritative source record ID and source version
- Typed metadata consumed by the deterministic decision engine

The adapter must preserve provenance. A boolean copied from browser state is not authoritative evidence.

### Source mapping to implement only after schema/source review

| Evidence category | Candidate authoritative source | Required validation |
|---|---|---|
| PROJECT_IDENTITY | Accepted marketplace project record and official Passport result | Project is approved, belongs to this deal, and identity fields match |
| CODE_AUDIT | Completed `code_audits` row | Exact repository, audit ID, completed status, and exact 40-character commit SHA |
| OWNERSHIP_CONTROL | Asset-specific control proofs | Seller controls each agreed domain, repository, wallet, cloud account, or other asset |
| ASSET_TRANSFER | Asset-specific transfer confirmations | Each asset has an independently verifiable transfer proof |
| DEAL_AGREEMENT | Deal record and `deal_party_agreements` | Buyer and seller accepted the same immutable terms version |
| PAYMENT | Existing trusted payment verification / Safe transaction records | Correct chain, Safe, token, amount, recipient, fee split, and confirmed transaction |
| BUYER_ACCEPTANCE | Delivery evidence plus buyer acceptance record | Buyer explicitly accepted the delivered asset set |
| DISPUTE_CHECK | Canonical dispute records | No unresolved dispute or settlement hold exists |

The candidate source names above are not a declaration that the schema is fully verified. The authoritative table/column types, constraints, RLS behavior, and write paths must be inspected in the isolated staging source before implementing adapters.

## 4. Safe settlement integration points

The gate must be inserted into the existing authoritative backend functions, not merely into `deal-room.js`.

At minimum, review and integrate the actual server-side implementations corresponding to these client-referenced operations:

- `prepare-deal-release`
- `prepare-safe-release-tx`
- Safe release signature recording
- Safe transaction execution
- Safe release finalization

Required order:

1. Authenticate and authorize the deal participant/system caller.
2. Load canonical deal, payment, dispute, Safe, and report state.
3. Call the internal settlement validator for `PREPARE` before creating a release transaction.
4. Re-check report version, expiry, evidence, dispute, payment, Safe configuration, amount, fee split, nonce, and release idempotency at `EXECUTE`.
5. Continue the existing Safe policy and multi-signature checks unchanged.
6. Record an immutable `SETTLEMENT_AUTHORIZED` or `SETTLEMENT_BLOCKED` event with reason codes.
7. Finalize only after authoritative on-chain confirmation.

A browser-supplied `report_id` alone must never authorize settlement. The server must resolve the latest report for the deal and reject an older report even if its signature remains cryptographically valid.

## 5. Report signature and key custody

- Use a dedicated server-side signing key, never a browser wallet or client bundle.
- Keep the private key in a managed secret/KMS facility; do not store it in report rows, Git, workflow logs, or client environment variables.
- The signature must cover a canonical envelope containing protocol version, engine version, report ID/version, deal/project IDs, buyer/seller references, audit ID and commit SHA, evidence hash, deal terms version, payment reference, status, issue time, and expiry.
- Store signer key ID and signature with the immutable report.
- Validate signature, signer authorization, and key revocation status at both settlement stages.
- Define key rotation and emergency revocation before staging use.

## 6. Required fail-closed cases

Settlement must be denied if any of these conditions occurs:

- No report exists, or report is not `PASS`.
- Report belongs to another deal or project.
- Report is not the latest report version.
- Signature is absent, invalid, or signed by a revoked/unrecognized key.
- Report is expired or has been superseded.
- Evidence hash does not match the canonical evidence manifest.
- Audit is not completed or its commit SHA differs from the deal's pinned commit.
- Ownership or transfer evidence is missing, stale, or unverifiable.
- Buyer/seller agreement does not match the current deal terms version.
- Payment is unconfirmed or amount/asset/chain/recipient/fee split differs.
- Buyer has not accepted delivery.
- A dispute or settlement hold is open.
- Safe address, chain, owners, threshold, nonce, or transaction details differ from the existing approved release policy.
- The release has already been executed or finalized.

## 7. Staging test matrix

All tests must run against disposable PostgreSQL and a BNB test network with test wallets only. No production URL, key, Safe, or funds may be used.

| Scenario | Expected result |
|---|---|
| Complete valid evidence, valid signed report | PASS report; staging release may proceed through existing Safe checks |
| Missing ownership proof | INCOMPLETE; no release preparation |
| Seller does not control an asset | BLOCKED; no release preparation |
| Audit commit differs from deal-pinned commit | BLOCKED; no release preparation |
| Buyer/seller terms version mismatch | BLOCKED; no release preparation |
| Payment not confirmed | BLOCKED; no release preparation |
| Buyer delivery acceptance missing | INCOMPLETE; no release preparation |
| Open dispute | BLOCKED; no release preparation |
| Expired or superseded report | Rejected at PREPARE and EXECUTE |
| Invalid signature or revoked signer key | Rejected at PREPARE and EXECUTE |
| Evidence changes after report creation | Old report rejected; new report required |
| Safe nonce/amount/fee split changes | Rejected before execution |
| Duplicate execution request | Idempotent rejection; no second transfer |
| Report from another deal | Rejected |

## 8. Current blocker and next implementation step

The active isolated branch and current main tree do not contain the Safe release Edge Function sources. However, I located a historical candidate snapshot on branch `fix/deal-dispute-release-guard` (last commit dated 2026-10-22), containing `prepare-deal-release`, `prepare-safe-release-tx`, `record-safe-release-signature`, `execute-safe-release`, and `finalize-safe-release`, plus a dispute-guard migration. These files are useful for code review, but they are not proof of the currently deployed function versions and must not be treated as authoritative without comparing them to the deployed/staging source.

The historical snapshot already contains checks for participant access, payment confirmation, open disputes, delivery acceptance, Safe owner/threshold/nonce, fee split, signature count, and on-chain transfer confirmation. Those controls must be preserved and revalidated when adding the W3M gate. The source is old enough that blindly copying or replacing deployed functions would be unsafe. The next safe step is to compare the historical snapshots with the actual staging/deployed function versions, then port only the verified current source into this isolated branch and add W3M checks at PREPARE and EXECUTE. Do not deploy or overwrite any live function.

**Current state:** deterministic decision engine and isolated evidence-registry schema have passed the dedicated CI run. This integration contract does not activate the protocol, alter the live Deal Room, or authorize any real settlement.


## 9. Historical Safe source review — additional mandatory controls

The static review of the five historical candidate functions is recorded in `docs/w3m-protocol-v1-historical-safe-static-security-review.md`. It is a historical source review, not confirmation of deployed code.

Before W3M integration is considered safe, the authoritative current backend must also satisfy all of the following:

1. **Exact transaction payload:** Decode the full Safe/MultiSend payload server-side. Require exactly the configured token transfer to the verified seller for the exact seller-net amount and exactly the configured platform-fee transfer to the approved platform wallet. Reject additional calls, approvals, unexpected recipients, unexpected token contracts, non-zero unexpected values, and amount mismatches before any broadcast.
2. **Signature re-verification:** At execution, recompute the Safe transaction hash and recover each stored EIP-712 signature against that exact digest. Require distinct current Safe owners and a valid threshold. Do not trust a database count or signature status alone.
3. **State revalidation:** Recheck the current W3M report, report version/signature/key status/expiry, payment, buyer acceptance, terms hash, dispute state, policy status, Safe/token/chain configuration, nonce, and finalization state immediately before execution.
4. **Concurrency-safe idempotency:** Atomically claim one execution attempt for the deal + Safe transaction hash. Reconcile uncertain broadcasts from chain state before retrying. Prevent concurrent requests from rebuilding or submitting competing releases.
5. **Atomic persistence:** Use narrowly scoped database transactions/RPCs for coupled preparation state changes and post-receipt finalization. Check every database write result. Keep chain receipt verification outside the DB transaction, then persist its verified facts atomically.
6. **Receipt semantics:** Require the matching Safe `ExecutionSuccess` event for the exact Safe transaction hash, plus exact token Transfer logs from the configured Safe to the exact recipients and amounts, before finalization.
7. **Configuration allowlists:** Reconcile chain ID, token address, token decimals, Safe version, platform wallet, MultiSendCallOnly address, and executor configuration against the authoritative approved configuration. Never accept these from browser input.

The historical implementation does contain useful controls, but its transaction builder's structural MultiSend check is not a semantic proof of the inner transfer instructions. Its execution path does not independently recover every stored signature or prove the exact intended transfer payload before broadcasting. Its multi-step database writes also need atomic/idempotent handling.

### Source-of-truth prerequisite

The five historical functions are absent from the current `main` tree. Frontend references to function names do not establish deployed source. Do not copy this historical snapshot into active Edge Function paths or infer that it is the live version. Obtain an authoritative current source export or isolated staging deployment first, compare it to the historical snapshot, and only then implement adapters on this feature branch.


## 10. Isolated payload validator helper

The feature branch contains a pure validator at `supabase/functions/w3m-acquisition-verification/safe-payload-validator.ts` with Deno tests. It validates a normalized representation of the decoded Safe transaction and requires exactly two inner token `transfer` calls: the agreed seller-net transfer and platform-fee transfer. It also checks the approved chain, Safe address, MultiSendCallOnly target, DELEGATECALL outer operation, zero native value, token address, distinct recipients, and exact fee arithmetic.

The helper is deliberately not wired into any Safe Edge Function. A trusted adapter must first ABI-decode the actual signed transaction payload, normalize every inner call, and invoke the helper. The same semantic payload check must run before signature acceptance and immediately before broadcast. Do not treat this helper as protection until those call sites are implemented and tested.
