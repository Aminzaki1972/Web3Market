# W3M Protocol V1 — Asset Transfer Adapter Contract

**Status:** Isolated implementation specification; provider integrations are not connected.
**Branch:** `w3m-protocol-v1-isolated-20261105`
**Production impact:** None. No OAuth app, registrar account, RPC endpoint, database, wallet, or Safe is configured by this document.

## 1. Purpose

The asset-transfer orchestrator is a provider-neutral state machine. It records the lifecycle of each asset independently and allows acquisition completion only after every mandatory asset reaches `BUYER_CONTROL_VERIFIED`.

Implementation:
- `supabase/functions/w3m-acquisition-verification/asset-transfer-orchestrator.ts`
- `supabase/functions/w3m-acquisition-verification/asset-transfer-orchestrator.test.ts`

The engine is pure domain logic. It does not call provider APIs, mutate external ownership, store credentials, or authorize a Safe release.

## 2. Trust boundary

Only a trusted server-side adapter may produce an `AssetTransferEvent` with `authoritative: true`. The value must never be accepted from browser input.

A trusted adapter must:
1. Authenticate to the provider using a least-privilege OAuth installation, delegated account authorization, or provider-issued API credential.
2. Fetch the canonical asset and ownership state directly from the provider.
3. Bind the result to the exact deal, project, asset, seller identity, and buyer identity.
4. Preserve provider record ID, provider event ID, source version/ETag or equivalent, and observation time.
5. Canonicalize a minimized proof snapshot and compute its SHA-256 hash server-side.
6. Apply provider-specific rules before emitting a normalized event.
7. Use an idempotency key derived from the provider event or transfer operation.
8. Treat missing permissions, ambiguous identities, delayed provider responses, and unsupported APIs as `REVIEW_REQUIRED` or `INCOMPLETE`, never PASS.

The orchestrator validates normalized event structure and ordering. It cannot independently prove that a provider response is genuine; adapter authentication and server-side provenance are mandatory prerequisites.

## 3. Normalized asset lifecycle

Each mandatory asset follows this state progression:

`DISCOVERED`
→ `SELLER_CONTROL_VERIFIED`
→ `TRANSFER_REQUESTED`
→ `TRANSFER_PENDING` (if the provider is asynchronous)
→ `TRANSFER_CONFIRMED`
→ `BUYER_CONTROL_VERIFIED`

Exceptional states:
- `FAILED`: the provider has authoritatively rejected or failed the requested transfer.
- `REVIEW_REQUIRED`: ownership is ambiguous, a provider signal conflicts, or human action is required.

A transfer confirmation is not enough by itself. A separate provider read must verify that the buyer now controls the asset. Duplicate provider events are idempotent; reusing an event ID with different proof is rejected. A failed or review-required asset cannot silently resume through the normal transition path.

The portfolio is:
- `PASS` only when at least one mandatory asset exists and every mandatory asset is buyer-verified.
- `INCOMPLETE` while a required asset is pending or the mandatory asset inventory is empty.
- `BLOCKED` when a mandatory transfer has authoritatively failed.
- `REVIEW_REQUIRED` when a mandatory asset requires authorized review.

## 4. GitHub repository adapter

### Seller control
- Use a GitHub App installation or user-authorized OAuth flow; do not request a personal access token in the browser.
- Resolve the repository by immutable repository ID, not only `owner/repo` text.
- Read the repository's current owner account/organization ID and verify the seller's authorized administrative control.
- Verify the repository is the exact repository declared in the deal and pinned during due diligence.

### Transfer
- Initiate GitHub's official repository-transfer operation only after both parties have accepted the exact asset and destination owner.
- Treat an invitation or transfer request as `TRANSFER_REQUESTED`, not as completed ownership.
- Track asynchronous acceptance and provider state; recipient acceptance may be required.
- Never infer ownership transfer from collaborator, team, or administrator access alone.

### Buyer verification
- Re-fetch the repository by immutable repository ID after the provider confirms transfer.
- Verify the owner ID equals the buyer's pre-authorized GitHub account or organization ID.
- Verify repository visibility, archived state, default branch, and agreed access requirements remain acceptable.
- Store the provider's transfer event/record and a fresh post-transfer read as separate evidence.

If the buyer has not accepted the transfer, keep the asset pending. If GitHub permissions or API access do not allow a reliable owner check, do not issue PASS.

## 5. Domain registrar adapter

There is no universal registrar API. Each supported registrar needs its own adapter and capability declaration.

### Seller control
- Verify the exact domain at the registrar using an authorized account connection.
- Prefer registrar account/domain ownership and registrant data where the provider exposes them.
- DNS records, nameserver control, or a website verification TXT record prove some control, but do not by themselves prove registrant ownership.

