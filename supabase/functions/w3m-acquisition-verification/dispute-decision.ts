// W3M Protocol V1 — pure validation and canonical hashing for dispute decisions.
// Authority, evidence ownership, deal state, and terms are loaded and revalidated server-side.
import { canonicalJson, sha256Hex } from "./decision-engine.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const OUTCOMES = ["buyer_wins", "seller_wins"] as const;
const EVIDENCE_SOURCES = ["deal_message", "deal_asset", "deal_event", "deal_audit_log"] as const;

export type W3MDisputeOutcome = typeof OUTCOMES[number];
export type W3MDisputeEvidenceSource = typeof EVIDENCE_SOURCES[number];

export interface W3MDisputeEvidenceReference {
  source: W3MDisputeEvidenceSource;
  recordId: string;
}

export interface W3MCanonicalDisputeEvidenceReference extends W3MDisputeEvidenceReference {
  contentHash: string;
}

export interface W3MDisputeDecisionCommand {
  dealId: string;
  disputeId: string;
  outcome: W3MDisputeOutcome;
  reason: string;
  evidenceRefs: W3MDisputeEvidenceReference[];
  buyerRefundAmount?: string;
}

export interface W3MDisputePriorState {
  dealStatus: "disputed";
  dealDisputeStatus: "open" | "under_review";
  disputeRecordStatus: "open" | "under_review";
}

export interface W3MCanonicalDisputeDecisionInput extends Omit<W3MDisputeDecisionCommand, "evidenceRefs"> {
  evidenceRefs: W3MCanonicalDisputeEvidenceReference[];
  priorState: W3MDisputePriorState;
  decisionId: string;
  decidedBy: string;
  decidedAt: string;
  termsVersionId: string;
  termsVersion: string;
  termsHash: string;
}

export interface W3MCanonicalDisputeDecision {
  payload: {
    protocol: "W3M Protocol V1";
    decisionId: string;
    dealId: string;
    disputeId: string;
    outcome: W3MDisputeOutcome;
    reason: string;
    evidenceRefs: W3MCanonicalDisputeEvidenceReference[];
    priorState: W3MDisputePriorState;
    decidedBy: string;
    decidedAt: string;
    termsVersionId: string;
    termsVersion: string;
    termsHash: string;
    buyerRefundAmount: string | null;
  };
  canonicalJson: string;
  decisionHash: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " must be an object.");
  }
  return value as Record<string, unknown>;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error(label + " must be a valid UUID.");
  }
  return value.toLowerCase();
}

function boundedText(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string") throw new Error(label + " must be text.");
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new Error(label + " must contain between " + min + " and " + max + " characters.");
  }
  return normalized;
}

function parseCanonicalEvidenceRefs(value: unknown): W3MCanonicalDisputeEvidenceReference[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error("Canonical evidence references must contain between 1 and 100 records.");
  }
  const seen = new Set<string>();
  const refs = value.map((item, index) => {
    const row = record(item, "Canonical evidence reference " + index);
    if (Object.keys(row).some((key) => key !== "source" && key !== "recordId" && key !== "contentHash")) {
      throw new Error("Canonical evidence reference contains unsupported fields.");
    }
    if (typeof row.source !== "string" ||
        !EVIDENCE_SOURCES.includes(row.source as W3MDisputeEvidenceSource)) {
      throw new Error("Canonical evidence reference source is unsupported.");
    }
    const source = row.source as W3MDisputeEvidenceSource;
    const recordId = uuid(row.recordId, "Evidence record ID");
    if (typeof row.contentHash !== "string" || !HASH.test(row.contentHash)) {
      throw new Error("Evidence content hash must be exactly 32 bytes.");
    }
    const key = source + ":" + recordId;
    if (seen.has(key)) throw new Error("Duplicate canonical evidence reference.");
    seen.add(key);
    return { source, recordId, contentHash: row.contentHash.toLowerCase() };
  });
  return refs.sort((a, b) =>
    a.source.localeCompare(b.source) || a.recordId.localeCompare(b.recordId)
  );
}

function parseEvidenceRefs(value: unknown): W3MDisputeEvidenceReference[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error("Evidence references must contain between 1 and 100 records.");
  }
  const seen = new Set<string>();
  const refs = value.map((item, index) => {
    const row = record(item, "Evidence reference " + index);
    if (Object.keys(row).some((key) => key !== "source" && key !== "recordId")) {
      throw new Error("Evidence reference contains unsupported fields.");
    }
    if (typeof row.source !== "string" ||
        !EVIDENCE_SOURCES.includes(row.source as W3MDisputeEvidenceSource)) {
      throw new Error("Evidence reference source is unsupported.");
    }
    const source = row.source as W3MDisputeEvidenceSource;
    const recordId = uuid(row.recordId, "Evidence record ID");
    const key = source + ":" + recordId;
    if (seen.has(key)) throw new Error("Duplicate evidence reference.");
    seen.add(key);
    return { source, recordId };
  });
  return refs.sort((a, b) =>
    a.source.localeCompare(b.source) || a.recordId.localeCompare(b.recordId)
  );
}

