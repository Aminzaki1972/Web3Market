# W3M Protocol V1 — isolated scope and readiness matrix

Date: 2026-11-06
Branch: `w3m-protocol-v1-isolated-20261105`
Status: isolated V1 core candidate; not production-integrated and not deployable yet.

## 1. What exists in the isolated branch

| Layer | Artifact / capability | Current status |
|---|---|---|
| Deterministic decision | Mandatory evidence, binding, freshness, exact commit, fail-closed statuses | Implemented; unit-tested |
| Settlement gate | PREPARE / EXECUTE decision, current report and terms binding | Implemented; unit-tested |
| Safe payload | MultiSend decoder and semantic seller/platform transfer validation | Implemented; unit-tested |
| Safe signatures | ECDSA recovery, live-owner/threshold policy, exact Safe hash binding | Implemented; unit-tested |
| Ownership evidence | GitHub repository control/transfer and NiceNIC domain account evidence | Read-only adapters; unit-tested |
| Revenue evidence | BNB ERC-20 Transfer evidence for an explicitly scoped claim | Read-only adapter; unit-tested |
| Aggregation | Unified deal/project/evidence composition | Implemented; unit-tested |
| Report envelope | Canonical report hash and version binding | Implemented; unit-tested |
| Trusted signer | Registry migration, status view, row adapter and signature policy | Implemented in isolated migrations; unit-tested |
| Registry persistence | Atomic report + evidence + event insert RPC | Implemented in isolated migration; PostgreSQL-tested |
| Execution claim | One active attempt per deal, idempotency, exact broadcast hash | Implemented in isolated migration; PostgreSQL-tested |
| Lost-hash recovery | Bind the original hash after uncertain send while retaining the blocking reconciliation state | Implemented; PostgreSQL-tested |
| Supabase RPC adapter | Server-only typed adapter for report persistence, claim, broadcast, reconciliation, and atomic finalization | Implemented; Deno-tested |
| Report service composition | Aggregate, sign, verify trusted key, then persist the immutable report batch | Implemented as an injected server-side service; CI-verified |
| Persisted report guard | Reload report/evidence/signer rows, recompute the signed evidence manifest and canonical report hash, verify current key and exact deal terms | Implemented; unit-tested |
| Deal Room report loader | Read latest report, its evidence rows, and signer status through a server-only client | Implemented; unit-tested |
| Deal Room gate service | Compute current exact-precision terms, load persisted report bundle, and combine report verification with PREPARE/EXECUTE settlement gate | Implemented; unit-tested; not yet called by deployed Safe functions |
| Canonical deal terms hash | Bind exact decimal amounts, parties, project, BNB chain, Safe/token, nonce, recipients, and pinned 7.5% fee | Implemented; unit-tested |
| Uncertain broadcast | Reconciliation-required state remains blocking | Implemented; PostgreSQL-tested |
| Finalization | Atomic update of Safe transaction, policy, deal, project, audit row, and attempt state | Added in isolated migration; PostgreSQL-tested, including missing-address hardening |

## 2. Critical boundaries

- The protocol does not trust browser-supplied PASS values, signatures, hashes, wallet addresses, amounts, or status flags.
- A trusted server must independently gather evidence, cryptographically verify the W3M report signature, recover Safe owner signatures, recompute the live Safe EIP-712 transaction hash, decode the exact persisted MultiSend payload, and check current Safe owners/threshold/nonce before claiming and broadcasting.
- The finalization RPC does not query BNB itself. The trusted server must verify the mined receipt, Safe ExecutionSuccess (and absence of ExecutionFailure), and the exact two USDT transfers before submitting its receipt-evidence object to the service_role-only RPC.
- An uncertain broadcast remains blocking. No second broadcast is allowed until the original transaction is reconciled.
- All W3M migrations remain draft artifacts. None is deployed to production.

## 3. What is still not complete

