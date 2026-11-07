# W3M V1 — Safe settlement gate integration

This is a **staged source patch only**. It does not change any deployed Supabase Edge Function.

The shared gate is `supabase/functions/_shared/w3m-v1-finalization-gate.ts`. It calls the service-only `w3m_get_deal_finalization_evidence` RPC, reloads the current deal, audit binding, fingerprint, current terms version, and persisted acceptance rows, then independently verifies the exact buyer/seller EIP-712 signatures using the V1 verifier.

The database now freezes acquisition terms after the first party acceptance. This prevents a later terms publication from invalidating or racing the accepted terms. The finalization evidence RPC returns normalized hashes and canonical UTC acceptance timestamps for independent signature verification.

## Staged Safe function snapshots

The following source files were retrieved read-only from the live Supabase project, then copied into this PR branch and patched to call the shared gate before their sensitive operation.

| Function | Live version at retrieval | Live source SHA-256 |
|---|---:|---|
| `create-safe` | 56 | `d888f48d48c87563e20e43318f9187c0f02d9a46fbe5e037cadbb5520b918e07` |
| `prepare-deal-release` | 43 | `6c670d08fbb55fdc61a10c39b5f32062d311934228df59ce23096d337ba52e18` |
| `prepare-safe-release-tx` | 37 | `f4248dde096a3532befca8dbd894cdb3bb6511bdf2d6a70c8e253b9587b01dfe` |
| `record-safe-release-signature` | 24 | `fb4fedf2c17245b52d2920d3ac13c426b02a49d176dc96e75237c599840d5d01` |
| `execute-safe-release` | 28 | `e51aa4f2dffe259292a627b0ab1c3663c5f2ef46b7792cd96c156c452eb65d22` |
| `finalize-safe-release` | 25 | `4f39f60122f79198fd8b2051cefd172d600f1c1d3a5d48310b40620957efd5ce` |

## Gate placement

- `create-safe`: before Safe deployment and database policy writes.
- `prepare-deal-release`: before release policy preparation.
- `prepare-safe-release-tx`: before Safe release transaction preparation.
- `record-safe-release-signature`: before recording Safe signatures.
- `execute-safe-release`: before the actual on-chain execution path (read-only/check mode remains available).
- `finalize-safe-release`: before marking a release complete; it also independently blocks finalization when a dispute is open or dispute status cannot be verified.

Each function fails closed with HTTP 409 if the current W3M buyer/seller acceptance pair is absent, stale, incomplete, or cryptographically invalid. The static CI regression checks that the gate call appears before the corresponding sensitive action in all six staged sources. It also verifies dispute checks before Safe deployment, signature recording, and finalization; payment and buyer-approved delivery before signature recording/execution; locked release policy; and consistent Safe address, BNB chain, and configured BNB USDT asset before the settlement actions.

Latest branch CI at the verified code head: 107 Deno tests passed; the PostgreSQL migration/concurrency/privilege suite passed; CDN integrity, profile-guard migration, and modified JavaScript syntax checks passed. New protocol modules and the shared gate pass Deno type-check.

The new protocol modules and shared gate are included in Deno type-check. The six staged Safe entrypoints are covered by source-order regression checks rather than full Deno type-check because their existing legacy source contains unrelated typing errors around Safe Protocol Kit initialization, ethers dynamic contract methods, and implicit/unknown error types. Those typing issues are not changed by this V1 gate patch.

## Important deployment boundary

- These are branch snapshots, not live deployments.
- No production Edge Function has been updated.
- The SQL migration has only been exercised in disposable PostgreSQL CI.
- No Safe transaction, release, or financial transfer was executed. V1 uses Safe Wallet only; it does not introduce a separate escrow contract.
- Canonical acquisition terms remain unpublished until their authoritative content is approved; this patch does not invent governing law, inspection criteria, or dispute rules.


## Remaining V1 integration blockers — verified 2026-11-07

The source review found that the browser acceptance coordinator is not yet wired into the live Deal Room page:

- `js/w3m-deal-agreement-client.js` explicitly documents that it is not imported by the Deal Room.
- `js/deal-room.js` still loads and writes the legacy `deal_party_agreements` rows directly through an upsert when a participant clicks “I Agree to Deal Terms”.
- The new `w3m-acquisition-verification` Edge Function is not deployed in the production Supabase project, and its V1 acceptance-ledger migration is not applied there.
- The V1 preparation handler rejects acceptance when no published canonical acquisition terms exist. The protocol documentation intentionally leaves those terms unpublished until their authoritative content is approved.

Therefore the V1 acceptance path is tested in isolation but is **not yet the active Deal Room acceptance path**. Do not enable the new Safe finalization gates in production until the canonical terms are approved, the Deal Room displays the exact terms being signed, the browser client is integrated and tested, and the Edge Function plus migration are deployed in a separately approved release. This is a V1 completion dependency, not authorization to add scope or incur cost.

