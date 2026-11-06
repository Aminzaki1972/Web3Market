# W3M Protocol V1 — immutable Deal Agreement signature proposal

Status: **DESIGN PROPOSAL ONLY — NOT IMPLEMENTED**

This proposal closes the current critical gap: the legacy `deal_party_agreements` rows record only party identity and a timestamp. They do not prove that buyer and seller accepted the same immutable deal terms. W3M must continue to block settlement until both parties have signed one identical canonical terms hash.

## Recommended signature standard

Use **EIP-712 typed-data signatures** from each party's already verified wallet. Do not use `personal_sign`, a plain SHA-256 signature, or a browser-supplied “accepted” boolean.

### Domain

- `name`: `Web3Market Deal Agreement`
- `version`: `1`
- `chainId`: `56` (BNB Smart Chain mainnet)
- `verifyingContract`: the exact Safe address locked in the deal release policy

The Safe address is used as a deal-specific EIP-712 domain separator. This is an off-chain signature format; it does not add a method to or change the Safe contract.

### Primary type

```solidity
DealTermsAcceptance(
  bytes32 dealId,
  bytes32 projectId,
  bytes32 buyerId,
  bytes32 sellerId,
  bytes32 termsHash,
  uint256 termsVersion,
  uint8 partyRole
)
```

Field encoding:
- UUID identity fields are represented as `keccak256(UTF-8(lowercase UUID))`.
- `termsHash` is the exact 32-byte SHA-256 digest returned by the existing canonical `computeDealTermsHash` function.
- `termsVersion` is a positive monotonically increasing integer.
- `partyRole`: `1` = buyer, `2` = seller.
- Both parties must sign the same `dealId`, `projectId`, `buyerId`, `sellerId`, `termsHash`, `termsVersion`, chain and Safe domain. Only `partyRole` differs.

The final digest is standard EIP-712:
`keccak256(0x1901 || domainSeparator || hashStruct(message))`.

## Verification and persistence rules

1. Server loads exact deal and locked release-policy values as decimal text and recomputes the canonical terms hash.
2. Server verifies the connected wallet equals the verified profile wallet for the stated buyer/seller identity.
3. Server recomputes the EIP-712 digest and recovers the signer from the 65-byte signature; recovered address must exactly match that verified wallet.
4. Server rechecks the deal/policy version or update timestamps before persistence, preventing a signature from being recorded after the terms changed during signing.
5. Store one immutable acceptance per `deal_id + terms_version + party_role`; reject conflicting duplicate submissions. Keep the signed digest, terms hash/version, party identity, wallet, chain, Safe address, signature, and server acceptance timestamp.
6. At EXECUTE, reload both acceptance rows and independently recompute the current terms hash. Require exactly one buyer and one seller acceptance, same terms hash/version/domain, valid signatures, and current verified wallets.
7. Any changed amount, currency, fee, seller wallet, platform wallet, token, chain, Safe, nonce, buyer, seller, or project produces a different terms hash and blocks the old signatures.
8. Agreement acceptance is not Safe transaction authorization. Safe owner signatures must still be independently recovered against the exact Safe EIP-712 transaction hash and current Safe owners/threshold.

## Persistence boundary

The implementation should add a new W3M-owned append-only acceptance registry and service-role-only RPC. It should not repurpose or silently reinterpret the existing `deal_party_agreements` table. No migration should be deployed to production as part of this work.

The browser should request `eth_signTypedData_v4` only after showing the canonical deal terms. The browser submits the signature to an authenticated server endpoint; it must never submit a trusted signer identity or a self-asserted verified status. The server recomputes all values and verifies the signature before calling the restricted persistence RPC.

## Required tests before any integration

- buyer signature valid; seller signature valid;
- wrong wallet, wrong party role, wrong deal/project, wrong terms hash/version, wrong Safe, wrong chain all rejected;
- one party signs old terms then terms change — old acceptance cannot authorize;
- duplicate same signature is idempotent; conflicting signature for same party/version is rejected;
- malformed/high-S signatures and invalid recovery values rejected;
- missing buyer or seller acceptance remains INCOMPLETE/BLOCKED;
- browser-supplied party ID, wallet, digest or terms hash cannot override server-derived values;
- concurrent terms update during signing causes persistence rejection.

## Decision required before implementation

This is the recommended standard because it is wallet-native, domain-separated, chain-bound, Safe-bound, and compatible with the existing raw-digest secp256k1 recovery primitive after EIP-712 digest construction. It has **not** been implemented or wired into Deal Room. The protocol owner must approve this exact EIP-712 payload and signature flow before code or database changes are made.
