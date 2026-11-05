// W3M Protocol V1 — deterministic, fail-closed evidence decision engine.
// Pure domain logic only: no database access, secrets, network calls, or production side effects.

export const W3M_ENGINE_VERSION = "w3m-acquisition-verification-1.0.0";

export const REQUIRED_EVIDENCE_TYPES = [
  "PROJECT_IDENTITY",
  "CODE_AUDIT",
  "OWNERSHIP_CONTROL",
  "ASSET_TRANSFER",
  "DEAL_AGREEMENT",
  "PAYMENT",
  "BUYER_ACCEPTANCE",
  "DISPUTE_CHECK",
] as const;

export type EvidenceType = typeof REQUIRED_EVIDENCE_TYPES[number];
export type EvidenceResult = "PASS" | "MISSING" | "FAILED" | "STALE" | "REVIEW_REQUIRED";
export type ReportStatus = "PASS" | "INCOMPLETE" | "BLOCKED" | "REVIEW_REQUIRED";

export interface AcquisitionEvidence {
  id: string;
  type: EvidenceType;
  result: EvidenceResult;
  mandatory: boolean;
  dealId: string;
  projectId: string;
  contentHash: string;
  observedAt: string;
  validUntil: string | null;
  sourceRecordId?: string | null;
  sourceVersion?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AcquisitionContext {
  dealId: string;
  projectId: string;
  expectedCommitSha: string;
  evidence: AcquisitionEvidence[];
  now?: string;
  requiredEvidenceTypes?: readonly EvidenceType[];
}

export interface DecisionIssue {
  code: string;
  evidenceId?: string;
  evidenceType?: EvidenceType;
  message: string;
}

export interface AcquisitionDecision {
  status: ReportStatus;
  engineVersion: string;
  dealId: string;
  projectId: string;
  evidenceHash: string;
  checkedAt: string;
  issues: DecisionIssue[];
  evidenceCount: number;
  passedMandatoryCount: number;
  requiredTypeCount: number;
}

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) result[key] = stableValue(value[key]);
  return result;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function issue(
  code: string,
  message: string,
  evidence?: AcquisitionEvidence,
): DecisionIssue {
  return {
    code,
    message,
    ...(evidence ? { evidenceId: evidence.id, evidenceType: evidence.type } : {}),
  };
}

function validateEvidenceSemantics(
  evidence: AcquisitionEvidence,
  expectedCommitSha: string,
): DecisionIssue | null {
  const metadata = evidence.metadata || {};

  switch (evidence.type) {
    case "PROJECT_IDENTITY":
      if (metadata.projectApproved !== true || metadata.identityMatched !== true) {
        return issue("PROJECT_IDENTITY_NOT_CONFIRMED", "Marketplace project identity is not confirmed.", evidence);
      }
      break;
    case "CODE_AUDIT":
      if (metadata.auditStatus !== "completed") {
        return issue("CODE_AUDIT_NOT_COMPLETED", "The linked code audit is not completed.", evidence);
      }
      if (
        !expectedCommitSha ||
        !COMMIT_SHA.test(expectedCommitSha) ||
        (String(metadata.commitSha || "").toLowerCase() !== expectedCommitSha.toLowerCase() ||
        String(evidence.sourceVersion || "").toLowerCase() !== expectedCommitSha.toLowerCase())
      ) {
        return issue("CODE_COMMIT_MISMATCH", "The audit does not match the exact commit selected for this deal.", evidence);
      }
      break;
    case "OWNERSHIP_CONTROL":
      if (metadata.sellerControlVerified !== true) {
        return issue("OWNERSHIP_NOT_VERIFIED", "Seller control of the agreed assets has not been verified.", evidence);
      }
      break;
    case "ASSET_TRANSFER":
      if (metadata.transferConfirmed !== true) {
        return issue("ASSET_TRANSFER_NOT_CONFIRMED", "The required asset transfer has not been confirmed.", evidence);
      }
      break;
    case "DEAL_AGREEMENT":
      if (metadata.buyerAcceptedTerms !== true || metadata.sellerAcceptedTerms !== true) {
        return issue("DEAL_TERMS_NOT_ACCEPTED", "Both parties' acceptance of the deal terms is not confirmed.", evidence);
      }
      break;
    case "PAYMENT":
      if (metadata.paymentConfirmed !== true) {
        return issue("PAYMENT_NOT_CONFIRMED", "Trusted on-chain payment verification is missing.", evidence);
      }
      break;
    case "BUYER_ACCEPTANCE":
      if (metadata.deliveryAccepted !== true) {
        return issue("BUYER_DELIVERY_NOT_ACCEPTED", "Buyer acceptance of delivery is missing.", evidence);
      }
      break;
    case "DISPUTE_CHECK":
      if (metadata.openDispute !== false) {
        return issue("DISPUTE_NOT_CLEARED", "The deal is not confirmed to be free of an open dispute.", evidence);
      }
      break;
  }
  return null;
}