The migration source review also confirms that protocol RPC execution is revoked from `public`, `anon`, and `authenticated`, then granted only to `service_role`; private protocol tables have RLS enabled and direct client mutation is blocked by grants and immutability triggers. These are source-level findings; the migration remains unapplied to production.


## Safe-only wording clarification

The canonical-terms validator currently requires an `escrow` JSON section for funding condition, release condition, and dispute hold. In W3M V1 this section must be interpreted strictly as contractual descriptions of the **Safe Wallet multisig settlement process**. It must not identify, deploy, call, or imply a separate escrow smart contract. Payment method remains `safe_multisig` on BNB Smart Chain (56). Any user-facing terms renderer must say Safe Wallet / Safe multisig, not suggest that Web3Market operates an independent escrow contract.

## Canonical terms content still requiring approval

The validator intentionally rejects placeholder policy text. Before any real party can sign, the authoritative V1 terms must contain approved values for delivery checklist/deadline, inspection window and acceptance criteria, dispute procedure/version, Safe funding and release conditions, dispute hold, governing law or agreed process, venue, language, risk acknowledgements, and disclosures. These values must not be guessed or silently populated from UI copy. No canonical terms have been published by this branch.

## Deal Room integration contract — source review 2026-11-07

The Deal Room integration must not treat the legacy `deal_party_agreements` table as V1 acceptance evidence. The V1 client coordinator can prepare and submit a typed-data signature, but the current Edge Function response contract does not expose a read-only acceptance-status action for the other party. The private acceptance ledger is intentionally inaccessible to browser roles.

Required V1 integration sequence:

1. The page obtains the authenticated Supabase access token and the already verified profile wallet. It must not accept a wallet address supplied only by page state as authoritative.
2. Before signing, the page obtains the exact published canonical terms for the deal from a trusted server response and displays the complete terms/version/hash to the participant. No client-side invention or defaulting of policy fields is permitted.
3. The page invokes `prepare`; the server derives the buyer/seller role, verified wallet, immutable audit binding, and currently published terms. The page validates the returned typed-data domain and every binding before opening the wallet signature request.
4. The page invokes `accept` with the persisted challenge ID and signature. It displays success only after the server confirms the persisted acceptance ID.
5. A read-only server action is required to expose the two parties' acceptance states and their common terms version/hash without granting browser access to private protocol tables. This action must be authorization-scoped to deal participants (and the permitted platform moderator view), return no private signature material, and be tested for cross-deal isolation.
6. The Deal Room must distinguish legacy historical agreement rows from V1 cryptographic acceptances. It must not dual-write a legacy row and then present that row as a V1 signature.
7. Safe creation, release preparation, signature recording, execution, and finalization remain blocked unless the server-side V1 finalization gate independently confirms the exact current buyer/seller acceptance pair and all existing Safe/payment/delivery/dispute checks.

The current V1 browser coordinator's request/response shapes match the existing `prepare` and `accept` handler shapes in source review. This does not establish a complete page integration: the HTML page does not load the coordinator, the Deal Room still uses the legacy agreement table, there is no read-only acceptance-status action, and the page does not yet render the authoritative canonical terms. These are explicit V1 integration tasks.

No production files, database records, Edge Functions, secrets, or DNS were changed by this review. No paid environment or service was used.

## Participant-scoped agreement status action — staged V1 implementation

The `w3m-acquisition-verification` handler now includes a read-only `status` action. It authenticates the bearer token, reloads the deal, permits only its buyer or seller, reloads the currently published terms from the private protocol schema, recomputes the canonical terms hash before returning the terms, and checks each acceptance against the expected deal-party user ID, role, current terms hash, and version.

The response contains the canonical terms needed for the Deal Room to display the exact published agreement, plus buyer/seller accepted flags and timestamps. It deliberately omits signatures, nonces, challenge IDs, and wallet metadata. A mismatched party or stale acceptance is not reported as accepted. The browser client now has a matching `getW3MDealAgreementStatus` adapter with response-shape and deal-ID validation.

Regression coverage was added for participant-only access, cross-account denial, terms-hash integrity, same-version acceptance state, and absence of signature/challenge material in the response. These are source-level test additions on the feature branch; CI has not yet reported a run for the latest commits, so they are **not yet counted as passing tests**.

The action and adapter are not yet connected to the live Deal Room page. That integration remains blocked on the approved canonical terms and a separately approved deployment of the migration and Edge Function. No production resources were changed.

### Latest CI verification for agreement status work — 2026-11-07

On the PR merge ref containing the status endpoint, client adapter, and regression tests:
- Deno suite: **111 passed, 0 failed**. This includes the new participant-scoped status handler and browser adapter tests.
- Deno type-check: **passed** for the acquisition-verification handler, entrypoint, V1 protocol modules, and shared finalization gate.
- PostgreSQL 16 V1 ledger migration/concurrency/privilege job: **passed**.
- Modified browser JavaScript syntax and CDN SRI checks: **passed**.
- Profile-guard migration job: **passed**. All three workflow runs and all five jobs in this CI batch completed successfully.

