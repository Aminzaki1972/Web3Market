// W3M Protocol V1 — EIP-712 buyer/seller agreement acceptance.
// Server-side digest construction only. Browser clients receive the typed-data
// object and sign it with eth_signTypedData_v4; the server independently rebuilds
// the digest and recovers the verified profile wallet.
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";
import { recoverEthereumAddressFromDigest } from "./ethereum-signature-adapter.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const DOMAIN_TYPE = "EIP712Domain(string name,string version,uint256 chainId)";
const ACCEPTANCE_TYPE = "DealTermsAcceptance(bytes32 dealId,bytes32 projectId,bytes32 buyerId,bytes32 sellerId,address safeAddress,bytes32 termsHash,uint256 termsVersion,uint8 partyRole)";
const NAME = "Web3Market Deal Agreement";
const VERSION = "1";
const CHAIN_ID = 56n;

export type DealAgreementPartyRole = "buyer" | "seller";
export interface DealTermsAcceptanceInput {
  dealId: string;
  projectId: string;
  buyerId: string;
  sellerId: string;
  safeAddress: string;
  termsHash: string;
  termsVersion: string;
  partyRole: DealAgreementPartyRole;
}
export interface Eip712DealAgreementTypedData {
  domain: { name: string; version: string; chainId: number };
  primaryType: "DealTermsAcceptance";
  types: {
    EIP712Domain: Array<{ name: string; type: string }>;
    DealTermsAcceptance: Array<{ name: string; type: string }>;
  };
  message: {
    dealId: string; projectId: string; buyerId: string; sellerId: string;
    safeAddress: string; termsHash: string; termsVersion: string; partyRole: number;
  };
}
const DOMAIN_FIELDS = [
  { name: "name", type: "string" }, { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
];
const ACCEPTANCE_FIELDS = [
  { name: "dealId", type: "bytes32" }, { name: "projectId", type: "bytes32" },
  { name: "buyerId", type: "bytes32" }, { name: "sellerId", type: "bytes32" },
  { name: "safeAddress", type: "address" }, { name: "termsHash", type: "bytes32" },
  { name: "termsVersion", type: "uint256" }, { name: "partyRole", type: "uint8" },
];

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(value: string): Uint8Array {
  if (value.length % 2 || !/^[0-9a-f]*$/i.test(value)) throw new Error("Invalid hex value.");
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (part) => Number.parseInt(part, 16));
}
function word(value: bigint): Uint8Array {
  if (value < 0n || value >= (1n << 256n)) throw new Error("EIP-712 integer is outside uint256.");
  const out = new Uint8Array(32);
  let current = value;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(current & 255n);
    current >>= 8n;
  }
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function hashText(value: string): Uint8Array {
  return keccak_256(new TextEncoder().encode(value));
}
function uuidWord(value: string, label: string): Uint8Array {
  if (!UUID.test(value)) throw new Error(label + " must be a UUID.");
  return hashText(value.toLowerCase());
}
function addressWord(value: string): Uint8Array {
  if (!ADDRESS.test(value)) throw new Error("Safe address must be a 20-byte EVM address.");
  return concat(new Uint8Array(12), hexToBytes(value.slice(2).toLowerCase()));
}
function normalize(input: DealTermsAcceptanceInput) {
  const dealId = uuidWord(input.dealId, "Deal ID");
  const projectId = uuidWord(input.projectId, "Project ID");
  const buyerId = uuidWord(input.buyerId, "Buyer ID");
  const sellerId = uuidWord(input.sellerId, "Seller ID");
  if (input.buyerId.toLowerCase() === input.sellerId.toLowerCase()) {
    throw new Error("Buyer and seller identities must be distinct.");
  }
  const safeAddress = addressWord(input.safeAddress);
  if (!HASH.test(input.termsHash)) throw new Error("Terms hash must be exactly 32 bytes.");
  if (!/^[1-9][0-9]*$/.test(input.termsVersion)) throw new Error("Terms version must be a positive integer string.");
  const version = BigInt(input.termsVersion);
  if (version >= (1n << 256n)) throw new Error("Terms version exceeds uint256.");
  if (input.partyRole !== "buyer" && input.partyRole !== "seller") {
    throw new Error("Party role must be buyer or seller.");
  }
  return {
    dealId, projectId, buyerId, sellerId, safeAddress,
    termsHash: hexToBytes(input.termsHash), version,
    partyRole: input.partyRole === "buyer" ? 1n : 2n,
  };
}

export function buildDealTermsAcceptanceTypedData(
  input: DealTermsAcceptanceInput,
): Eip712DealAgreementTypedData {
  const values = normalize(input);
  return {
    domain: { name: NAME, version: VERSION, chainId: Number(CHAIN_ID) },
    primaryType: "DealTermsAcceptance",
    types: {
      EIP712Domain: DOMAIN_FIELDS,
      DealTermsAcceptance: ACCEPTANCE_FIELDS,
    },
    message: {
      dealId: "0x" + bytesToHex(values.dealId),
      projectId: "0x" + bytesToHex(values.projectId),
      buyerId: "0x" + bytesToHex(values.buyerId),
      sellerId: "0x" + bytesToHex(values.sellerId),
      safeAddress: input.safeAddress.toLowerCase(),
      termsHash: "0x" + input.termsHash.toLowerCase(),
      termsVersion: input.termsVersion,
      partyRole: Number(values.partyRole),
    },
  };
}

export function computeDealTermsAcceptanceDigest(input: DealTermsAcceptanceInput): string {
  const values = normalize(input);
  const domainTypeHash = hashText(DOMAIN_TYPE);
  const domainSeparator = keccak_256(concat(
    domainTypeHash,
    hashText(NAME),
    hashText(VERSION),
    word(CHAIN_ID),
  ));
  const structTypeHash = hashText(ACCEPTANCE_TYPE);
  const structHash = keccak_256(concat(
    structTypeHash,
    values.dealId,
    values.projectId,
    values.buyerId,
    values.sellerId,
    values.safeAddress,
    values.termsHash,
    word(values.version),
    word(values.partyRole),
  ));
  return "0x" + bytesToHex(keccak_256(concat(
    new Uint8Array([0x19, 0x01]), domainSeparator, structHash,
  )));
}

export function verifyDealTermsAcceptanceSignature(input: {
  acceptance: DealTermsAcceptanceInput;
  signature: string;
  expectedWallet: string;
}): { valid: boolean; digest: string; recoveredWallet: string | null } {
  if (!ADDRESS.test(input.expectedWallet)) {
    return { valid: false, digest: "", recoveredWallet: null };
  }
  try {
    const digest = computeDealTermsAcceptanceDigest(input.acceptance);
    const recoveredWallet = recoverEthereumAddressFromDigest(digest.slice(2), input.signature);
    return {
      valid: recoveredWallet === input.expectedWallet.toLowerCase(),
      digest,
      recoveredWallet,
    };
  } catch {
    return { valid: false, digest: "", recoveredWallet: null };
  }
}
