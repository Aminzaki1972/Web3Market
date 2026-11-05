# W3M V1 — Current Deal Room / Safe Source Map

**Compared repository ref:** `main` at `02c931bb59c478cf57fc327fb680cc069bd548b1`  
**Feature ref:** `w3m-protocol-v1-isolated-20261105`  
**Review type:** Repository source inventory and static call-flow mapping  
**Production access:** None. No Supabase project, deployed function, database, Safe, or wallet was accessed.

## 1. Confirmed current frontend call flow

The current `main` repository contains these UI call sites:

| Stage | Frontend source | Call / data |
|---|---|---|
| Safe deployment | `js/deal-room.js` | Calls `create-safe` |
| Release preparation | `js/release-signing-fix.js` | Calls `prepare-deal-release`, then `prepare-safe-release-tx` |
| Read prepared transaction | `js/release-signing-fix.js` | Reads `deal_multisig_transactions` |
| Read signatures | `js/release-signing-fix.js` | Reads `deal_multisig_signers` |
| Record signature | `js/release-signing-fix.js` | Calls `record-safe-release-signature` |
| Execute | `deal-room.html` | Direct POST to `execute-safe-release` |
| Finalize | `deal-room.html` | Calls `finalize-safe-release` and supplies transaction hash |

The browser also reads the multisig transaction and signer records to render the release UI. These reads are display logic, not trusted authorization evidence.

## 2. Backend source inventory on current main

The current `supabase/functions` directory contains 14 function folders:
- `admin-project-email-notification`
- `admin-review`
- `ai-review-project`
- `buyer-dd-create`
- `create-audit-payment-order`
- `external-passport-persist`
- `external-project-passport`
- `guest-audit-access`
- `public-project-passport`
- `verify-audit-payment`
- `w3m-audit-autofix-pr`
- `w3m-code-audit`
- `w3m-trust-badge-approve`
- `w3m-trust-badge`

The following six functions are called by the current Deal Room flow but have no corresponding source folders in this current-main directory:
- `create-safe`
- `prepare-deal-release`
- `prepare-safe-release-tx`
- `record-safe-release-signature`
- `execute-safe-release`
- `finalize-safe-release`

This is a repository-source finding only. It does **not** prove those functions are absent from the deployed Supabase project. They may have been deployed independently or retained from a source branch not represented in current main. Their live version, environment variables, and deployment configuration remain unverified.

## 3. Consequence for W3M integration

A safe integration cannot be completed by changing only the browser:
- A client-side PASS check can be bypassed.
- Browser reads of transaction/signer rows can be stale or manipulated.
- The execute endpoint is a direct server call and is the critical final enforcement boundary.
- Preparation and signature recording must also reject stale, missing, revoked, or mismatched reports.
- Finalization must independently verify the on-chain Safe execution and exact token transfers.

The W3M helpers currently implemented on the feature branch are pure logic. They are not connected to any of these six backend endpoints. Do not deploy them as if they were complete substitutes.

## 4. Minimum source needed for the next implementation stage

Obtain a source-only export of the six currently deployed Edge Functions, including their import modules and deployment configuration **but excluding all secrets and environment values**. A Supabase CLI project export or the original source archive is sufficient if it is known to match the deployed versions. A separate staging deployment is preferred.

Also obtain the current schema definitions or migration history for:
- `deals`
- `deal_multisig_transactions`
- `deal_multisig_signers`
- `deal_party_agreements`
- `deal_disputes`
- the payment and delivery evidence fields used by the release functions.

The source must be versioned or otherwise tied to a deployment identifier so it can be compared reliably. No production database query or secret export is required for this source review.

## 5. Integration order after source is available

1. Pin and compare the authoritative Safe function versions.
2. Build server-side adapters that read trusted deal, payment, delivery, agreement, dispute, wallet, and Safe configuration records.
3. Create and sign immutable W3M reports from those records.
4. Enforce the report in preparation and signature recording.
5. At execution, revalidate report, signer recoveries, exact decoded MultiSend payload, current nonce/owners/threshold, disputes, payment, delivery, and idempotency before broadcast.
6. Verify exact Safe execution receipt and token transfer logs.
7. Atomically persist finalization only after verified chain success.
8. Run isolated PostgreSQL and BNB testnet end-to-end tests before any production discussion.

## 6. New isolated pipeline test

The feature branch now contains `safe-payload-pipeline.test.ts`, which composes the strict MultiSend decoder with the semantic transfer validator. It tests the actual calldata parsing-to-policy-validation path, including valid seller/platform transfers, attacker recipient substitution, extra approval calls, inner DELEGATECALL, and malformed ABI offsets.

The pipeline test is a local pure-function test only; it does not call Safe, Supabase, or any network endpoint.

**Conclusion:** The frontend call graph is now mapped. The remaining blocker is not a missing browser button or a missing UI integration: it is the authoritative backend source for the six Safe functions and the exact schema those functions trust. Until that source is available, keep W3M isolated and do not claim that it blocks live settlement.


## 7. Additional candidate branch found during continued review

A second candidate source snapshot was found on `fix/security-release-guards-20261026`. It contains `prepare-deal-release`, `prepare-safe-release-tx`, and `execute-safe-release`, but not `create-safe`, `record-safe-release-signature`, or `finalize-safe-release`.

Its detailed static findings are recorded in `docs/w3m-protocol-v1-security-review-20261026-candidate.md`. It contains useful payment/dispute/participant/Safe checks, but its executor still lacks exact inner-payload semantic validation, independent signature recovery, complete release-state revalidation, matching Safe ExecutionSuccess verification, and checked/idempotent persistence after broadcast.

This is another non-main source candidate only. It does not establish deployment status and must not be treated as authoritative current backend source.


## 8. Additional branch inventory checked on 2026-11-05

The following repository refs were checked by reading their Git trees (not by querying Supabase or deployed infrastructure):

| Ref | Commit | Relevant Safe backend source found |
|---|---|---|
| `roadmap-safe-escrow-status-20261105` | `829660ae343b197bbd8e2160e09514d2ec5c91fd` | None; contains Deal Room frontend files only |
| `w3m-testnet` | `18e240e8f5d083851d05ac59401213b46d5dc1f5` | None of the six Deal Room Safe Edge Functions |
| `fix/deal-dispute-release-guard` | `12e4d38267b504e670d3f59011ae9107bde74e38` | Five historical functions: prepare, prepare-tx, record-signature, execute, finalize; no `create-safe` |
| `fix/security-release-guards-20261026` | `2267b13a024421c08a59f5957dc1aadbaf887894` | Three candidate functions: prepare, prepare-tx, execute |

The historical five-function snapshot is useful for understanding earlier implementation intent, but it is not a complete six-function source set and does not prove that it matches the deployed version. The testnet branch is not evidence of an integrated Deal Room Safe backend.

**Updated conclusion:** Repository branch review has not located a complete, authoritative source set for all six current Safe endpoints. Do not combine files from different historical branches to manufacture a presumed deployed implementation. The next safe step remains obtaining a source-only export tied to the currently deployed function versions, or an explicitly isolated staging source set.
