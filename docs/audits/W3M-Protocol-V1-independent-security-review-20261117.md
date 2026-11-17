# W3M Protocol V1 — Independent Internal Security Review

Date: 2026-11-17  
Branch: `w3m-v1-completion-20261116`  
Scope: source-level review of buyer-refund REQUEST / SIGN / FINALIZE, payment verification candidates, Safe readers, atomic SQL persistence, and isolated tests. This is an internal review performed separately from the CI pass/fail result; it is **not** a third-party audit or a live-chain integration certification.

## Executive decision

**Do not merge or deploy yet.** The branch contains substantial fail-closed controls and atomic persistence candidates, but the three real HTTP entrypoints have only just gained injectable test seams and mocked integration tests. Their new CI run must complete successfully on the final commit. Production payment functions are still the previously deployed versions and have not been replaced.

No production Supabase migration, Edge Function deployment, live-site change, Safe signature, transaction broadcast, or funds movement was performed during this review.

## Reviewed security boundaries

- REQUEST accepts only the deal identifier from the browser; derives the actor from Supabase bearer authentication and requires a server-side admin profile.
- REQUEST reloads a dedicated service-role snapshot, checks immutable buyer-win dispute decision and signed terms, verifies both EIP-712 agreement acceptances, verifies the original buyer-to-Safe BNB USDT funding receipt, reads the 2-of-3 Safe configuration and balance at a canonical block, decodes the exact two-transfer MultiSend payload, and persists through a service-role-only atomic RPC.
- SIGN derives the participant from Supabase Auth, reloads request/deal/dispute/decision/terms/profile/transaction/signature state, binds the role to the current verified participant wallet, recomputes the Safe transaction hash against canonical BNB Safe facts, recovers the raw-digest signature, and persists through the atomic SIGN RPC. The server does not sign or broadcast.
- FINALIZE is admin-gated, reloads the refund request and participant state, checks the Safe owner set and threshold, verifies the BNB receipt and exact refund/fee transfer evidence, then invokes the atomic finalization RPC. It does not sign or broadcast.
- SQL registries are RLS-enabled, direct table privileges are revoked, mutation is performed through service-role-only RPCs, and immutable receipt/signature records are protected by triggers.
- Payment candidate paths use fresh database-derived expectations, canonical BNB USDT/chain policy, strict receipt verification, and atomic payment finalization with transaction-hash uniqueness controls.

## Findings and remediation

### P1 — Production payment endpoints remain on the old deployed versions

The read-only production inventory identified `verify-deal-payment` ACTIVE version 62 and `deal-payment-monitor` ACTIVE version 44. Their recovered deployed sources had non-atomic multi-write persistence and weaker Transfer-log / canonical receipt binding. The branch contains candidate replacements and an atomic payment RPC, but those candidates have not been deployed.

**Disposition:** open production risk until a separately approved rollout replaces the deployed functions after review, data preflight, and integration validation. Do not treat branch code as a production fix.

### P1 — Refund finalization SQL used an inconsistent row-lock order

The dispute decision RPC and refund request RPC lock the dispute row before the parent deal. The finalization RPC originally locked the deal before the dispute, creating a reverse lock edge and a possible deadlock under concurrent dispute/refund activity.

**Remediation committed:** finalization now locks dispute → deal → Safe transaction, matching the decision/request order. The disposable SQL contract test now asserts dispute-before-deal ordering.

Commits: `9a97bda9a5eafba2db797ad830197ea6938b0b69`, `c7a13924a67742899bd410e36e36fc8d6fa64368`.

### P2 — Idempotent finalization replay did not compare all stored receipt economics

The original idempotent branch returned success when request/deal/decision/Safe transaction/broadcast hash/block hash matched, before validating that the retry carried the same buyer refund amount, platform fee, block number, and minimum confirmation evidence as the immutable receipt row.

**Remediation committed:** idempotent replay now binds the existing receipt to chain, Safe, token, buyer/platform wallets, exact block number/hash, both amounts, successful execution, and at least six confirmations. The SQL contract test checks these fields are part of the replay guard.