### Transfer
- Distinguish an account push within the same registrar from an inter-registrar transfer and from a registrant/contact change. They are different operations and have different evidence.
- Respect registrar locks, transfer eligibility windows, registry policies, email approvals, and mandatory waiting periods.
- Do not report a domain as transferred merely because nameservers or DNS records changed.

### Buyer verification
- Re-read registrar-side owner/account/registrant state after the provider reports completion.
- Match the exact buyer identity and domain.
- If registrant privacy, local policy, or provider API limitations prevent verification, set `REVIEW_REQUIRED`; do not treat DNS control as a substitute.

A first release should support one registrar with a documented API and explicit capability limits, rather than claiming universal domain support.

## 6. Blockchain wallet and smart-contract adapter

### Revenue verification
- Pin chain ID, contract addresses, token addresses, wallet addresses, block range, and the revenue definition in the deal terms.
- Read canonical logs and transaction receipts from an RPC provider; verify receipt status and required event signatures.
- Track block number and block hash, then wait for the chain's configured finality/confirmation policy before treating evidence as final.
- Handle chain reorganizations by invalidating affected evidence and recomputing the report.
- Deduplicate by chain ID + transaction hash + log index.
- Separate gross receipts, refunds, internal transfers, token decimals, fees, and net revenue.
- Convert token values to fiat only with an explicit, timestamped price source and disclosed methodology.
- Compare on-chain receipts only to the seller's declared on-chain revenue scope. Do not claim this proves off-chain revenue, cash sales, exchange balances, or unlisted wallets.

### Ownership/control and transfer
- For an externally owned account, prove control using a fresh challenge signature from the relevant address; do not ask the seller to reveal a private key or seed phrase.
- A signature proves control of the signing key, not legal ownership or exclusive control if the key is shared or compromised.
- For smart contracts, inspect owner/admin roles, proxy admin, upgrade authority, multisig owners and threshold, timelocks, and any role-based access controls relevant to the agreed asset.
- Define the required transfer action per contract. Ownership renunciation, role transfer, proxy-admin transfer, and multisig owner replacement are not interchangeable.
- After the transfer transaction is final, re-read contract roles/owners and verify the buyer's exact address and required permissions.

The adapter must not submit a transaction automatically unless the deal explicitly authorizes that action, the current owner signs it, and the operation has been independently reviewed. V1 can begin with read-only revenue verification and externally initiated transfer proof.

## 7. Provider capability registry

Every adapter must publish a server-side capability record for each supported provider/asset type:

- `canReadOwner`
- `canVerifySellerControl`
- `canInitiateTransfer`
- `requiresBuyerAcceptance`
- `canReceiveTransferWebhook`
- `canVerifyBuyerControl`
- `supportsIdempotency`
- `supportsVersionOrETag`
- `knownDelayOrLockRules`

The orchestrator must not assume a capability that the provider does not expose. If `canVerifyBuyerControl` is false, that asset cannot satisfy mandatory transfer evidence in V1.

## 8. Operational safeguards

- Use webhook notifications for speed, but always perform an authenticated provider read before accepting a state-changing event.
- Use polling as a fallback for missed webhooks; polling must be bounded and rate-limit aware.
- Persist an outbox/idempotency record before external transfer requests to prevent duplicate requests after retries.
- Use exponential backoff for transient provider failures; do not convert timeouts into transfer failures.
- Keep credentials server-side and scoped to the minimum permissions.
- Store only minimized evidence snapshots; never store OAuth secrets, API keys, private keys, seed phrases, or full sensitive provider payloads.
- Keep per-asset status visible in Deal Room, but only the server may change authoritative status.
- A partial asset transfer never authorizes final settlement for a deal whose terms require all listed assets.

## 9. V1 implementation order

1. Complete and validate the provider-neutral state machine and tests.
2. Implement GitHub read-only seller/buyer ownership verification in an isolated environment.
3. Add GitHub transfer initiation only after destination identity and buyer acceptance handling are proven.
4. Implement BNB read-only revenue evidence for one explicitly configured contract/wallet set.
5. Add one registrar adapter only after selecting a provider with documented API access.
6. Connect adapter evidence to the W3M evidence decision engine.
7. Integrate the resulting asset portfolio decision with the authoritative Deal Room/Safe backend only after its exact source and schema are obtained.

## 10. Explicit non-claims

At this stage:
- No provider connector is implemented by this state-machine module.
- No repository, domain, wallet, or contract has been transferred.
- No revenue has been verified against a real deal.
- No production settlement is gated by this module.
- Provider API availability, pricing, rate limits, and account permissions must be confirmed per provider before promising fully automatic operation.
