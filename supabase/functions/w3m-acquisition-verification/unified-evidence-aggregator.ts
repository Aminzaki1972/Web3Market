// W3M Protocol V1 — unified adapter evidence aggregator.
// Pure composition layer. Provider authentication and source reads must happen
// before this function in trusted server-side adapters. No DB, network, or wallet calls.

import {
  evaluateAcquisition,
  type AcquisitionDecision,
  type AcquisitionEvidence,
  type AcquisitionContext,
} from "./decision-engine.ts";
import type { AssetTransferEvent } from "./asset-transfer-orchestrator.ts";

export const W3M_AGGREGATOR_VERSION = "w3m-unified-evidence-aggregator-1.0.0";

export interface UnifiedEvidenceInput {
  dealId: string;
  projectId: string;
  expectedCommitSha: string;
  expectedAssetId: string;
  sellerIdentity: string;
  buyerIdentity: string;
  baseEvidence: AcquisitionEvidence[];
  sellerControlEvent: AssetTransferEvent | null;
  buyerControlEvent: AssetTransferEvent | null;
  revenueEvidence?: AcquisitionEvidence | null;
  requireRevenueVerification: boolean;
  now: string;
}

export interface UnifiedEvidenceResult {
  aggregatorVersion: string;
  decision: AcquisitionDecision;
  evidence: AcquisitionEvidence[];
  sourceSummary: {
    baseEvidenceCount: number;
    providerEvidenceCount: number;
    revenueEvidenceIncluded: boolean;
    revenueEvidenceMandatory: boolean;
  };
}

const HASH256 = /^[0-9a-f]{64}$/;

function requireText(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(label + " is required.");
  }
}

function eventToEvidence(
  event: AssetTransferEvent | null,
  expected: {
    dealId: string;
    projectId: string;
    assetId: string;
    identity: string;
    phase: "SELLER" | "BUYER";
    now: string;
  },
): AcquisitionEvidence {
  if (!event) {
    throw new Error(expected.phase + " provider control event is required.");
  }

  const expectedEventType = expected.phase === "SELLER"
    ? "SELLER_CONTROL_VERIFIED"
    : ["BUYER_CONTROL_VERIFIED", "TRANSFER_CONFIRMED"].includes(event.eventType);

  if (
    event.dealId !== expected.dealId ||
    event.projectId !== expected.projectId ||
    event.assetId !== expected.assetId ||
    event.authoritative !== true ||
    !HASH256.test(event.proofHash) ||
    !event.eventId.trim() ||
    !event.sourceEventId.trim() ||
    !event.sourceRecordId.trim() ||
    !event.sourceVersion.trim() ||
    !["github", "nicenic"].includes(event.sourceProvider) ||
    !Number.isFinite(Date.parse(event.observedAt)) ||
    !Number.isFinite(Date.parse(event.validUntil)) ||
    Date.parse(event.observedAt) > Date.parse(expected.now) ||
    Date.parse(event.validUntil) <= Date.parse(expected.now) ||
    Date.parse(event.validUntil) <= Date.parse(event.observedAt) ||
    (expected.phase === "SELLER" && event.eventType !== expectedEventType) ||
    (expected.phase === "BUYER" && expectedEventType !== true)
  ) {
    throw new Error(expected.phase + " provider event is invalid, stale, or bound to another deal/project/asset.");
  }

  const verifiedOwnerIdentity = event.currentOwnerIdentity ?? event.toIdentity;
  if (verifiedOwnerIdentity !== expected.identity) {
    throw new Error(expected.phase + " provider event does not prove the expected account identity.");
  }

  const sellerPhase = expected.phase === "SELLER";
  return {
    id: "provider:" + event.sourceProvider + ":" + event.sourceEventId,
    type: sellerPhase ? "OWNERSHIP_CONTROL" : "ASSET_TRANSFER",
    result: "PASS",
    mandatory: true,
    dealId: expected.dealId,
    projectId: expected.projectId,
    contentHash: event.proofHash,
    observedAt: event.observedAt,
    validUntil: event.validUntil,
    sourceRecordId: event.sourceRecordId,
    sourceVersion: event.sourceVersion,
    metadata: sellerPhase
      ? {
        sellerControlVerified: true,
        provider: event.sourceProvider,
        assetId: event.assetId,
        sourceEventId: event.sourceEventId,
      }
      : {
        transferConfirmed: true,
        buyerControlVerified: true,
        provider: event.sourceProvider,
        assetId: event.assetId,
        sourceEventId: event.sourceEventId,
      },
  };
}

export async function aggregateAcquisitionEvidence(
  input: UnifiedEvidenceInput,
): Promise<UnifiedEvidenceResult> {
  requireText(input.dealId, "Deal ID");
  requireText(input.projectId, "Project ID");
  requireText(input.expectedAssetId, "Expected asset ID");
  requireText(input.sellerIdentity, "Seller identity");
  requireText(input.buyerIdentity, "Buyer identity");
  requireText(input.now, "Evaluation timestamp");

  if (input.sellerIdentity === input.buyerIdentity) {
    throw new Error("Seller and buyer identities must be distinct.");
  }
  if (!Number.isFinite(Date.parse(input.now))) {
    throw new Error("Evaluation timestamp is invalid.");
  }

  const sellerEvidence = eventToEvidence(input.sellerControlEvent, {
    dealId: input.dealId,
    projectId: input.projectId,
    assetId: input.expectedAssetId,
    identity: input.sellerIdentity,
    phase: "SELLER",
    now: input.now,
  });
  const buyerEvidence = eventToEvidence(input.buyerControlEvent, {
    dealId: input.dealId,
    projectId: input.projectId,
    assetId: input.expectedAssetId,
    identity: input.buyerIdentity,
    phase: "BUYER",
    now: input.now,
  });

  const evidence: AcquisitionEvidence[] = [
    ...input.baseEvidence,
    sellerEvidence,
    buyerEvidence,
  ];

  let revenueEvidenceIncluded = false;
  if (input.revenueEvidence) {
    if (input.revenueEvidence.type !== "REVENUE_VERIFICATION") {
      throw new Error("Revenue evidence must use the REVENUE_VERIFICATION type.");
    }
    evidence.push({
      ...input.revenueEvidence,
      mandatory: input.requireRevenueVerification,
    });
    revenueEvidenceIncluded = true;
  }

  const requiredEvidenceTypes: AcquisitionContext["requiredEvidenceTypes"] =
    input.requireRevenueVerification
      ? [
        "PROJECT_IDENTITY",
        "CODE_AUDIT",
        "OWNERSHIP_CONTROL",
        "ASSET_TRANSFER",
        "DEAL_AGREEMENT",
        "PAYMENT",
        "BUYER_ACCEPTANCE",
        "DISPUTE_CHECK",
        "REVENUE_VERIFICATION",
      ]
      : undefined;

  const decision = await evaluateAcquisition({
    dealId: input.dealId,
    projectId: input.projectId,
    expectedCommitSha: input.expectedCommitSha,
    evidence,
    now: input.now,
    ...(requiredEvidenceTypes ? { requiredEvidenceTypes } : {}),
  });

  return {
    aggregatorVersion: W3M_AGGREGATOR_VERSION,
    decision,
    evidence,
    sourceSummary: {
      baseEvidenceCount: input.baseEvidence.length,
      providerEvidenceCount: 2,
      revenueEvidenceIncluded,
      revenueEvidenceMandatory: input.requireRevenueVerification,
    },
  };
}