Commits: `1e89d580793b54a1c938855148d9193d9d5e5323`, `fad89dd03f5f92cda0811ef76fdbc655c75126ca`.

### P1 — Real Edge Function HTTP orchestration had not previously been exercised

The earlier lifecycle suite exercised handler-level dependencies, while the source-contract suite inspected source text. Neither actually invoked the three deployable Edge Function entrypoints with Supabase and BNB RPC substitutes.

**Remediation in progress:** the three entrypoints now expose injectable dependency factories while retaining `Deno.serve` as the production entrypoint. A new integration suite invokes the actual exported HTTP handlers and supplies mocked Supabase Auth/query/RPC and mocked BNB JSON-RPC clients. It checks the REQUEST atomic RPC, SIGN atomic signature RPC, and FINALIZE atomic receipt RPC. The test is wired into the isolated workflow.

Commits: `d3740c10c9c6de8bd2e85e18421c37c47e44f3d8`, `306cf815e0bd3ea5c5ea6f9bae9c1f2a660a74f2`, `4bf57e74cfca0d26b1f2642fcf2399c88a7f06db`, `cb56f112df3d1366e170e5ffa23859c88aeddb4d`, `f7dea8cd73c732c05e7c440b565756368a7a33cd`.

**Status:** not yet accepted as passing. Earlier CI attempts exposed stale source-contract assertions, which are being corrected; the new HTTP suite must complete on the final head. Do not claim this gate closed until the full CI run succeeds.

### P2 — Safe runtime code hash is not pinned

The Safe configuration reader verifies the expected v1.4.1 singleton address through storage slot 0 and `masterCopy()`, and checks that singleton code exists at the pinned block. It does not yet compare the singleton runtime bytecode hash against an independently pinned expected code hash.

**Disposition:** open hardening item. Before production use, pin and verify the exact canonical runtime code hash (including a documented compiler/metadata policy) or obtain an equivalent independently verified implementation identity.

### P2 — Production integration and operational controls remain unverified

Mocked HTTP tests cannot prove live Supabase schema compatibility, production JWT/role claims, provider consistency, actual BNB reorg behavior, RPC availability, or the real Safe execution path. The refund functions are not deployed and there has been no live-chain refund rehearsal.

**Disposition:** require a separate approved staging/integration rehearsal with non-production wallets and funds, RPC/provider failover tests, and a rollback plan before production rollout. This review did not use production credentials or send transactions.

## Required gates before merge

1. The latest isolated CI run on the exact PR head completes successfully, including the new actual-entrypoint mocked HTTP suite and both disposable PostgreSQL migration passes.
2. Review the test logs to confirm each endpoint actually reaches its expected mocked RPC and atomic Supabase RPC, and add negative cases for non-admin, wrong participant, stale Safe hash/nonce, malformed receipt, wrong chain, and persistence error with zero unintended writes.
3. Close or explicitly accept the Safe runtime-code-hash hardening item.
4. Complete a second-person security review of the final diff, especially the three entrypoints, both payment candidates, and all four refund/payment migrations.
5. Keep production rollout separate: verify live schema/data preconditions, test in an isolated staging project, then obtain explicit approval for production migration/deployment.

## Release isolation

- PR #198 remains Draft and unmerged, targeting the development base branch, not `main`.
- This review and all changes described here are branch-only.
- No production Supabase changes, migrations, Edge Function deployments, website updates, Safe signatures, transaction broadcasts, or funds movement occurred.


## Update — actual HTTP entrypoint suite reached success (2026-11-17)

