// W3M Protocol V1 — canonical hash of the authoritative deal + locked release policy.
// Numeric fields must be loaded as text from PostgreSQL (for example via ::text)
// so JavaScript floating-point conversion can never alter signed financial terms.

import { canonicalJson, sha256Hex } from "./decision-engine.ts";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export interface DealTermsSnapshot {
  dealId: string;
  projectId: string;
  buyerId: string;
  sellerId: string;
  amount: string;
  currency: string;
  expectedAmount: string | null;
  chainId: number;
  safeAddress: string;
  tokenContract: string;
  policy: {
    dealAmount: string;
    feePercent: string;
    feeAmount: string;
    sellerNetAmount: string;
    chainId: number;
    safeAddress: string;
    tokenContract: string;
    sellerWallet: string;
    platformWallet: string;
    safeNonce: string;
    status: "locked" | "ready";
  };
}

function requiredText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " is required.");
}

function decimal(value: unknown, label: string): string {
  requiredText(value, label);
  if (!DECIMAL.test(value)) throw new Error(label + " must be an exact non-negative decimal string.");
  const [whole, fraction = ""] = value.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? normalizedWhole + "." + normalizedFraction : normalizedWhole;
}

function address(value: unknown, label: string): string {
  requiredText(value, label);
  if (!ADDRESS.test(value)) throw new Error(label + " must be a valid EVM address.");
  return value.toLowerCase();
}

export async function computeDealTermsHash(snapshot: DealTermsSnapshot): Promise<{
  dealTermsHash: string;
  canonicalTerms: Record<string, unknown>;
}> {
  requiredText(snapshot.dealId, "Deal ID");
  requiredText(snapshot.projectId, "Project ID");
  requiredText(snapshot.buyerId, "Buyer ID");
  requiredText(snapshot.sellerId, "Seller ID");
  if (snapshot.buyerId === snapshot.sellerId) throw new Error("Buyer and seller must be distinct.");
  requiredText(snapshot.currency, "Deal currency");
  if (snapshot.chainId !== 56) throw new Error("W3M V1 release terms must be pinned to BNB Chain 56.");
  if (snapshot.policy.status !== "locked" && snapshot.policy.status !== "ready") {
    throw new Error("Release policy must be locked or ready.");
  }
  if (snapshot.policy.chainId !== 56) throw new Error("Release policy must be pinned to BNB Chain 56.");
  if (!/^(0|[1-9]\d*)$/.test(snapshot.policy.safeNonce)) {
    throw new Error("Safe nonce must be an exact non-negative integer string.");
  }
  if (decimal(snapshot.policy.feePercent, "Policy fee percent") !== "7.5") {
    throw new Error("W3M V1 requires the platform's locked 7.5% success fee.");
  }

  const canonicalTerms = {
    protocol: "W3M Protocol V1",
    dealId: snapshot.dealId,
    projectId: snapshot.projectId,
    buyerId: snapshot.buyerId,
    sellerId: snapshot.sellerId,
    amount: decimal(snapshot.amount, "Deal amount"),
    currency: snapshot.currency.trim().toUpperCase(),
    expectedAmount: snapshot.expectedAmount === null
      ? null
      : decimal(snapshot.expectedAmount, "Expected amount"),
    chainId: snapshot.chainId,
    safeAddress: address(snapshot.safeAddress, "Safe address"),
    tokenContract: address(snapshot.tokenContract, "Token contract"),
    releasePolicy: {
      dealAmount: decimal(snapshot.policy.dealAmount, "Policy deal amount"),
      feePercent: decimal(snapshot.policy.feePercent, "Policy fee percent"),
      feeAmount: decimal(snapshot.policy.feeAmount, "Policy fee amount"),
      sellerNetAmount: decimal(snapshot.policy.sellerNetAmount, "Seller net amount"),
      chainId: snapshot.policy.chainId,
      safeAddress: address(snapshot.policy.safeAddress, "Policy Safe address"),
      tokenContract: address(snapshot.policy.tokenContract, "Policy token contract"),
      sellerWallet: address(snapshot.policy.sellerWallet, "Seller wallet"),
      platformWallet: address(snapshot.policy.platformWallet, "Platform wallet"),
      safeNonce: snapshot.policy.safeNonce,
      status: snapshot.policy.status,
    },
  };
  if (canonicalTerms.releasePolicy.dealAmount !== canonicalTerms.amount) {
    throw new Error("Deal amount and locked release-policy amount do not match.");
  }
  if (canonicalTerms.releasePolicy.safeAddress !== canonicalTerms.safeAddress ||
      canonicalTerms.releasePolicy.tokenContract !== canonicalTerms.tokenContract) {
    throw new Error("Deal and release-policy Safe/token configuration do not match.");
  }
  if (canonicalTerms.releasePolicy.platformWallet !== PLATFORM_WALLET) {
    throw new Error("Platform wallet does not match the pinned Web3Market fee recipient.");
  }
  if (canonicalTerms.releasePolicy.sellerWallet === canonicalTerms.releasePolicy.platformWallet) {
    throw new Error("Seller and platform recipients must be distinct.");
  }
  const feeParts = canonicalTerms.releasePolicy.feeAmount.split(".");
  const netParts = canonicalTerms.releasePolicy.sellerNetAmount.split(".");
  const amountParts = canonicalTerms.amount.split(".");
  const scale = Math.max(feeParts[1]?.length ?? 0, netParts[1]?.length ?? 0, amountParts[1]?.length ?? 0);
  const toUnits = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * (10n ** BigInt(scale)) + BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0");
  };
  if (toUnits(canonicalTerms.releasePolicy.feeAmount) +
      toUnits(canonicalTerms.releasePolicy.sellerNetAmount) !== toUnits(canonicalTerms.amount)) {
    throw new Error("Seller net amount plus platform fee must equal the exact deal amount.");
  }
  return {
    dealTermsHash: await sha256Hex(canonicalJson(canonicalTerms)),
    canonicalTerms,
  };
}
