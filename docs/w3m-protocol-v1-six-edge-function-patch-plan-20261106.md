# W3M Protocol V1 — Source-Pinned Six-Function Integration Patch Plan

Date: 2026-11-06
Feature branch: `w3m-protocol-v1-isolated-20261105`
Status: implementation plan only; no deployed function modified.

## 1. Source pinning

Use only the source-only snapshots captured on 2026-11-06 and identified in `docs/w3m-protocol-v1-deployed-safe-functions-static-review-20261106.md`:

| Function | Captured active version | SHA-256 |
|---|---:|---|
| `create-safe` | 56 | `d888f48d48c87563e20e43318f9187c0f02d9a46fbe5e037cadbb5520b918e07` |
| `prepare-deal-release` | 43 | `6c670d08fbb55fdc61a10c39b5f32062d311934228df59ce23096d337ba52e18` |
| `prepare-safe-release-tx` | 37 | `f4248dde096a3532befca8dbd894cdb3bb6511bdf2d6a70c8e253b9587b01dfe` |
| `record-safe-release-signature` | 24 | `fb4fedf2c17245b52d2920d3ac13c426b02a49d176dc96e75237c599840d5d01` |
| `execute-safe-release` | 28 | `e51aa4f2dffe259292a627b0ab1c3663c5f2ef46b7792cd96c156c452eb65d22` |
| `finalize-safe-release` | 25 | `4f39f60122f79198fd8b2051cefd172d600f1c1d3a5d48310b40620957efd5ce` |

These hashes pin the reviewed source packages. The `.txt` files in `docs/w3m-protocol-v1-source-snapshot-20261106/` are archival text, not deployable function folders. Do not mix historical branches or assume that a locally reconstructed file matches a deployed package.

## 2. Shared integration prerequisites

Before patching any of the six functions:

1. Deploy nothing. Work only in this feature branch and create new isolated candidate function directories or patch artifacts.
2. Reuse the existing W3M helpers rather than duplicating security logic:
   - `dealroom-terms-reader.ts` and `dealroom-w3m-service.ts` for a fresh exact deal/policy/report snapshot;
   - `persisted-report-guard.ts` and `signature-verifier.ts` for current report/evidence/signer verification;
   - `safe-payload-pipeline` for strict MultiSend decoding plus semantic transfer validation;
   - `safe-signature-set-validator.ts` for execution-time signature recovery and owner matching;
   - `prelock-safe-prepare-commit.ts` and `atomic-safe-prepare-rpc-adapter.ts` for atomic PREPARE persistence;
   - `safe-execution-coordinator.ts` and `supabase-rpc-adapter.ts` for claim, broadcast recording, reconciliation and finalization;
   - `bnb-safe-receipt-verifier.ts` for raw canonical BNB receipt/log verification.
3. The report issuer is a separate missing runtime boundary. The existing pure service `issueAndPersistAcquisitionReport` and authenticated request handler are not a deployed issuer. A real implementation must load authoritative deal/project/agreement/payment/delivery/dispute and provider evidence, call a protected signer, verify its key against the trusted registry, and persist the immutable report batch. No private key may be embedded in source, browser code, or a normal Edge Function environment without an explicit key-management design.
4. Every endpoint must independently authenticate the user and re-read its authorization inputs. A prior endpoint's PASS, a browser status flag, or an earlier database row is not sufficient authorization for a later phase.

## 3. Per-function patch sequence

### A. `create-safe` v56 — keep deployment separate from settlement authorization

- Preserve the current deployment responsibility and its existing authorization checks.
- Do not treat Safe creation as report issuance, PREPARE, or release authorization.
- Do not invoke it automatically from any W3M gate.
- Any later W3M check around Safe creation must be a separately scoped requirement; the release gate must still validate the deployed Safe's live configuration at PREPARE and EXECUTE.

### B. `prepare-deal-release` v43 — block before policy/transaction writes

- After authenticated participant and authoritative deal reads, obtain the exact current Deal Room snapshot and live canonical-block Safe facts.
- Require the latest signed, unexpired W3M PASS report bound to the same deal, project, buyer, seller, exact terms hash, and current trusted signer key.
- Keep payment, delivery, dispute, wallet verification, chain, token and Safe configuration checks. W3M is additive; it must not weaken any existing guard.
- Perform all W3M and existing policy validation before any upsert/insert/update.
- Reject stale report, missing report, wrong signer, changed terms, unsupported dispute state, or mismatched Safe facts with no database side effects.

### C. `prepare-safe-release-tx` v37 — validate before transaction reuse or mutation

