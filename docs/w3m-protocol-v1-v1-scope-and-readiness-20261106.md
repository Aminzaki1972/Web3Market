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

GitHub Actions run `42130922902` completed with **success** on commit `69cb2f2ff827b5d201c7d05ca40f1e3c4fe9b532`. In addition to the previously listed Deno and disposable PostgreSQL suites, this run includes negative Safe-facts cases proving the Deal Room gate rejects a wrong chain ID, wrong nonce, duplicate owner, wrong threshold, and wrong Safe version. This is isolated CI evidence only; no deployed function or live Safe was exercised.


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


## 8. Verification update — 2026-11-06 17:30 UTC

The branch head is `9bbe764b6bbd0dd41a8eec31a7ed3bd3178b3f29`.
GitHub Actions run [42241803541](https://github.com/Aminzaki1972/Web3Market/actions/runs/42241803541) completed with **success** on that exact commit. Its `decision-engine-and-schema` job completed successfully. The run includes the raw BNB Safe receipt verifier suite, Safe finalization receipt guard, authenticated request-boundary suites, Deal Room W3M gate/service suites, typed RPC adapter suites, and disposable PostgreSQL migration/contract tests. The latest commit specifically adds four receipt-tampering regressions: mismatched transaction hash/failed receipt, malformed token decimals, duplicate Transfer log index, and removed receipt log.

This is stronger CI evidence for the isolated components. It does not close the integration blockers in sections 3 and 7: no report-issuer runtime composition loads authoritative deal/provider evidence and uses a protected production signer; the six isolated entrypoints are not replacements for the six deployed Safe functions; and no complete BNB testnet lifecycle has been executed. The protocol therefore remains an isolated candidate, not staging-ready or production-ready.

## 9. Verification update — 2026-11-06 17:37 UTC

The branch head at the time of this update is `ba5f6bc5108a4aabede797315afafa9473b2d112`. GitHub Actions run [42244339970](https://github.com/Aminzaki1972/Web3Market/actions/runs/42244339970) completed with **success** on commit `ba5f6bc5108a4aabede797315afafa9473b2d112`. The `decision-engine-and-schema` job completed successfully, including Deno type-checks, decision/settlement/Safe payload suites, asset-transfer and provider adapters, unified evidence aggregation, report registry batch/orchestrator and trusted signer verification, authenticated request boundaries, BNB Safe facts and receipt verification, finalization guards, and the disposable PostgreSQL migration/contract-test sequence. The four malformed receipt-attestation SQL cases (chain ID, receipt status, execution-success boolean, and block timestamp) were included in this successful run.

This run verifies the isolated candidate and disposable database only. It does not establish that a protected signing key or provider credentials are configured, that the report issuer has a deployed runtime composition, that the six active Deal Room/Safe functions call the W3M gate, or that a BNB testnet end-to-end settlement has completed. The blockers in section 3 remain open.


## 10. Report issuer runtime composition gate — 2026-11-06

A source-level review of the report pipeline confirms that the authenticated request handler, unified evidence aggregator, protocol orchestrator, registry batch builder, trusted signer verifier, and persistence service exist as separate injectable/pure components. They are not yet composed into a live Edge Function that loads every mandatory evidence source authoritatively, uses protected key custody, persists atomically, and verifies the persisted digest on read-back.

The detailed implementation contract and acceptance matrix are recorded in [Report Issuer Runtime Composition Gate](w3m-protocol-v1-report-issuer-runtime-composition-gate-20261106.md).

**Status remains blocked for live issuance:** no production signing key custody service has been selected/configured; authoritative source loading for all mandatory evidence types is not yet proven as one runtime path; and no production issuer Edge Function has been deployed. A PASS decision produced by the pure isolated pipeline is not by itself a trusted settlement authorization.

The documentation update does not change code and does not require a new CI run. The latest comprehensive code verification remains run [42244339970](https://github.com/Aminzaki1972/Web3Market/actions/runs/42244339970) on code commit `ba5f6bc5108a4aabede797315afafa9473b2d112`; documentation-only commits after that run have not been re-run through CI.