1. **Deal Room integration:** the six deployed Safe Edge Functions have no W3M gate in their captured versions: create-safe v56, prepare-deal-release v43, prepare-safe-release-tx v37, record-safe-release-signature v24, execute-safe-release v28, finalize-safe-release v25.
2. **Report issuer runtime:** there is no deployed or staging Edge Function that authenticates the caller, loads authoritative deal/project/agreement/payment/delivery/dispute state, runs the provider adapters, signs with a protected W3M private key, verifies key status, and persists the signed report.
3. **Deal Room server wiring:** the report service composition and typed Supabase RPC adapter now exist and pass isolated CI, but the adapter is not yet called by the six Deal Room Safe Edge Functions.
4. **Full end-to-end:** no isolated BNB testnet end-to-end test has yet exercised report issue → Deal Room prepare → signature recording → execution claim → broadcast → receipt verification → atomic finalization.
5. **Fee precision compatibility:** production schema checks fee math at 18 decimals, while the existing validator computes at 8 decimals and overlapping deal triggers use 6 and 8 decimals. V1 does not create or rewrite release policies. It relies on the existing locked policy plus the existing validator; therefore only deals whose stored fee values satisfy both the table constraint and validator can pass. Any incompatible precision fails closed. A canonical precision decision is still needed before a future W3M policy writer is added.
6. **Dispute policy:** V1 explicitly accepts only `deals.dispute_status = 'none'` at execution claim. All open, under-review, and terminal/resolved values remain blocked. This conservative scope avoids silently interpreting the production vocabulary mismatch; broadening terminal states requires a separately approved policy and database correction.

## 4. CI interpretation

A successful isolated CI run verifies only the files and disposable PostgreSQL fixtures in that run. It does not prove:
- production schema compatibility beyond the read-only metadata snapshot;
- that any deployed Edge Function has been changed;
- that a real W3M private signing key is configured;
- that provider credentials are available;
- that a BNB testnet settlement has completed;
- or that production Deal Room settlement is protected by W3M.

The latest comprehensive code CI run `42124917367` completed successfully on `b801a30`, including Deno type-checks, RPC adapter tests, all listed unit suites, and the disposable PostgreSQL migration/contract-test sequence. The later commits were documentation-only.

## 5. Latest isolated verification

GitHub Actions run `42127007503` completed with **success** on code commit `dcab7165887457f7eb124e677608fc6b03cd4bbf`. The run passed:
- Deno type-check for the protocol engines, report issuance service, persisted report guard, canonical deal terms hash, report loader, Deal Room gate service, and Supabase RPC adapters;
- the Deno unit suites, including report signature/evidence revalidation, fail-closed Deal Room gate, exact terms hashing, and claim/broadcast/reconciliation/finalization RPC adapter tests;
- the PostgreSQL disposable-fixture migration sequence, including atomic report registry, trusted signer registry, Safe execution attempts, atomic finalizer, and their SQL contract tests.

The later commits on this branch after that run are documentation-only. The latest code tested by this successful run is therefore the code head represented by `dcab716`; the later branch commits only update documentation. No production integration is implied.

**Milestone:** the isolated W3M V1 core and the reusable Deal Room gate service (deterministic evidence verification, persisted report/signature revalidation, exact terms binding, Safe claim/reconciliation/finalization lifecycle, and typed server RPC/read adapters) have passed CI. The **six deployed Safe Edge Functions are still not patched to call this gate**, and a full isolated BNB testnet flow has not yet been verified.

## 6. Release boundary

**Safe to continue:** isolated code, docs, unit tests, disposable PostgreSQL fixtures, and source-derived integration design.

**Not authorized / not done:** merge to `main`, deploy migrations or Edge Functions, change production schema or secrets, invoke Safe, sign with a real wallet, broadcast a transaction, or move funds.

## 7. Definition of integrated V1 completion

The isolated V1 core can be called implementation-complete only after:
- the latest CI run passes (including the lost-broadcast-hash recovery test and RPC adapter tests);
- the report issuance composition, persisted report loader/guard, Deal Room gate service, and expanded Supabase RPC adapter contracts pass CI;
- the six Safe integration patches are prepared against the captured versions and pass static/type checks in the isolated branch;
- a disposable full-flow integration test covers all lifecycle transitions and replay/reconciliation behavior;
- the conservative V1 compatibility boundary remains in force: only locked fee values accepted by both existing production checks and exact `dispute_status = 'none'` can pass; broader fee/dispute support requires a separately approved policy.

Even then, that milestone means **staging-ready candidate**, not production activation. Production activation requires a separate review and explicit approval.
