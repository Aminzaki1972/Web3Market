# W3M Protocol V1 — trusted signer boundary

Status: isolated design and policy module only. No production key, signer, database record, or settlement integration exists.

## What is implemented

`signature-verifier.ts` checks the policy surrounding a report signature:

- exact 32-byte SHA-256 report digest;
- 65-byte, 0x-prefixed ECDSA signature encoding;
- unique signer key ID;
- active status and absence of a revocation timestamp;
- supported algorithm identifier;
- valid Ethereum address format;
- key validity window at the time of verification;
- cryptographic verifier result must match the trusted key address;
- any verifier exception fails closed.

A correctly shaped signature string is never accepted as proof by itself.

## Cryptographic contract

V1 reserves the algorithm identifier:

`ECDSA_SECP256K1_KECCAK256_RAW_DIGEST`

The cryptographic adapter recovers the signer address from the raw 32-byte report hash (no EIP-191 personal-message prefix), enforces canonical low-s encoding, accepts only Ethereum parity recovery values 0/1 or 27/28, and compares the recovered address to the trusted key registry address. EIP-191 `personal_sign`, EIP-155 transaction v values, and Safe `eth_sign` v=31/32 are deliberately unsupported by this report-signature format; do not pass those signatures as if they were raw-digest signatures.

The isolated branch now includes `ethereum-signature-adapter.ts`, using pinned JSR releases `@noble/curves@1.8.2` and `@noble/hashes@1.7.1`. It recovers the public key from the raw 32-byte digest, derives the Ethereum address with Keccak-256, rejects high-S signatures, and accepts only recovery values 0/1 or 27/28. Tests create a deterministic signature with a test-only private key and verify both the recovered signer and rejection cases. These are source-level tests; they still require a successful isolated CI run before being called passed.

## Trusted key registry requirements

The authoritative registry must be server-only and immutable/auditable, with at least:

- `key_id` (unique, immutable);
- `algorithm`;
- `public_address`;
- `status` (`ACTIVE` / `REVOKED`);
- `valid_from`, optional `valid_until`;
- `revoked_at`, revocation reason and actor;
- creation timestamp and append-only key lifecycle events.

Key rotation creates a new key ID. It must not overwrite the old public key. Revocation takes effect immediately for new PREPARE and EXECUTE checks. Historical reports remain verifiable as historical artifacts, but a revoked key must not authorize a new settlement.

## Required call order

1. Load the canonical immutable report and verify its stored report hash against canonical report payload.
2. Load the signer key from the authoritative server-side registry (never accept a caller-supplied public key or key status).
3. Run this policy module with the registered key and reviewed cryptographic adapter.
4. Only if verification returns `valid: true`, continue to settlement-gate checks.
5. Repeat the complete check at both PREPARE and EXECUTE; do not cache a previous authorization as final.

## Not implemented / not authorized

- No real private key generation or storage.
- No key registry migration/table yet.
- No CI success has yet been verified for the new secp256k1 adapter.
- No signature verification wired into the atomic persistence RPC caller.
- No Supabase Edge Function authentication or persistence.
- No Safe, wallet, production database, Cloudflare, or live-site changes.

A report signed by a mock/test signer is not a trusted report and must never be used for settlement.
