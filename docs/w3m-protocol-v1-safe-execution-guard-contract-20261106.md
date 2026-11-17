# W3M Protocol V1 — Safe Execution Guard Contract

Captured: 2026-11-06  
Branch: `w3m-protocol-v1-isolated-20261105`  
Status: isolated pure-code implementation; not connected to or deployed in the six active production Edge Functions.

## 1. New execution composition

`safe-execution-guard.ts` composes four independent requirements into one fail-closed decision:

1. `evaluateSettlementGate(...)` — latest PASS report, deal/project binding, validity, report signature, trusted signer state, evidence hash, unchanged deal terms, confirmed payment, buyer acceptance, no dispute, Safe configuration and no prior finalization.
2. `validateStoredSafeReleaseTransaction(...)` — decodes the actual persisted `deal_multisig_transactions.data` and validates the exact MultiSendCallOnly payload against a trusted locked release-policy snapshot.
3. Safe transaction hash binding — stored hash must be a 32-byte hash and match the hash independently recomputed from the live Safe contract immediately before execution.
4. `validateSafeSignatureSet(...)` — every stored signer must be a distinct current Safe owner, have `signature_status = signed`, and cryptographically recover to that same owner from the exact Safe transaction hash; recovered count must meet the live Safe threshold.

The guard authorizes nothing if any one of these checks fails. It performs no database writes, RPC calls, signing, or transaction broadcast.

## 2. Exact Safe signature semantics confirmed from deployed source

The captured `record-safe-release-signature` source (version 24) constructs:

- EIP-712 domain: `{ chainId: 56, verifyingContract: safeAddress }`
- Primary type: `SafeTx`
- Fields in order:
  - `to: address`
  - `value: uint256`
  - `data: bytes`
  - `operation: uint8`
  - `safeTxGas: uint256`
  - `baseGas: uint256`
  - `gasPrice: uint256`
  - `gasToken: address`
  - `refundReceiver: address`
  - `nonce: uint256`

The stored `safe_tx_hash` is checked against `TypedDataEncoder.hash(domain, types, message)`. Therefore the Safe owner's EIP-712 signature is recovered from that exact 32-byte hash. The W3M recovery primitive accepts canonical 65-byte secp256k1 signatures with v = 0/1 or 27/28 and rejects high-S signatures and Safe eth_sign (v=31/32) signatures. No EIP-191 personal_sign prefix is applied.

This Safe signature is distinct from the W3M report signature: both use 32-byte digest recovery, but they sign different digests under different policies. Do not reuse a report signature as a Safe owner confirmation.

## 3. Exact release payload semantics confirmed from deployed source

Captured `prepare-safe-release-tx` version 37 establishes the current release construction:

- BNB Chain ID 56.
- Safe version expected by that function: 1.4.1.
- MultiSendCallOnly target: `0x9641d764fc13c8B624c04430C7356C1C7C8102e2`.
- USDT token: `0x55d398326f99059ff775485246999027b3197955`.
- Platform wallet: `0x2B15cC63eE3b833F502C065767695Fa2B584f8c9`.
- Outer Safe operation: DELEGATECALL (1).
- Outer native BNB value: zero.
- Exactly two inner CALLs (operation 0), both ERC-20 `transfer` calls:
  - locked seller net amount to the locked seller wallet;
  - locked platform fee to the locked platform wallet.
- Seller net plus platform fee must equal the locked deal amount.

The new adapter decodes actual stored calldata and validates its inner calls against a supplied server-loaded policy snapshot. It does not hardcode the current token or platform address in the generic domain engine; the trusted adapter must load and verify the active policy.

## 4. CI coverage added

The existing isolated workflow already runs `safe-payload-pipeline.test.ts` and `ethereum-signature-adapter.test.ts`. Those existing suites now also exercise:

- stored transaction row → calldata decode → exact payload policy validation;
- rejection of wrong chain, altered recipient, and malformed MultiSend selector;
- unified execution guard success only when report, terms, payment, delivery, dispute, payload, hash and signature conditions all pass;
- rejection of changed Safe hash, signatures bound to another hash, altered seller recipient, blocked payment, PREPARE stage, and invalid signature set;
- actual secp256k1 signatures generated from deterministic test-only private keys, recovered against a Safe-style EIP-712 digest.

These are test definitions. A GitHub Actions run was observed starting for the latest branch commit; do not claim passing until its final conclusion is retrieved.

## 5. Required trusted server adapter before any production integration

The future Edge Function adapter must load, server-side and fresh for the exact deal:

- deal and project identifiers, participants and current deal-terms hash;
- latest W3M report, complete evidence rows, report version/supersession state and report signature;
- trusted signer key status at current execution time;
- locked `deal_release_policies` row;
- exact `deal_multisig_transactions` row and all signer rows for that exact `deal_id + safe_tx_hash`;
- current dispute records and any additional settlement holds;
- canonical payment receipt/finality and buyer acceptance bound to the delivered asset set;
- live Safe owners, threshold, nonce and Safe version from BNB RPC;
- live Safe `getTransactionHash(...)` recomputation from the exact stored transaction fields.

No browser-provided booleans, amounts, wallets, hashes, signer identities, status fields, or policy snapshots may be authoritative.

## 6. Database and idempotency work remains blocked on authoritative schema

The isolated Git tree contains the W3M evidence and trusted-signer migrations, but no complete baseline migrations for `deals`, `deal_release_policies`, `deal_multisig_transactions`, `deal_multisig_signers`, or the definition of `validate_deal_release_policy`. The source-derived field map is not a substitute for SQL DDL.

Therefore do not yet author a production-facing RPC that locks or updates these tables. First obtain the authoritative schema, unique constraints, triggers, RLS, existing RPC definition and status transition rules in a read-only schema review. Only then design a transactionally safe execution-claim/attempt record and atomic finalization RPC.

## 7. Safety boundary

- No deployed Edge Function was edited or invoked.
- No migration was applied.
- No production table, wallet, Safe, balance or transaction was changed.
- No merge to `main`.
- All new code and tests remain on the isolated branch.
