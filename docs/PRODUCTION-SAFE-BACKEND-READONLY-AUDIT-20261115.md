# Production Deal/Safe Edge Function Read-Only Audit

Date: 2026-11-15
Scope: read-only retrieval of currently deployed Supabase Edge Function source and read-only SQL inspection of relevant constraints/policies.
Project: existing Web3Market Supabase project.
Status: findings only; no production writes, deployments, configuration changes, wallet signing, or transactions.

## Functions inspected

The following deployed Edge Functions were returned as ACTIVE with JWT verification enabled:
- `create-safe`
- `verify-deal-payment`
- `prepare-deal-release`
- `prepare-safe-release-tx`
- `record-safe-release-signature`
- `execute-safe-release`
- `finalize-safe-release`

Their source is deployed in Supabase but is not tracked under the isolated repository branch's `supabase/functions` tree. The current branch therefore cannot safely modify or test those deployed function sources as ordinary repository code.

## Critical compatibility findings

### 1. No new dispute-request or payout-hold integration

The release-preparation and execution functions check:
- `deals.dispute_status`; and
- legacy `deal_disputes` rows.

They do not read the proposed `deal_dispute_requests` or a separate active hold record. Those new records do not yet exist. Once a new request workflow is introduced, the old release functions would not automatically see its pending administrative-review hold.

The legacy database function `open_deal_dispute` immediately inserts a dispute and changes `deals.status` to `disputed`. This is not the new request/review workflow.

### 2. Safe Guard is not deployed or verified by the inspected functions

- `create-safe` deploys a Safe with buyer, seller and platform owners and threshold 2. Its source does not install a Guard or Module Guard.
- `prepare-deal-release` checks Safe address, owners and threshold, but not Guard/Module Guard configuration.
- `prepare-safe-release-tx` checks Safe owners, threshold, version, nonce and release payload, but not Guard/Module Guard configuration.
- `execute-safe-release` checks owners, threshold, nonce, signatures and transaction hash, but does not verify a required Guard/Module Guard.
- `finalize-safe-release` checks the mined receipt, Safe ExecutionSuccess event and expected USDT transfer logs, but does not establish Guard configuration or confirmation depth.

A database dispute check is not an on-chain lock. A participant with the required recorded Safe signatures can call the active execution endpoint directly, independently of whether the old Deal Room button is visible. The isolated branch has disabled its legacy UI calls, but no production function was changed or disabled by this work.

### 3. Commission arithmetic conflicts with the approved new rule

The deployed `validate_deal_release_policy` function calculates:
`round(deal.amount * 7.5 / 100, 8)`.

The new agreed accounting rule requires:
- USDT 6-decimal base units;
- `floor(G * 750 / 10000)`;
- no rounding upward;
- exact balanced allocation and one fee deduction.

The current `deal_release_policies` CHECK constraint enforces a round-to-18-decimal relationship, which also differs from the new floor-to-6-decimal rule. The existing release path must not be reused for the new accounting model without a reviewed migration and tests.

### 4. Payment verifier does not pin the configured token to official USDT

`verify-deal-payment` validates the transaction target against `deals.token_contract`, reads that token's decimals, checks a matching Transfer event and requires 3 confirmations. It does not itself require the configured token address to equal the approved official BNB Smart Chain USDT contract.

The later release-preparation function does require its token policy to equal the hard-coded USDT address. This creates an inconsistent gate: a payment could be accepted by the verifier using a different configured token contract, while the release path later refuses that policy.

The payment verifier also computes the 7.5% fee using JavaScript Number arithmetic and writes the fee fields after updating payment confirmation. This is not the required integer base-unit floor calculation.

### 5. Legacy agreement and buyer-review requirements are not bound to release

The inspected release path relies on legacy deal/payment/delivery fields and `validate_deal_release_policy`. It does not bind execution to the new immutable agreement version/hash, three-party approvals, individual asset acceptance records, optional review-period deadline semantics, or a separately authorized administrative dispute decision.

### 6. Signature endpoint limitations

`record-safe-release-signature` verifies the participant session, verified wallet, current Safe owner membership, current threshold/nonce, and EIP-712 digest. However:
- it does not check the new dispute-request/hold state;
- it does not bind the signature to the new approved agreement version/hash;
- it only accepts buyer/seller participant sessions, so the platform Safe owner cannot submit its own signature through this endpoint even though the Safe is configured 2-of-3;
- it does not provide the new administrative decision/settlement workflow.

The signer table currently has unique constraints on `(deal_id, signer_role)` and `(deal_id, wallet_address, safe_tx_hash)`. This is useful duplicate protection but does not provide the new agreement or dispute authorization.

### 7. Execution/finalization race and atomicity

`execute-safe-release` checks the old dispute state, then separately reads records and submits a Safe transaction. There is no atomic transaction spanning the database check and on-chain execution. Without an on-chain Guard, a new hold cannot reliably prevent an already-authorized Safe transaction from executing.

`finalize-safe-release` checks that a transaction is mined, successful, sent to the configured Safe, has the matching Safe ExecutionSuccess event, and contains the expected seller/platform USDT transfers. However:
- it does not check the new request/hold state;
- it does not require a configured confirmation depth beyond the transaction being mined;
- it updates multisig, release policy, deal, project and audit records sequentially rather than in one database transaction, so partial failure can leave inconsistent records.

## Relevant live schema observations

Read-only SQL inspection confirmed:
- `deal_multisig_signers` unique `(deal_id, signer_role)`;
- `deal_multisig_signers` unique `(deal_id, wallet_address, safe_tx_hash)` when the Safe transaction hash is non-null;
- legacy signer role permits buyer, seller and platform;
- `deal_multisig_transactions` requires exactly 2 signatures and permits legacy actions `deposit`, `release_to_seller`, `refund_to_buyer`;
- `deal_release_policies` uses a per-deal unique row and its current arithmetic CHECK is round-based;
- participant SELECT policies exist on signer, multisig transaction and release policy tables; this inspection did not establish any new backend authorization contract.

## Required treatment

1. Keep the isolated Deal Room transaction controls disabled.
2. Do not use the deployed legacy release functions as the new workflow.
3. Recover and track the canonical source for the deployed Edge Functions before attempting code changes.
4. Design the new request/hold checks as server-side transactional state and enforce every payout endpoint against them.
5. Require an on-chain Safe Guard/Module Guard design and independent verification before enabling any outgoing transaction.
6. Replace legacy commission calculations with the exact approved integer base-unit floor rule in one reviewed accounting implementation.
7. Pin payment verification to the exact official BNB Smart Chain USDT contract and validate the full receipt/log/confirmation evidence.
8. Bind every approval, signature, release and dispute allocation to the exact approved agreement version/hash.
9. Make finalization idempotent and atomic, and require the agreed confirmation depth.
10. Test all of this on an isolated free test environment before considering production changes.

## Safety boundary

This audit only retrieved function source and queried metadata/definitions. It did not invoke any deployed Edge Function endpoint, alter any production table, change any function, apply any migration, sign a wallet, or submit a blockchain transaction. No paid resource was created. The isolated branch remains unmerged and undeployed.