- The mocked HTTP integration suite now executes all three exported production entrypoint handlers, not only the underlying handlers.
- It uses a fake Supabase client for Auth, table queries and RPC calls, plus a fake BNB JSON-RPC client. REQUEST, SIGN and FINALIZE happy paths each reach their expected atomic RPC. Negative cases verify non-admin REQUEST, non-participant SIGN, and non-admin FINALIZE are rejected without RPC writes or BNB RPC reads.
- The earlier FINALIZE fixture failure was a test-fixture defect: the mocked signature rows were missing their `request_id` filter key. The fixture was corrected; production logic was not weakened.
- On head `974104401d4f4540937e82a515f7e319f805a207`, workflow run [43977214533](https://github.com/Aminzaki1972/Web3Market/actions/runs/43977214533) passed the dedicated entrypoint integration step (step 30). The overall 108-step workflow is still running at this update, so the full CI gate remains open until the run completes successfully.


## Final isolated CI verification for the reviewed code head (2026-11-17)

- Reconstructed the finalization migration from the clean lock-order-corrected revision after the first idempotency-guard insertion produced a malformed SQL file. The final migration is a single transaction with one `COMMIT`; receipt amount formats are validated before the idempotent replay branch, then numeric values are compared directly to the immutable stored receipt.
- Final code head: `e1a2d227213e9ec42e630477e5af749c65c8b814`.
- Push workflow [43978094744](https://github.com/Aminzaki1972/Web3Market/actions/runs/43978094744) and pull-request workflow [43978103289](https://github.com/Aminzaki1972/Web3Market/actions/runs/43978103289) both completed with conclusion `success` on that exact head.
- Each run completed all 109 job steps successfully, including the actual REQUEST/SIGN/FINALIZE mocked HTTP entrypoint suite, the mocked refund lifecycle and adversarial cases, disposable PostgreSQL migration application, and timestamp-sorted migration replay on a second disposable database.
- This closes the current isolated CI gate for code head `e1a2d227...`. It does not close the second-person review, Safe runtime-code-hash pinning, live Supabase/BNB integration, or the production deployment gate.

## Update — Safe runtime hash pinned in code; mainline integration remains blocked (2026-11-17)

- Pinned the Safe v1.4.1 canonical singleton address `0x41675C099F32341bf84BFc5382aF534df5C7461a` to the official Safe Deployments manifest code hash `0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4`. The official manifest maps BNB Smart Chain chain ID 56 to the canonical deployment.
- The reader now computes Keccak-256 over the singleton runtime bytecode returned by `eth_getCode` at the same pinned canonical block and fails closed on empty code or a hash mismatch. Tests cover matching/mismatching hashes, empty code, and the default production Keccak implementation.
- Official reference: [Safe Deployments v1.4.1 safe.json](https://github.com/safe-global/safe-deployments/blob/main/src/assets/v1.4.1/safe.json). BscScan identifies the same singleton address as a verified Safe contract on BNB Smart Chain: https://bscscan.com/address/0x41675C099F32341bf84BFc5382aF534df5C7461a#code.
- Latest corrected code head: `5a087157a3fbc42f52bf770bc800524080b7c4b2`. Push workflow [44041589739](https://github.com/Aminzaki1972/Web3Market/actions/runs/44041589739) and pull-request workflow [44041595706](https://github.com/Aminzaki1972/Web3Market/actions/runs/44041595706) both completed successfully.
- **Important verification boundary:** the official manifest hash is now pinned and the code will compare live RPC bytecode against it, but this session did not retrieve raw singleton bytecode from an independent BNB RPC and independently recompute its hash. Therefore on-chain runtime equality is not yet marked as independently observed; it must be checked in a read-only RPC verification before production activation.
- **Mainline integration blocker:** PR #198 targets `w3m-v1-finalization-adapter-tests-20261112`, not `main`. GitHub reports that base branch and `main` are diverged (1,738 commits ahead / 13 behind; 284 files differ in the branch comparison). The PR itself changes 58 files, and only one of those paths currently exists on `main`. Retargeting or merging the current branch directly to `main` would risk importing unrelated history and code. A clean integration branch based on current `main` must be assembled and validated before a safe merge.
- No PR merge, production Supabase migration, Edge Function deployment, website change, transaction, signature, or funds movement occurred.
