import { aggregateAcquisitionEvidence } from "./unified-evidence-aggregator.ts";
import type { AcquisitionEvidence, EvidenceType } from "./decision-engine.ts";
import type { UnifiedEvidenceInput } from "./unified-evidence-aggregator.ts";
import type { AssetTransferEvent } from "./asset-transfer-orchestrator.ts";

const DEAL = "deal-agg-1";
const PROJECT = "project-agg-1";
const ASSET = "repo-123";
const SELLER = "seller-account-1";
const BUYER = "buyer-account-2";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const HASH = "a".repeat(64);
const NOW = "2026-11-05T20:00:00.000Z";
const EXPIRY = "2026-11-05T20:05:00.000Z";

function baseEvidence(): AcquisitionEvidence[] {
  const metadata: Record<string, Record<string, unknown>> = {
    PROJECT_IDENTITY: { projectApproved: true, identityMatched: true },
    CODE_AUDIT: { auditStatus: "completed", commitSha: COMMIT },
    DEAL_AGREEMENT: { buyerAcceptedTerms: true, sellerAcceptedTerms: true },
    PAYMENT: { paymentConfirmed: true },
    BUYER_ACCEPTANCE: { deliveryAccepted: true },
    DISPUTE_CHECK: { openDispute: false },
  };
  const types: EvidenceType[] = [
    "PROJECT_IDENTITY", "CODE_AUDIT", "DEAL_AGREEMENT",
    "PAYMENT", "BUYER_ACCEPTANCE", "DISPUTE_CHECK",
  ];
  return types.map((type, index) => ({
    id: "base-" + index,
    type,
    result: "PASS",
    mandatory: true,
    dealId: DEAL,
    projectId: PROJECT,
    contentHash: HASH,
    observedAt: "2026-11-05T19:00:00.000Z",
    validUntil: EXPIRY,
    sourceRecordId: "source-" + index,
    sourceVersion: type === "CODE_AUDIT" ? COMMIT : "v1",
    metadata: metadata[type],
  }));
}

function providerEvent(
  provider: "github" | "nicenic",
  phase: "SELLER" | "BUYER",
  overrides: Partial<AssetTransferEvent> = {},
): AssetTransferEvent {
  const buyerPhase = phase === "BUYER";
  return {
    eventId: provider + ":" + phase,
    eventType: buyerPhase ? "BUYER_CONTROL_VERIFIED" : "SELLER_CONTROL_VERIFIED",
    assetId: ASSET,
    dealId: DEAL,
    projectId: PROJECT,
    sourceProvider: provider,
    sourceRecordId: "record-1",
    sourceVersion: "version-1",
    sourceEventId: provider + ":" + phase + ":event",
    proofHash: HASH,
    observedAt: "2026-11-05T19:00:00.000Z",
    validUntil: EXPIRY,
    authoritative: true,
    currentOwnerIdentity: buyerPhase ? BUYER : SELLER,
    ...overrides,
  };
}

function input(overrides: Partial<UnifiedEvidenceInput> = {}): UnifiedEvidenceInput {
  return {
    dealId: DEAL,
    projectId: PROJECT,
    expectedCommitSha: COMMIT,
    expectedAssetId: ASSET,
    sellerIdentity: SELLER,
    buyerIdentity: BUYER,
    baseEvidence: baseEvidence(),
    sellerControlEvent: providerEvent("github", "SELLER"),
    buyerControlEvent: providerEvent("github", "BUYER"),
    requireRevenueVerification: false,
    now: NOW,
    ...overrides,
  };
}

Deno.test("aggregator joins trusted GitHub evidence with the acquisition decision", async () => {
  const result = await aggregateAcquisitionEvidence(input());
  if (result.decision.status !== "PASS") {
    throw new Error(JSON.stringify(result.decision.issues));
  }
  if (result.evidence.length !== 8) throw new Error("Expected six base and two provider evidence records.");
  if (result.sourceSummary.providerEvidenceCount !== 2) throw new Error("Provider count mismatch.");
});

Deno.test("aggregator accepts registrar seller and buyer control evidence", async () => {
  const result = await aggregateAcquisitionEvidence(input({
    sellerControlEvent: providerEvent("nicenic", "SELLER"),
    buyerControlEvent: providerEvent("nicenic", "BUYER", { eventType: "TRANSFER_CONFIRMED" }),
  }));
  if (result.decision.status !== "PASS") throw new Error("Expected registrar evidence to pass.");
});

Deno.test("aggregator rejects provider evidence bound to another deal", async () => {
  let rejected = false;
  try {
    await aggregateAcquisitionEvidence(input({
      sellerControlEvent: providerEvent("github", "SELLER", { dealId: "other-deal" }),
    }));
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Mismatched provider evidence must be rejected.");
});

Deno.test("aggregator rejects stale provider evidence", async () => {
  let rejected = false;
  try {
    await aggregateAcquisitionEvidence(input({
      buyerControlEvent: providerEvent("github", "BUYER", { validUntil: "2026-11-05T19:59:59.000Z" }),
    }));
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Stale provider evidence must be rejected.");
});

Deno.test("required revenue evidence is included in the required evidence policy", async () => {
  const revenue: AcquisitionEvidence = {
    id: "revenue-1",
    type: "REVENUE_VERIFICATION",
    result: "PASS",
    mandatory: true,
    dealId: DEAL,
    projectId: PROJECT,
    contentHash: HASH,
    observedAt: "2026-11-05T19:00:00.000Z",
    validUntil: EXPIRY,
    sourceRecordId: "56:token",
    sourceVersion: "100-110@120",
    metadata: {
      revenueStatus: "PASS",
      revenueScopeConfirmed: true,
      actualRevenueRaw: "2500",
      declaredRevenueRaw: "2500",
      chainId: 56,
      tokenAddress: "0x1111111111111111111111111111111111111111",
      fromBlock: 100,
      toBlock: 110,
      minConfirmations: 5,
    },
  };
  const result = await aggregateAcquisitionEvidence(input({
    revenueEvidence: revenue,
    requireRevenueVerification: true,
  }));
  if (result.decision.status !== "PASS") throw new Error(JSON.stringify(result.decision.issues));
  if (!result.sourceSummary.revenueEvidenceMandatory) throw new Error("Revenue evidence must be mandatory.");
});

Deno.test("deal requiring revenue verification remains incomplete when no revenue proof is supplied", async () => {
  const result = await aggregateAcquisitionEvidence(input({ requireRevenueVerification: true }));
  if (result.decision.status !== "INCOMPLETE") throw new Error("Missing revenue proof must remain incomplete.");
});
