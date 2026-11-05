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

The cryptographic adapter must recover the signer address from the raw 32-byte report hash (no EIP-191 personal-message prefix), enforce canonical signature encoding and low-s values, normalize the recovery identifier safely, and compare the recovered address to the trusted key registry address.

The current module deliberately injects this cryptographic adapter. It does **not** claim that WebCrypto verifies secp256k1, and it does not provide a fake cryptographic implementation. Before production use, select and review a pinned, already-approved secp256k1 recovery implementation, then add known-good and known-bad signature vectors. No remote dependency or paid signing service is introduced here.

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
- No cryptographic secp256k1 adapter implementation yet.
- No signature verification wired into the atomic persistence RPC caller.
- No Supabase Edge Function authentication or persistence.
- No Safe, wallet, production database, Cloudflare, or live-site changes.

A report signed by a mock/test signer is not a trusted report and must never be used for settlement.
