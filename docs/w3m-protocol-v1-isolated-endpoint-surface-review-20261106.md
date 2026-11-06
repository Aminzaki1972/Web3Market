# W3M Protocol V1 — isolated endpoint surface review

Date: 2026-11-06
Branch: `w3m-protocol-v1-isolated-20261105`
Reviewed branch head: `a651648020b68f3ad50687a2a188c4d9af3a7311`
Latest observed CI: `42205634315` — success.

## Scope and safety

This review covers only source files in the isolated branch. It does not invoke any endpoint, connect to Supabase, read business rows, call a live Safe, sign a transaction, or broadcast a transaction. The new `w3m-protocol-v1-*` directories are separate function names and do not replace the deployed Safe functions. No migration or function is deployed by this review.

## Isolated HTTP entrypoints found

| Endpoint directory | Responsibility | Observed boundary |
|---|---|---|
| `w3m-protocol-v1-deal-agreement` | Buyer/seller EIP-712 agreement acceptance | Authenticated server request handler; service-role RPC adapter |
| `w3m-protocol-v1-prepare-deal-release` | W3M PREPARE before release preparation | Authenticated caller; request supplies deal ID; reloads state server-side; reads BNB Safe configuration at a pinned block and checks the block hash remains canonical |
| `w3m-protocol-v1-safe-sign` | Record owner signature | Authenticated user; reloads fresh Safe context; verifies raw digest signature; persists through atomic signature adapter |
| `w3m-protocol-v1-safe-wallet-package` | Build connected-wallet execution package | Authenticated user; fresh context and live BNB facts; no server-held private key and no server broadcast |
| `w3m-protocol-v1-safe-wallet-submit` | Persist browser-submitted transaction hash | Authenticated persistence; source explicitly treats browser hash as unverified and does not broadcast or finalize |
| `w3m-protocol-v1-finalize-safe-release` | Verify chain receipt and atomically finalize | Authenticated request; fresh snapshot receipt verifier; configured confirmation count |

## Positive architecture observations

- The endpoints are separate directories, not replacements for the live function directories.
- Service-role credentials are read only from server environment and are not returned to the browser.
- The PREPARE endpoint only accepts the deal identifier as caller-controlled business input; its comments state that amounts, wallets, policy, report and Safe facts are reloaded.
- PREPARE pins its Safe configuration reads to a BNB block and checks that block hash again after the read.
- SIGN loads fresh context and verifies the signature before atomic persistence.
- Wallet package composition is non-custodial: the connected owner wallet submits the Safe transaction; the endpoint does not hold a server private key or broadcast.
- Wallet submission hash is explicitly unverified at intake; it cannot itself authorize finalization.
- Finalization requires a fresh server-side chain receipt verification path and a confirmation count configured within 1–1000.
- The latest workflow run `42205634315` reports success for its listed Deno type-check/test steps, including agreement, PREPARE, SIGN, package, submit, execution coordinator, receipt verifier, and finalization request boundary tests.

## Remaining blockers before an isolated V1 end-to-end milestone

1. **Report issuance runtime:** no dedicated HTTP entrypoint was found that authenticates a report-issuance request, loads all authoritative project/deal/provider evidence, signs with a protected W3M private key, verifies trusted-key status, and persists the report. The reusable report service composition is not by itself a deployed runtime.
2. **End-to-end composition:** the six HTTP entrypoints are independently wired to services/adapters, but no single disposable full-flow test currently demonstrates agreement → report issuance → PREPARE → Safe owner signatures → connected-wallet package → wallet submission → receipt verification → atomic finalization.
3. **Connected-wallet submission proof:** the submit endpoint correctly treats the browser-provided transaction hash as unverified. The finalization path must be demonstrated to independently bind the attempt, transaction hash, Safe transaction hash, chain ID, receipt, Safe execution event, and exact token transfers before state changes.
4. **External provider credentials and policy:** provider adapters exist, but no protected runtime configuration/credential integration was verified in this source review. Provider failures must remain fail-closed.
5. **Deployment compatibility:** no migration or endpoint has been deployed. Disposable PostgreSQL fixtures do not prove exact production trigger/FK/RLS compatibility. Production schema reconciliation, staging deployment and review remain separate gates.
6. **Production replacement:** the six existing deployed Safe Edge Functions remain unchanged. The new endpoints do not yet redirect or replace production callers; any cutover requires a separately reviewed migration/caller plan and explicit approval.

## Required next engineering sequence

1. Implement the report-issuance HTTP boundary with authenticated authorization, server-side evidence loading, protected signer injection, trusted-key verification, and atomic report persistence. Keep credentials absent from browser inputs and logs.
2. Add a disposable full-flow integration harness with mocked provider and BNB RPC boundaries plus disposable PostgreSQL. Exercise every transition, replay, stale-evidence, changed-terms, disputed-deal, malformed receipt, missing-event, and wrong-transfer negative case.
3. Verify the connected-wallet submit path cannot finalize from a caller-supplied hash without independent chain verification.
4. Run the full isolated workflow and review every failing/blocked path. Only after this milestone should staging compatibility be discussed.
5. Keep all current work isolated. No merge, deploy, production DB change, Safe interaction, real signing, or funds movement is authorized by this review.

## Readiness conclusion

The isolated branch contains a substantial server-side endpoint surface and passing component-level CI. It is **not yet a verified end-to-end protocol**, and it is **not production-ready**. The most valuable next deliverable is the missing report-issuance runtime plus a disposable end-to-end test harness, not a production deployment.