export async function evaluateAcquisition(
  context: AcquisitionContext,
): Promise<AcquisitionDecision> {
  const nowText = context.now || new Date().toISOString();
  const nowMs = validDate(nowText);
  const requiredTypes = context.requiredEvidenceTypes || REQUIRED_EVIDENCE_TYPES;
  const issues: DecisionIssue[] = [];

  if (!context.dealId.trim() || !context.projectId.trim()) {
    issues.push(issue("DEAL_BINDING_MISSING", "A deal ID and project ID are required."));
  }
  if (!COMMIT_SHA.test(context.expectedCommitSha || "")) {
    issues.push(issue("EXPECTED_COMMIT_INVALID", "The exact 40-character Git commit SHA is required."));
  }
  if (nowMs === null) {
    issues.push(issue("CLOCK_INVALID", "The evaluation timestamp is invalid."));
  }

  const evidence = [...(context.evidence || [])].sort((a, b) => a.id.localeCompare(b.id));
  const passedIds = new Set<string>();

  for (const item of evidence) {
    if (!item.id || passedIds.has(item.id)) {
      issues.push(issue("EVIDENCE_ID_DUPLICATE", "Evidence IDs must be present and unique.", item));
      continue;
    }
    passedIds.add(item.id);

    if (item.dealId !== context.dealId || item.projectId !== context.projectId) {
      issues.push(issue("EVIDENCE_BINDING_MISMATCH", "Evidence is not bound to this exact deal and project.", item));
      continue;
    }
    if (!SHA256.test(item.contentHash || "")) {
      issues.push(issue("EVIDENCE_HASH_INVALID", "Evidence must include a valid SHA-256 content hash.", item));
      continue;
    }
    // Optional evidence is included in the signed manifest but does not gate settlement.
    if (!item.mandatory) continue;
    if (item.result === "FAILED") {
      issues.push(issue("MANDATORY_EVIDENCE_FAILED", "Evidence verification failed.", item));
      continue;
    }
    if (item.result === "REVIEW_REQUIRED") {
      issues.push(issue("MANUAL_REVIEW_REQUIRED", "Evidence requires authorized manual review.", item));
      continue;
    }
    if (item.result === "MISSING") {
      issues.push(issue("EVIDENCE_MISSING", "Required evidence is missing.", item));
      continue;
    }
    if (item.result === "STALE") {
      issues.push(issue("EVIDENCE_STALE", "Evidence is stale and must be refreshed.", item));
      continue;
    }
    if (item.result !== "PASS") {
      issues.push(issue("EVIDENCE_RESULT_INVALID", "Evidence result is not recognized.", item));
      continue;
    }

    const observedAt = validDate(item.observedAt);
    const validUntil = validDate(item.validUntil);
    if (observedAt === null || nowMs === null || observedAt > nowMs) {
      issues.push(issue("EVIDENCE_TIME_INVALID", "Evidence observation time is invalid or in the future.", item));
      continue;
    }
    if (validUntil === null || nowMs >= validUntil || validUntil <= observedAt) {
      issues.push(issue("EVIDENCE_EXPIRED", "Evidence has expired or has no valid expiry window.", item));
      continue;
    }

    const semanticIssue = validateEvidenceSemantics(item, context.expectedCommitSha);
    if (semanticIssue) {
      issues.push(semanticIssue);
      continue;
    }
  }

  for (const type of requiredTypes) {
    const candidates = evidence.filter((item) => item.type === type && item.mandatory);
    if (!candidates.length) {
      issues.push(issue("REQUIRED_EVIDENCE_TYPE_MISSING", `Required evidence category ${type} is missing.`));
    } else {
      for (const item of candidates) {
        const itemHasIssue = issues.some((entry) => entry.evidenceId === item.id);
        if (!itemHasIssue) {
          // This ID is used only for counting; no source record is mutated.
          passedIds.add("passed:" + item.id);
        }
      }
    }
  }

  const evidenceHashInput = {
    protocol: "W3M Protocol V1",
    engineVersion: W3M_ENGINE_VERSION,
    dealId: context.dealId,
    projectId: context.projectId,
    expectedCommitSha: String(context.expectedCommitSha || "").toLowerCase(),
    requiredEvidenceTypes: [...requiredTypes].sort(),
    evidence: evidence.map((item) => ({
      id: item.id,
      type: item.type,
      result: item.result,
      mandatory: item.mandatory,
      dealId: item.dealId,
      projectId: item.projectId,
      contentHash: item.contentHash,
      observedAt: item.observedAt,
      validUntil: item.validUntil,
      sourceRecordId: item.sourceRecordId || null,
      sourceVersion: item.sourceVersion || null,
      metadata: item.metadata || {},
    })),
  };
  const evidenceHash = await sha256Hex(canonicalJson(evidenceHashInput));

  let status: ReportStatus = "PASS";
  if (issues.some((entry) =>
    entry.code.includes("MISMATCH") ||
    entry.code.includes("FAILED") ||
    entry.code.includes("NOT_CONFIRMED") ||
    entry.code.includes("NOT_VERIFIED") ||
    entry.code.includes("NOT_ACCEPTED") ||
    entry.code.includes("NOT_CLEARED") ||
    entry.code === "EXPECTED_COMMIT_INVALID" ||
    entry.code === "DEAL_BINDING_MISSING"
  )) {
    status = "BLOCKED";
  } else if (issues.some((entry) => entry.code === "MANUAL_REVIEW_REQUIRED")) {
    status = "REVIEW_REQUIRED";
  } else if (issues.length > 0) {
    status = "INCOMPLETE";
  }

  const passedMandatoryCount = evidence.filter((item) =>
    item.mandatory &&
    item.result === "PASS" &&
    !issues.some((entry) => entry.evidenceId === item.id)
  ).length;

  return {
    status,
    engineVersion: W3M_ENGINE_VERSION,
    dealId: context.dealId,
    projectId: context.projectId,
    evidenceHash,
    checkedAt: nowText,
    issues,
    evidenceCount: evidence.length,
    passedMandatoryCount,
    requiredTypeCount: requiredTypes.length,
  };
}
