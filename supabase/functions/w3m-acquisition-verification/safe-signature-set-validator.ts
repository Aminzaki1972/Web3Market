// W3M Protocol V1 — execution-time Safe signature-set validator.
// Pure domain boundary. A trusted server adapter must load the transaction,
// current Safe owners/threshold, and signer rows for the exact deal + Safe tx hash.
// This module never trusts a browser-provided "signed" boolean and never broadcasts.
import { verifyEthereumRawDigestSignature } from "./ethereum-signature-adapter.ts";

export const W3M_SAFE_SIGNATURE_SET_VERSION = "w3m-safe-signature-set-1.0.0";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DIGEST = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

export interface SafeStoredSignature {
  walletAddress: string;
  signature: string;
  signatureStatus: string;
}

export interface SafeSignatureSetInput {
  safeTransactionHash: string;
  currentOwners: readonly string[];
  threshold: number;
  /** Rows loaded server-side for this exact deal_id + safe_tx_hash. */
  storedSignatures: readonly SafeStoredSignature[];
}

export interface SafeSignatureSetDecision {
  valid: boolean;
  requiredSignatures: number;
  validSignatures: number;
  recoveredSigners: string[];
  issues: string[];
}

export type SafeDigestSignatureVerifier = (input: {
  digestHex: string;
  signature: string;
  expectedAddress: string;
}) => Promise<boolean>;

function normalizedAddress(value: string): string | null {
  return ADDRESS.test(value || "") ? value.toLowerCase() : null;
}

export async function validateSafeSignatureSet(
  input: SafeSignatureSetInput,
  verify: SafeDigestSignatureVerifier = verifyEthereumRawDigestSignature,
): Promise<SafeSignatureSetDecision> {
  const issues: string[] = [];
  const recoveredSigners: string[] = [];
  const digest = typeof input.safeTransactionHash === "string" &&
      /^0x[0-9a-fA-F]{64}$/.test(input.safeTransactionHash)
    ? input.safeTransactionHash.slice(2).toLowerCase()
    : null;

  if (!digest) issues.push("SAFE_TX_HASH_INVALID");

  const ownerValues = Array.isArray(input.currentOwners) ? input.currentOwners : [];
  if (!Array.isArray(input.currentOwners)) issues.push("SAFE_OWNERS_INVALID");
  const owners = ownerValues.map(normalizedAddress);
  if (owners.some((owner) => owner === null) || owners.length === 0) {
    issues.push("SAFE_OWNERS_INVALID");
  }
  const ownerSet = new Set(owners.filter((owner): owner is string => owner !== null));
  if (ownerSet.size !== owners.length) issues.push("SAFE_OWNERS_DUPLICATED");

  if (!Number.isInteger(input.threshold) || input.threshold < 1 ||
      input.threshold > ownerSet.size) {
    issues.push("SAFE_THRESHOLD_INVALID");
  }
  const signatureRows = Array.isArray(input.storedSignatures) ? input.storedSignatures : [];
  if (!Array.isArray(input.storedSignatures)) issues.push("STORED_SIGNATURE_ROWS_INVALID");
  if (signatureRows.length < (Number.isInteger(input.threshold) ? input.threshold : 1)) {
    issues.push("SAFE_SIGNATURES_BELOW_THRESHOLD");
  }

  const seen = new Set<string>();
  for (const row of signatureRows) {
    const wallet = normalizedAddress(row.walletAddress);
    if (!wallet) {
      issues.push("STORED_SIGNER_ADDRESS_INVALID");
      continue;
    }
    if (seen.has(wallet)) {
      issues.push("DUPLICATE_STORED_SIGNER");
      continue;
    }
    seen.add(wallet);
    if (!ownerSet.has(wallet)) {
      issues.push("STORED_SIGNER_NOT_CURRENT_OWNER");
      continue;
    }
    if (row.signatureStatus !== "signed") {
      issues.push("STORED_SIGNATURE_NOT_CONFIRMED");
      continue;
    }
    if (!SIGNATURE.test(row.signature || "")) {
      issues.push("STORED_SIGNATURE_FORMAT_INVALID");
      continue;
    }
    if (!digest) continue;

    let valid = false;
    try {
      valid = await verify({
        digestHex: digest,
        signature: row.signature,
        expectedAddress: wallet,
      });
    } catch {
      valid = false;
    }
    if (!valid) {
      issues.push("STORED_SIGNATURE_RECOVERY_FAILED");
      continue;
    }
    recoveredSigners.push(wallet);
  }

  if (recoveredSigners.length < input.threshold) {
    issues.push("RECOVERED_SIGNATURES_BELOW_THRESHOLD");
  }

  return {
    valid: issues.length === 0,
    requiredSignatures: input.threshold,
    validSignatures: recoveredSigners.length,
    recoveredSigners,
    issues: [...new Set(issues)],
  };
}
