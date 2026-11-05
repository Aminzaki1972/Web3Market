// W3M Protocol V1 — trusted signer verification boundary.
// This module enforces key policy and delegates secp256k1 recovery to a
// separately reviewed cryptographic adapter. It never treats a signature's
// shape or presence as proof of validity.
import { verifyEthereumRawDigestSignature } from "./ethereum-signature-adapter.ts";

export const W3M_SIGNER_VERIFIER_VERSION = "w3m-signer-verifier-1.0.0";
const SHA256 = /^[0-9a-f]{64}$/i;
const SIGNATURE_65_BYTE = /^0x[0-9a-fA-F]{130}$/;
const ETHEREUM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export type SignerKeyStatus = "ACTIVE" | "REVOKED";
export type SignerAlgorithm = "ECDSA_SECP256K1_KECCAK256_RAW_DIGEST";

export interface TrustedSignerKey {
  keyId: string;
  algorithm: SignerAlgorithm;
  publicAddress: string;
  status: SignerKeyStatus;
  validFrom: string;
  validUntil: string | null;
  revokedAt: string | null;
}

export interface SignatureVerificationInput {
  digestHex: string;
  signature: string;
  signerKeyId: string;
  checkedAt: string;
}

export type EthereumDigestRecoveryVerifier = (input: {
  digestHex: string;
  signature: string;
  expectedAddress: string;
}) => Promise<boolean>;

export type SignatureVerificationResult =
  | { valid: true; signerKeyId: string; recoveredAddress: string; algorithm: SignerAlgorithm }
  | {
    valid: false;
    code:
      | "INVALID_DIGEST"
      | "INVALID_SIGNATURE_FORMAT"
      | "INVALID_CHECK_TIME"
      | "UNKNOWN_SIGNER_KEY"
      | "REVOKED_SIGNER_KEY"
      | "SIGNER_KEY_NOT_YET_VALID"
      | "SIGNER_KEY_EXPIRED"
      | "INVALID_SIGNER_KEY"
      | "UNSUPPORTED_SIGNER_ALGORITHM"
      | "SIGNATURE_INVALID"
      | "CRYPTO_VERIFIER_ERROR";
    reason: string;
  };

function fail(
  code: Extract<SignatureVerificationResult, { valid: false }>["code"],
  reason: string,
): SignatureVerificationResult {
  return { valid: false, code, reason };
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Verify a 32-byte canonical report hash using Ethereum-style secp256k1
 * address recovery over the raw digest (not the EIP-191 personal-message
 * prefix). The injected verifier must enforce canonical signature encoding,
 * low-s values, v normalization, and actual public-key recovery.
 */
export async function verifyTrustedReportSignature(
  input: SignatureVerificationInput,
  keys: readonly TrustedSignerKey[],
  recoverAndVerify: EthereumDigestRecoveryVerifier,
): Promise<SignatureVerificationResult> {
  if (!SHA256.test(input.digestHex)) {
    return fail("INVALID_DIGEST", "Report digest must be exactly 32 bytes of hexadecimal.");
  }
  if (!SIGNATURE_65_BYTE.test(input.signature)) {
    return fail("INVALID_SIGNATURE_FORMAT", "Report signature must be a 65-byte 0x-prefixed ECDSA signature.");
  }
  const checkedAt = timestamp(input.checkedAt);
  if (checkedAt === null) {
    return fail("INVALID_CHECK_TIME", "Signature verification time is invalid.");
  }
  if (!input.signerKeyId.trim()) {
    return fail("UNKNOWN_SIGNER_KEY", "Signer key ID is missing.");
  }

  const matching = keys.filter((key) => key.keyId === input.signerKeyId);
  if (matching.length !== 1) {
    return fail("UNKNOWN_SIGNER_KEY", "Signer key ID is unknown or ambiguous.");
  }
  const key = matching[0];

  if (key.status !== "ACTIVE" || key.revokedAt !== null) {
    return fail("REVOKED_SIGNER_KEY", "Signer key has been revoked.");
  }
  if (key.algorithm !== "ECDSA_SECP256K1_KECCAK256_RAW_DIGEST") {
    return fail("UNSUPPORTED_SIGNER_ALGORITHM", "Signer key algorithm is not supported by this protocol version.");
  }
  if (!ETHEREUM_ADDRESS.test(key.publicAddress)) {
    return fail("INVALID_SIGNER_KEY", "Trusted signer public address is malformed.");
  }

  const validFrom = timestamp(key.validFrom);
  const validUntil = key.validUntil === null ? null : timestamp(key.validUntil);
  if (validFrom === null || (key.validUntil !== null && validUntil === null)) {
    return fail("INVALID_SIGNER_KEY", "Trusted signer validity metadata is invalid.");
  }
  if (checkedAt < validFrom) {
    return fail("SIGNER_KEY_NOT_YET_VALID", "Signer key was not valid at the verification time.");
  }
  if (validUntil !== null && checkedAt >= validUntil) {
    return fail("SIGNER_KEY_EXPIRED", "Signer key validity period has ended.");
  }

  try {
    const valid = await recoverAndVerify({
      digestHex: input.digestHex.toLowerCase(),
      signature: input.signature,
      expectedAddress: key.publicAddress.toLowerCase(),
    });
    if (!valid) {
      return fail("SIGNATURE_INVALID", "Cryptographic recovery did not match the trusted signer address.");
    }
    return {
      valid: true,
      signerKeyId: key.keyId,
      recoveredAddress: key.publicAddress.toLowerCase(),
      algorithm: key.algorithm,
    };
  } catch {
    return fail("CRYPTO_VERIFIER_ERROR", "Cryptographic verifier failed; report must remain untrusted.");
  }
}


/**
 * Production-shaped verifier: applies the signer registry policy and the
 * pinned Ethereum secp256k1 raw-digest recovery adapter. Callers must supply
 * keys loaded from the authoritative server-only registry, never from a client.
 */
export function verifyTrustedEthereumReportSignature(
  input: SignatureVerificationInput,
  keys: readonly TrustedSignerKey[],
): Promise<SignatureVerificationResult> {
  return verifyTrustedReportSignature(input, keys, verifyEthereumRawDigestSignature);
}
