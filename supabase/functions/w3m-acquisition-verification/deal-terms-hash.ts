// W3M Protocol V1 — canonical hash of the authoritative deal + locked release policy.
// Numeric fields must be loaded as text from PostgreSQL (for example via ::text)
// so JavaScript floating-point conversion can never alter signed financial terms.

import { canonicalJson, sha256Hex } from "./decision-engine.ts";
import type { DealCodeAuditBinding } from "./deal-code-audit-binding.ts";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

const PLATFORM_WALLET = "0x2b15cc63ee3b833f502c065767695fa2b584f8c9";

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
  codeAudit: DealCodeAuditBinding;
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


function roundPercent(amount: string, precision: number): string {
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length > 18) throw new Error("Deal amount precision above 18 decimals is unsupported in W3M V1.");
  const sourceScale = fraction.length;
  const units = BigInt(whole) * (10n ** BigInt(sourceScale)) +
    BigInt(fraction || "0");
  let numerator = units * 75n;
  let denominator = 1000n;
  if (precision >= sourceScale) numerator *= 10n ** BigInt(precision - sourceScale);
  else denominator *= 10n ** BigInt(sourceScale - precision);
  const rounded = (numerator + denominator / 2n) / denominator;
  const base = 10n ** BigInt(precision);
  const integer = (rounded / base).toString();
  const decimals = (rounded % base).toString().padStart(precision, "0").replace(/0+$/, "");
  return decimals ? integer + "." + decimals : integer;
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

  const audit = snapshot.codeAudit;
  requiredText(audit.auditId, "Code Audit ID");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(audit.auditId)) {
    throw new Error("Code Audit ID must be a UUID.");
  }
  requiredText(audit.repositoryOwner, "Code Audit repository owner");
  requiredText(audit.repositoryName, "Code Audit repository name");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(audit.repositoryOwner) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(audit.repositoryName) ||
      audit.repositoryName === "." || audit.repositoryName === "..") {
    throw new Error("Code Audit repository identity is malformed.");
  }
  const expectedRepoUrl = "https://github.com/" + audit.repositoryOwner + "/" + audit.repositoryName;
  if (audit.repositoryUrl.replace(/\/$/, "").replace(/\.git$/i, "").toLowerCase() !== expectedRepoUrl.toLowerCase()) {
    throw new Error("Code Audit repository URL does not match its owner/name.");
  }
  if (!/^[0-9a-f]{40}$/i.test(audit.commitSha)) throw new Error("Code Audit commit SHA is invalid.");
  if (!["code", "smart_contract", "complete"].includes(audit.auditType)) {
    throw new Error("Code Audit type is unsupported.");
  }
  if (!Number.isFinite(Date.parse(audit.completedAt))) throw new Error("Code Audit completion timestamp is invalid.");
  if (!/^[0-9a-f]{64}$/.test(audit.auditEvidenceHash)) throw new Error("Code Audit manifest digest is invalid.");

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
    codeAudit: {
      auditId: audit.auditId,
      repositoryOwner: audit.repositoryOwner,
      repositoryName: audit.repositoryName,
      repositoryUrl: expectedRepoUrl,
      commitSha: audit.commitSha.toLowerCase(),
      auditType: audit.auditType,
      completedAt: new Date(Date.parse(audit.completedAt)).toISOString(),
      auditEvidenceHash: audit.auditEvidenceHash,
    },
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
  const feeAtEight = roundPercent(canonicalTerms.amount, 8);
  const feeAtEighteen = roundPercent(canonicalTerms.amount, 18);
  if (decimal(canonicalTerms.releasePolicy.feeAmount, "Policy fee amount") !== feeAtEight ||
      feeAtEight !== feeAtEighteen) {
    throw new Error("Deal fee precision is incompatible with both existing production validators; W3M V1 blocks this deal.");
  }
  return {
    dealTermsHash: await sha256Hex(canonicalJson(canonicalTerms)),
    canonicalTerms,
  };
}