- Re-read the exact deal/policy snapshot and W3M report immediately before constructing or returning a prepared Safe transaction.
- Decode the exact MultiSend calldata and validate each inner operation, target, token, recipient and raw amount against the locked seller/platform split.
- Apply the same semantic validator to the existing-transaction fast path; never return a pre-existing transaction merely because its ABI shape is valid.
- Reject approvals, extra calls, unexpected delegatecalls, native value, alternate tokens, recipient substitution, amount mismatch, or stale Safe nonce.
- Make transaction/signer row mutations atomic and check every database result. A failed W3M check must not clear signatures or alter the current transaction.

### D. `record-safe-release-signature` v24 — bind every signature to a fresh authorized payload

- Preserve typed-data signature recovery.
- Before accepting a signature, reload the deal, locked policy, exact Safe transaction, W3M report and current signer key.
- Require the signature to bind to the exact currently authorized Safe transaction hash and expected buyer/seller role and wallet.
- Apply semantic payload validation to the transaction being signed.
- Persist the signature and confirmation count atomically; check all write results and reject duplicate signer identities.

### E. `execute-safe-release` v28 — enforce the complete gate immediately before broadcast

- Re-read the latest deal, policy, payment, accepted delivery, agreement identity, dispute rows, Safe configuration, transaction payload and current report.
- Recompute exact terms hash and independently verify the report signature/evidence and signer revocation status.
- Decode and semantically validate the exact stored MultiSend payload.
- Recover every stored ECDSA signature against the exact live Safe EIP-712 digest; require unique recovered addresses, matching stored signer identities, current Safe owner membership and threshold.
- Claim one execution attempt atomically before broadcast. Persist the original broadcast hash immediately. An uncertain send must enter a blocking reconciliation state; never blindly send again.
- Keep the connected owner wallet/non-custodial signing model. Do not introduce a server-held Safe owner private key.

### F. `finalize-safe-release` v25 — chain verification then one atomic database commit

- Preserve independent raw BNB receipt verification: chain 56, successful mined receipt, canonical block and confirmation policy, matching Safe ExecutionSuccess, no matching ExecutionFailure, and exactly the expected Safe-to-seller and Safe-to-platform token transfers.
- Bind finalization to the exact attempt, broadcast hash, Safe transaction hash and W3M report authorization captured for the attempt.
- Replace sequential table updates with the isolated service-role-only atomic finalizer RPC after the trusted server has revalidated the receipt.
- Check the complete RPC result. Replays must be idempotent; partial completion must be impossible.

## 4. Required isolated verification matrix

| Test family | Required negative cases |
|---|---|
| Report gate | Missing, expired, superseded, BLOCKED/INCOMPLETE, wrong deal/project/party/terms, altered evidence, revoked/expired signer |
| PREPARE | No policy/transaction writes on any failed precondition; wrong Safe owner/threshold/version/nonce |
| Payload | Wrong token, recipient, amount, chain, operation; extra call; approval; malformed ABI; stale nonce |
| SIGN | Wrong role/wallet/hash, malformed or duplicate signature, changed transaction after signing |
| EXECUTE | Signature recovery mismatch, duplicate owner, non-owner, threshold shortfall, stale report/terms, payment rollback, delivery rollback, dispute, replay |
| Broadcast | Timeout after send, lost hash response, DB write failure, duplicate request, reconciliation before retry |
| FINALIZE | Wrong chain/receipt/hash/block, failed receipt, missing/duplicate logs, wrong Safe event, failure event, wrong token/from/to/amount, report/attempt mismatch |
| Atomicity | Any failure leaves deal, policy, project, multisig row, audit and attempt state mutually consistent |

Run the full CI workflow and disposable PostgreSQL fixture sequence after each code batch. Then run a separate isolated BNB testnet lifecycle with test assets only. No production activation follows automatically from passing these tests.

## 5. Current stop conditions

The following are hard blockers, not items to paper over with defaults:

- No protected W3M report-signing service/key has been selected and configured.
- Provider evidence collection must be connected to authoritative project/audit/provider records; caller-supplied evidence is forbidden.
- Production fee precision is inconsistent across table constraints, validation function and triggers; the existing W3M V1 policy remains fail-closed and does not write or rewrite release policies.
- Production dispute vocabulary is inconsistent; current V1 accepts only exact `dispute_status = 'none'`.
- The six active functions have not been patched or deployed, and no full BNB testnet lifecycle has been completed.

**Release boundary:** This document authorizes source-derived isolated engineering only. It does not authorize merging, migration deployment, Edge Function deployment, secret changes, Safe interaction, signing with a real wallet, broadcasting, or moving funds.