/** Parse the verified-admin decision command; refund amount is allowed only as a proposed buyer-win decision value and is revalidated by the database. */
export function parseW3MDisputeDecisionCommand(value: unknown): W3MDisputeDecisionCommand {
  const row = record(value, "Dispute decision command");
  const allowed = new Set(["dealId", "disputeId", "outcome", "reason", "evidenceRefs", "buyerRefundAmount"]);
  if (Object.keys(row).some((key) => !allowed.has(key))) {
    throw new Error("Dispute decision command contains server-controlled or unsupported fields.");
  }
  if (typeof row.outcome !== "string" || !OUTCOMES.includes(row.outcome as W3MDisputeOutcome)) {
    throw new Error("Dispute outcome must be buyer_wins or seller_wins.");
  }
  let buyerRefundAmount: string | undefined;
  if (row.outcome === "buyer_wins") {
    if (typeof row.buyerRefundAmount !== "string" || !/^(0|[1-9][0-9]{0,59})(\.[0-9]{1,18})?$/.test(row.buyerRefundAmount)) {
      throw new Error("Buyer-win decisions require a positive canonical refund amount with at most 18 decimals.");
    }
    const [whole, fraction = ""] = row.buyerRefundAmount.split(".");
    const normalizedFraction = fraction.replace(/0+$/, "");
    buyerRefundAmount = whole + (normalizedFraction ? "." + normalizedFraction : "");
    if (!/[1-9]/.test(buyerRefundAmount)) throw new Error("Buyer refund amount must be greater than zero.");
  } else if (Object.prototype.hasOwnProperty.call(row, "buyerRefundAmount")) {
    throw new Error("Seller-win decisions cannot include a buyer refund amount.");
  }
  return {
    dealId: uuid(row.dealId, "Deal ID"),
    disputeId: uuid(row.disputeId, "Dispute ID"),
    outcome: row.outcome as W3MDisputeOutcome,
    reason: boundedText(row.reason, "Decision reason", 20, 5000),
    evidenceRefs: parseEvidenceRefs(row.evidenceRefs),
    ...(buyerRefundAmount ? { buyerRefundAmount } : {}),
  };
}

/** Build the immutable decision payload using only server-loaded identity, time, and terms bindings. */
export async function buildW3MCanonicalDisputeDecision(
  input: W3MCanonicalDisputeDecisionInput,
): Promise<W3MCanonicalDisputeDecision> {
  const decisionId = uuid(input.decisionId, "Decision ID");
  const dealId = uuid(input.dealId, "Deal ID");
  const disputeId = uuid(input.disputeId, "Dispute ID");
  const decidedBy = uuid(input.decidedBy, "Decision maker ID");
  const termsVersionId = uuid(input.termsVersionId, "Terms version ID");
  if (!OUTCOMES.includes(input.outcome)) throw new Error("Dispute outcome is unsupported.");
  let buyerRefundAmount: string | null = null;
  if (input.outcome === "buyer_wins") {
    if (typeof input.buyerRefundAmount !== "string" || !/^(0|[1-9][0-9]{0,59})(\.[0-9]{1,18})?$/.test(input.buyerRefundAmount)) {
      throw new Error("Buyer-win decisions require a positive canonical refund amount.");
    }
    const [whole, fraction = ""] = input.buyerRefundAmount.split(".");
    const normalizedFraction = fraction.replace(/0+$/, "");
    buyerRefundAmount = whole + (normalizedFraction ? "." + normalizedFraction : "");
    if (!/[1-9]/.test(buyerRefundAmount)) throw new Error("Buyer refund amount must be greater than zero.");
  } else if (input.buyerRefundAmount !== undefined) {
    throw new Error("Seller-win decisions cannot include a buyer refund amount.");
  }
  const reason = boundedText(input.reason, "Decision reason", 20, 5000);
  const termsVersion = boundedText(input.termsVersion, "Terms version", 1, 32);
  if (!/^[1-9][0-9]{0,59}$/.test(termsVersion)) throw new Error("Terms version must be a positive integer.");
  if (typeof input.termsHash !== "string" || !HASH.test(input.termsHash)) {
    throw new Error("Terms hash must be exactly 32 bytes.");
  }
  const decidedAt = boundedText(input.decidedAt, "Decision timestamp", 20, 40);
  const parsedTime = Date.parse(decidedAt);
  if (!Number.isFinite(parsedTime) || new Date(parsedTime).toISOString() !== decidedAt) {
    throw new Error("Decision timestamp must be a canonical UTC ISO-8601 timestamp.");
  }
  const evidenceRefs = parseCanonicalEvidenceRefs(input.evidenceRefs);
  const priorState = record(input.priorState, "Prior dispute state");
  if (priorState.dealStatus !== "disputed" ||
      !["open", "under_review"].includes(String(priorState.dealDisputeStatus)) ||
      !["open", "under_review"].includes(String(priorState.disputeRecordStatus))) {
    throw new Error("Dispute decision requires a currently active and consistently disputed deal state.");
  }
  const normalizedPriorState = {
    dealStatus: "disputed" as const,
    dealDisputeStatus: priorState.dealDisputeStatus as "open" | "under_review",
    disputeRecordStatus: priorState.disputeRecordStatus as "open" | "under_review",
  };
  const payload = {
    protocol: "W3M Protocol V1" as const,
    decisionId, dealId, disputeId, outcome: input.outcome, reason, evidenceRefs,
    priorState: normalizedPriorState,
    decidedBy, decidedAt, termsVersionId, termsVersion,
    termsHash: input.termsHash.toLowerCase(),
    buyerRefundAmount,
  };
  const serialized = canonicalJson(payload);
  return { payload, canonicalJson: serialized, decisionHash: await sha256Hex(serialized) };
}