These are CI tests against the staged branch and disposable PostgreSQL, not a live Supabase integration test. No production migration or Edge Function deployment occurred.

## Deal Room wallet-signing adapter review — 2026-11-07

The Deal Room already loads the authenticated user's profile and checks `wallet_verified` plus the canonical `profiles.wallet_address`. The existing wallet manager exposes provider discovery and ownership verification, but it does **not** currently expose a typed-data signing method that binds the selected provider to that same canonical verified wallet. The V1 agreement client deliberately requires an injected `signTypedData(walletAddress, typedData)` callback.

Therefore the remaining page integration must add a wallet-manager adapter that:
- resolves the provider associated with the linked wallet, rather than blindly using `window.ethereum`;
- confirms the currently selected account equals the server-verified profile wallet;
- confirms BNB Smart Chain chain ID 56 before requesting EIP-712 signing;
- signs only the exact server-returned typed data after the client validates domain and deal/audit/terms bindings;
- submits the signature to the authenticated V1 endpoint and refreshes the participant-scoped status;
- never requests a transaction, token approval, transfer, or Safe execution as part of agreement signing.

The current Deal Room's legacy `deal_party_agreements` rows remain historical UI state only and must not be upgraded or represented as cryptographic V1 acceptance. Do not replace the existing page flow until the provider adapter and end-to-end wallet interaction are tested in a safe, free test environment. This is a V1 completion blocker, not a request for a new feature.

## Verified-wallet EIP-712 signing adapter — 2026-11-07

Added `signTypedDataForVerifiedWallet(walletAddress, typedData)` to the existing browser wallet manager and exposed it through `window.Web3MarketWalletManager`.

The adapter:
- requires a valid address and typed-data object;
- resolves the provider route saved for that exact verified address (no arbitrary `window.ethereum` fallback);
- requires the provider's active `eth_accounts[0]` to equal the verified profile wallet;
- requires the provider to already be on BNB Smart Chain chain ID 56 (it does not silently switch networks);
- requests only `eth_signTypedData_v4` and validates the returned 65-byte ECDSA signature;
- does not call `eth_sendTransaction`, approve tokens, transfer assets, or execute Safe operations.

The agreement client remains responsible for validating the server-prepared EIP-712 domain, message fields, deal ID, audit fingerprint, binding hash, canonical terms hash/version, party role, wallet, nonce, and deadline before invoking the signer callback.

**Integration status:** the adapter is added to the V1 branch but is not yet called by Deal Room. Dedicated provider-mock tests and full browser-wallet integration tests remain required before wiring it into the page. The production page and production services remain unchanged.

## Verified wallet signer hardening and isolated tests (2026-11-07)

The browser wallet signer now independently validates the fixed W3M V1 EIP-712 envelope before making any wallet RPC call: the exact domain (Web3Market Deal Agreement / version 1 / chain 56), the exact DealTermsAcceptance field schema, the complete message key set, bytes32/address formats, buyer-or-seller role, positive numeric terms version/deadline, and equality between the signed wallet and the verified profile wallet. The agreement client remains responsible for binding those values to the server-prepared deal, audit fingerprint, evidence binding, and canonical terms.

The signer resolves only the provider route stored for the verified wallet address, checks the active account and BNB Smart Chain ID, and calls only `eth_signTypedData_v4`. It does not switch networks, submit transactions, request token approvals, transfer funds, or execute Safe operations.

Added isolated provider-mock tests covering successful signing, wrong active account, wrong chain, altered domain/schema/wallet binding, malformed signatures, and missing provider route. The V1 fingerprint workflow now includes this test file and read permission limited to the repository's `js/` test source directory plus the existing Supabase function test directory.

CI status must be read from the workflow run attached to this commit before treating these new tests as passed. Earlier successful V1 ledger/fingerprint/security runs predate this signer hardening and are not evidence that this new test file passed. No production page, Supabase project, Edge Function deployment, database migration, or Safe transaction was changed.

## Isolated Deal Room agreement status renderer (2026-11-07)

Added `js/w3m-deal-agreement-panel.js` as a read-only renderer for the server-authorized W3M V1 agreement status adapter. It builds DOM nodes and writes all server-provided terms and timestamps through `textContent`; canonical terms are displayed in a `pre` element, never injected through `innerHTML`. It shows the published terms version/hash, buyer/seller acceptance state, and the server's eligibility flag. It has no signing, payment, Safe, or transaction controls.

The renderer is intentionally **not imported by `deal-room.html` or `js/deal-room.js`**. It remains isolated until the V1 Edge Function and migration are deployed under a separately approved release, and until the canonical legal/commercial terms are approved. Existing Deal Room and Safe flows remain unchanged.

Provider-mock signer tests and renderer safety tests are included in the V1 Deno workflow. The workflow run `42417887737` completed successfully on commit `b9e6e5b1c0967533bfe36c4b139b3f3a22bc550e`, including the Deno test step and type-check step. This is isolated CI validation, not live browser-wallet/Supabase integration. No production page, database, Edge Function deployment, migration, or Safe transaction was changed.
