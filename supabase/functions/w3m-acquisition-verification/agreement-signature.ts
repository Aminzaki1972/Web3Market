/**
 * Server-side EIP-712 agreement acceptance primitives for W3M Protocol.
 *
 * This module only builds/verifies a signature. The caller must still authenticate
 * the Supabase user, load the deal/fingerprint/terms from trusted storage, compare
 * the verified wallet with profiles.wallet_address + wallet_verified, and consume
 * the nonce atomically in an append-only acceptance ledger.
 */
import {
  getAddress,
  Signature,
  verifyTypedData,
} from "npm:ethers@6.15.0";

export const W3M_AGREEMENT_DOMAIN = {
  name: "Web3Market Deal Agreement",
  version: "1",
  chainId: 56,
} as const;

export const W3M_AGREEMENT_TYPES = {
  DealTermsAcceptance: [
    { name: "dealId", type: "bytes32" },
    { name: "fingerprintId", type: "bytes32" },
    { name: "fingerprintDigest", type: "bytes32" },
    { name: "bindingHash", type: "bytes32" },
    { name: "termsHash", type: "bytes32" },
    { name: "termsVersion", type: "uint256" },
    { name: "partyRole", type: "uint8" },
    { name: "wallet", type: "address" },
    { name: "nonce", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
};

const BYTES32 = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const SIGNATURE = /^0x[0-9a-f]{130}$/i;
const UINT = /^[1-9][0-9]*$/;
const MAX_UINT256 = (1n << 256n) - 1n;
const SECP256K1_HALF_ORDER =
  0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
const MAX_SIGNATURE_LIFETIME_SECONDS = 15 * 60;

export type W3MAgreementAcceptanceInput = {
  dealId: string;
  fingerprintId: string;
  fingerprintDigest: string;
  bindingHash: string;
  termsHash: string;
  termsVersion: string;
  partyRole: "buyer" | "seller";
  walletAddress: string;
  nonce: string;
  deadline: number;
};

export type W3MAgreementTypedData = {
  domain: typeof W3M_AGREEMENT_DOMAIN;
  types: typeof W3M_AGREEMENT_TYPES;
  primaryType: "DealTermsAcceptance";
  message: {
    dealId: string;
    fingerprintId: string;
    fingerprintDigest: string;
    bindingHash: string;
    termsHash: string;
    termsVersion: string;
    partyRole: number;
    wallet: string;
    nonce: string;
    deadline: string;
  };
};

function requireBytes32(value: string, label: string): string {
  if (typeof value !== "string" || !BYTES32.test(value)) {
    throw new Error(label + " must be a 32-byte hexadecimal value.");
  }
  return value.toLowerCase();
}

function requireUint256(value: string, label: string): string {
  if (typeof value !== "string" || !UINT.test(value)) {
    throw new Error(label + " must be a positive decimal integer.");
  }
  if (BigInt(value) > MAX_UINT256) throw new Error(label + " exceeds uint256.");
  return value;
}

export function buildW3MAgreementTypedData(
  input: W3MAgreementAcceptanceInput,
  nowSeconds = Math.floor(Date.now() / 1000),
): W3MAgreementTypedData {
  if (!input || typeof input !== "object") throw new Error("Agreement acceptance input is required.");
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new Error("Current verification time must be a non-negative safe integer.");
  }
  if (input.partyRole !== "buyer" && input.partyRole !== "seller") {
    throw new Error("Agreement party role must be buyer or seller.");
  }
  if (!Number.isSafeInteger(input.deadline) || input.deadline <= nowSeconds) {
    throw new Error("Agreement signature deadline is invalid or expired.");
  }
  if (input.deadline > nowSeconds + MAX_SIGNATURE_LIFETIME_SECONDS) {
    throw new Error("Agreement signature deadline exceeds the allowed 15-minute window.");
  }
  if (typeof input.walletAddress !== "string" || !ADDRESS.test(input.walletAddress)) {
    throw new Error("A verified EVM wallet address is required.");
  }

  return {
    domain: W3M_AGREEMENT_DOMAIN,
    types: W3M_AGREEMENT_TYPES,
    primaryType: "DealTermsAcceptance",
    message: {
      dealId: requireBytes32(input.dealId, "Deal ID"),
      fingerprintId: requireBytes32(input.fingerprintId, "Fingerprint ID"),
      fingerprintDigest: requireBytes32(input.fingerprintDigest, "Fingerprint digest"),
      bindingHash: requireBytes32(input.bindingHash, "Deal-audit binding hash"),
      termsHash: requireBytes32(input.termsHash, "Terms hash"),
      termsVersion: requireUint256(input.termsVersion, "Terms version"),
      partyRole: input.partyRole === "buyer" ? 1 : 2,
      wallet: getAddress(input.walletAddress),
      nonce: requireBytes32(input.nonce, "Acceptance nonce"),
      deadline: String(input.deadline),
    },
  };
}

/**
 * Verify a signature against server-loaded expected values.
 * Never trust client-supplied domain/types/message as the source of truth.
 */
export function verifyW3MAgreementSignature(
  input: W3MAgreementAcceptanceInput,
  signature: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): { valid: true; recoveredAddress: string; typedData: W3MAgreementTypedData } {
  const typedData = buildW3MAgreementTypedData(input, nowSeconds);
  if (typeof signature !== "string" || !SIGNATURE.test(signature)) {
    throw new Error("Agreement signature must be a 65-byte ECDSA signature.");
  }

  const parsed = Signature.from(signature);
  if (BigInt(parsed.s) > SECP256K1_HALF_ORDER) {
    throw new Error("Non-canonical high-s signatures are not accepted.");
  }

  const recoveredAddress = getAddress(
    verifyTypedData(
      typedData.domain,
      typedData.types,
      typedData.message,
      signature,
    ),
  );
  if (recoveredAddress.toLowerCase() !== typedData.message.wallet.toLowerCase()) {
    throw new Error("EIP-712 signer does not match the verified party wallet.");
  }

  return { valid: true, recoveredAddress, typedData };
}
