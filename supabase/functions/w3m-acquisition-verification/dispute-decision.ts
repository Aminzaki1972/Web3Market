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

export interface W3MDisputeDecisionCommand {
  dealId: string;
  disputeId: string;
  outcome: W3MDisputeOutcome;
  reason: string;
  evidenceRefs: W3MDisputeEvidenceReference[];
}

export interface W3MCanonicalDisputeDecisionInput extends W3MDisputeDecisionCommand {
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
    evidenceRefs: W3MDisputeEvidenceReference[];
    decidedBy: string;
    decidedAt: string;
    termsVersionId: string;
    termsVersion: string;
    termsHash: string;
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

/** Parse only browser-controllable decision fields; authority, amount, recipient, and Safe fields are rejected. */
export function parseW3MDisputeDecisionCommand(value: unknown): W3MDisputeDecisionCommand {
  const row = record(value, "Dispute decision command");
  const allowed = new Set(["dealId", "disputeId", "outcome", "reason", "evidenceRefs"]);
  if (Object.keys(row).some((key) => !allowed.has(key))) {
    throw new Error("Dispute decision command contains server-controlled or unsupported fields.");
  }
  if (typeof row.outcome !== "string" || !OUTCOMES.includes(row.outcome as W3MDisputeOutcome)) {
    throw new Error("Dispute outcome must be buyer_wins or seller_wins.");
  }
  return {
    dealId: uuid(row.dealId, "Deal ID"),
    disputeId: uuid(row.disputeId, "Dispute ID"),
    outcome: row.outcome as W3MDisputeOutcome,
    reason: boundedText(row.reason, "Decision reason", 20, 5000),
    evidenceRefs: parseEvidenceRefs(row.evidenceRefs),
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
  const reason = boundedText(input.reason, "Decision reason", 20, 5000);
  const termsVersion = boundedText(input.termsVersion, "Terms version", 1, 32);
  if (!/^[1-9][0-9]*$/.test(termsVersion)) throw new Error("Terms version must be a positive integer.");
  if (typeof input.termsHash !== "string" || !HASH.test(input.termsHash)) {
    throw new Error("Terms hash must be exactly 32 bytes.");
  }
  const decidedAt = boundedText(input.decidedAt, "Decision timestamp", 20, 40);
  const parsedTime = Date.parse(decidedAt);
  if (!Number.isFinite(parsedTime) || new Date(parsedTime).toISOString() !== decidedAt) {
    throw new Error("Decision timestamp must be a canonical UTC ISO-8601 timestamp.");
  }
  const evidenceRefs = parseEvidenceRefs(input.evidenceRefs);
  const payload = {
    protocol: "W3M Protocol V1" as const,
    decisionId, dealId, disputeId, outcome: input.outcome, reason, evidenceRefs,
    decidedBy, decidedAt, termsVersionId, termsVersion,
    termsHash: input.termsHash.toLowerCase(),
  };
  const serialized = canonicalJson(payload);
  return { payload, canonicalJson: serialized, decisionHash: await sha256Hex(serialized) };
}
