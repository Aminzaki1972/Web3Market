# W3M Protocol V1 — Implementation Conformance and Release Gates

**Snapshot date:** 2026-11-06  
**Specification PR:** #180 — draft, not merged  
**Implementation branch:** `w3m-protocol-v1-isolated-20261105`  
**Production posture:** not integrated with live Deal Room settlement; no production activation is authorized by this document.

## 1. Verified repository state

- The public announcement change in PR #179 is merged into `main` at commit `fa7702ee17582483fd6aaaf4eb7dd03203e05bce`. Its public wording states that end-to-end integration and validation remain in progress.
- PR #180 contains the first versioned technical specification. It remains an open draft and is not a release approval.
- The isolated implementation branch contains the deterministic decision engine, evidence adapters, report envelope and signing verification, canonical deal terms, Safe transaction/signature validation, execution attempt tracking, reconciliation, and atomic finalization components.
- GitHub Actions run [42249892753](https://github.com/Aminzaki1972/Web3Market/actions/runs/42249892753) completed successfully. Its `decision-engine-and-schema` job passed the enumerated Deno checks/tests and disposable PostgreSQL migration/contract tests, including the immutable Deal Room Code Audit binding boundary.
- The successful run validates only the exact isolated source and disposable fixtures included in that run. It does not establish deployment, production schema compatibility, real signing-key availability, or successful BNB testnet settlement.

## 2. Conformance snapshot

| Specification area | Isolated implementation evidence | Release status |
|---|---|---|
| Deterministic PASS / INCOMPLETE / BLOCKED / REVIEW_REQUIRED | Decision engine and fail-closed settlement gate with Deno tests | Isolated tests only |
| Evidence provenance and source binding | GitHub, NiceNIC, BNB revenue, Code Audit manifest and unified evidence components | Isolated adapters; trusted runtime composition remains incomplete |
| Immutable deal terms | Exact decimal handling, BNB chain/Safe/token binding, Code Audit ID/repository/commit/manifest binding | Isolated implementation; SQL/TypeScript parity and integration remain release gates |
| Signed acquisition report | Canonical envelope, trusted signer verification, persistence adapters and persisted-report revalidation | Issuer runtime and protected key custody are not production-configured |
| Safe transaction validation | MultiSend decoding, exact transaction hash/signature checks, owner/threshold/facts readers | Isolated tests; active deployed Safe functions are not patched |
| Execution safety | Idempotent attempt claim, broadcast tracking, uncertain-hash reconciliation and atomic finalizer | Isolated PostgreSQL contract tests; no live execution |
| Dispute handling | Conservative fail-closed policy | Only exact `dispute_status = 'none'` is eligible in V1 |
| End-to-end lifecycle | Component and adapter test suites | No complete BNB testnet lifecycle has been demonstrated |

## 3. Mandatory blockers before staging readiness

1. **Trusted report issuer:** implement and test the authenticated server runtime that loads authoritative deal, project, agreement, payment, delivery, dispute, and provider evidence. Browser-supplied evidence and status values must remain rejected.
2. **Protected signing custody:** select and approve a key-custody/signing mechanism. No private signing key may be placed in source code, browser code, ordinary logs, or an unprotected database.
3. **Deal Room integration:** prepare isolated patches against the exact captured versions of the six active Safe Edge Functions. Preserve existing authentication, payment, delivery, Safe hash, owner-signature, receipt, and transfer checks. The W3M gate must execute server-side at the relevant PREPARE, SIGN, EXECUTE, and FINALIZE boundaries.
4. **Schema reconciliation:** reconcile every proposed migration and RPC against an exact isolated schema export, including triggers, constraints, foreign keys, and RLS. Disposable fixture success alone is insufficient.
5. **Policy compatibility:** resolve fee precision differences before broadening eligible deals. Keep the current fail-closed compatibility rule. Keep every dispute state other than exact `none` blocked until the production vocabulary and policy are reconciled.
6. **End-to-end test:** demonstrate report issue → prepare → buyer/seller agreement acceptance → Safe package → signature collection → execution claim → broadcast → receipt verification → atomic finalization, including replay, timeout, stale evidence, terms amendment, and dispute cases.
7. **Independent review:** complete an independent security review of the protocol, migrations, signer boundary, and Safe integration before any production release decision.

## 4. Integration discipline

- Keep all implementation work isolated from `main`.
- Do not apply migrations to production, deploy Edge Functions, change production secrets, call a live Safe, sign with a real wallet, broadcast transactions, or move funds as part of isolated development.
- Reconcile the isolated branch with the current `main` history before preparing any integration PR; the branch comparison currently reports that it is diverged and behind `main`.
- A passing CI run is evidence for the tests it ran, not a certification of the entire protocol.

## 5. Release vocabulary

Use these status labels consistently:

- **Implemented in isolated code:** code exists on the isolated branch.
- **CI-verified:** the relevant code and tests passed in a named workflow run.
- **Staging-ready:** all staging integration gates and full-flow tests passed in an isolated staging environment.
- **Production-ready:** independent security review, operational controls, and release approvals are complete.
- **Production-active:** explicitly deployed and enabled in production.

At this snapshot, W3M Protocol V1 is an **isolated implementation candidate with passing component/contract CI**, not staging-ready, production-ready, or production-active.
