// W3M Protocol V1 — immutable registry batch builder.
// Pure server-side preparation only: no Supabase calls, key access, or chain actions.
// A trusted signer adapter must sign the returned canonical report hash.

import {
  canonicalJson,
  sha256Hex,
  type AcquisitionDecision,
  type AcquisitionEvidence,
} from "./decision-engine.ts";

export const W3M_REGISTRY_BUILDER_VERSION = "w3m-registry-batch-builder-1.0.0";
const SHA256 = /^[0-9a-f]{64}$/;
const SIGNATURE_65_BYTE = /^0x[0-9a-fA-F]{130}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RegistrySigner {
  signerKeyId: string;
  signature: string;
}

export interface RegistryReportRow {
  id: string;
  deal_id: string;
  project_id: string;
  report_version: number;
  supersedes_report_id: string | null;
  buyer_id: string | null;
  seller_id: string | null;
  status: AcquisitionDecision["status"];
  engine_version: string;
  evidence_hash: string;
  report_hash: string;
  report_payload: Record<string, unknown>;
  signer_key_id: string;
  report_signature: string;
  issued_at: string;
  expires_at: string;
}

export interface RegistryEvidenceRow {
  id: string;
  report_id: string;
  evidence_type: AcquisitionEvidence["type"];
  source_table: string | null;
  source_record_id: string | null;
  source_version: string | null;
  evidence_hash: string;
  result: AcquisitionEvidence["result"];
  mandatory: boolean;
  observed_at: string;
  valid_until: string | null;
  details: Record<string, unknown>;
}

export interface RegistryEventRow {
  id: string;
  report_id: string;
  deal_id: string;
  event_type: "REPORT_CREATED" | "EVIDENCE_ATTACHED";
  actor_type: "SYSTEM" | "VERIFIER";
  actor_ref: string | null;
  event_hash: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface RegistryBatch {
  report: RegistryReportRow;
  evidence: RegistryEvidenceRow[];
  events: RegistryEventRow[];
  canonicalEnvelope: Record<string, unknown>;
  digestToSign: string;
}

export interface RegistryBatchInput {
  reportId: string;
  evidenceRowIds: string[];
  eventRowIds: string[];
  decision: AcquisitionDecision;
  evidence: AcquisitionEvidence[];
  reportVersion: number;
  supersedesReportId?: string | null;
  buyerId?: string | null;
  sellerId?: string | null;
  issuedAt: string;
  expiresAt: string;
  actorType: "SYSTEM" | "VERIFIER";
  actorRef?: string | null;
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " is required.");
}

function validDate(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(label + " is invalid.");
  return parsed;
}

export async function buildSignedRegistryBatch(
  input: RegistryBatchInput,
  signDigest: (digestHex: string) => Promise<RegistrySigner>,
): Promise<RegistryBatch> {
  requireText(input.reportId, "Report ID");
  if (!UUID.test(input.reportId)) throw new Error("Report ID must be a UUID.");
  if (!Number.isSafeInteger(input.reportVersion) || input.reportVersion < 1) {
    throw new Error("Report version must be a positive integer.");
  }
  if (input.supersedesReportId && !UUID.test(input.supersedesReportId)) {
    throw new Error("Superseded report ID must be a UUID.");
  }
  if (input.supersedesReportId === input.reportId) throw new Error("A report cannot supersede itself.");
  if (input.buyerId != null) requireText(input.buyerId, "Buyer ID");
  if (input.sellerId != null) requireText(input.sellerId, "Seller ID");
  if (input.actorRef != null) requireText(input.actorRef, "Actor reference");
  if (!Array.isArray(input.evidence) || input.evidence.length !== input.decision.evidenceCount) {
    throw new Error("Evidence list does not match the evaluated decision count.");
  }
  if (input.evidenceRowIds.length !== input.evidence.length ||
      input.eventRowIds.length !== input.evidence.length + 1) {
    throw new Error("Registry row ID counts do not match the evidence batch.");
  }
  const allIds = [input.reportId, ...input.evidenceRowIds, ...input.eventRowIds];
  if (allIds.some((id) => !UUID.test(id)) || new Set(allIds).size !== allIds.length) {
    throw new Error("All registry row IDs must be unique UUIDs.");
  }

  const issuedMs = validDate(input.issuedAt, "Report issue time");
  const expiresMs = validDate(input.expiresAt, "Report expiry");
  const checkedMs = validDate(input.decision.checkedAt, "Decision check time");
  if (expiresMs <= issuedMs || checkedMs > issuedMs) {
    throw new Error("Report expiry must follow issue time and issue time cannot precede evaluation.");
  }
  if (!SHA256.test(input.decision.evidenceHash) ||
      input.decision.status === "PASS" && input.decision.issues.length > 0) {
    throw new Error("Decision integrity fields are invalid.");
  }
  if (input.decision.dealId.trim() === "" || input.decision.projectId.trim() === "") {
    throw new Error("Decision must be bound to a deal and project.");
  }

  const evidenceIds = new Set<string>();
  for (const item of input.evidence) {
    if (evidenceIds.has(item.id)) throw new Error("Evidence IDs must be unique.");
    evidenceIds.add(item.id);
    if (item.dealId !== input.decision.dealId || item.projectId !== input.decision.projectId ||
        !SHA256.test(item.contentHash) || !item.id.trim()) {
      throw new Error("Evidence binding or content hash is invalid.");
    }
  }

  const envelope: Record<string, unknown> = {
    schema: "w3m-acquisition-report-v1",
    builderVersion: W3M_REGISTRY_BUILDER_VERSION,
    reportId: input.reportId,
    dealId: input.decision.dealId,
    projectId: input.decision.projectId,
    reportVersion: input.reportVersion,
    supersedesReportId: input.supersedesReportId ?? null,
    status: input.decision.status,
    engineVersion: input.decision.engineVersion,
    evidenceHash: input.decision.evidenceHash,
    checkedAt: input.decision.checkedAt,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    evidenceCount: input.decision.evidenceCount,
    passedMandatoryCount: input.decision.passedMandatoryCount,
    requiredTypeCount: input.decision.requiredTypeCount,
    issues: input.decision.issues,
    evidence: [...input.evidence].sort((a, b) => a.id.localeCompare(b.id)).map((item) => ({
      id: item.id,
      type: item.type,
      result: item.result,
      mandatory: item.mandatory,
      contentHash: item.contentHash,
      observedAt: item.observedAt,
      validUntil: item.validUntil,
      sourceRecordId: item.sourceRecordId ?? null,
      sourceVersion: item.sourceVersion ?? null,
      metadata: item.metadata ?? {},
    })),
  };

  const digestToSign = await sha256Hex(canonicalJson(envelope));
  const signer = await signDigest(digestToSign);
  requireText(signer.signerKeyId, "Signer key ID");
  if (!SIGNATURE_65_BYTE.test(signer.signature)) {
    throw new Error("Signer must return a 65-byte ECDSA signature in 0x-prefixed hex.");
  }

  const report: RegistryReportRow = {
    id: input.reportId,
    deal_id: input.decision.dealId,
    project_id: input.decision.projectId,
    report_version: input.reportVersion,
    supersedes_report_id: input.supersedesReportId ?? null,
    buyer_id: input.buyerId ?? null,
    seller_id: input.sellerId ?? null,
    status: input.decision.status,
    engine_version: input.decision.engineVersion,
    evidence_hash: input.decision.evidenceHash,
    report_hash: digestToSign,
    report_payload: envelope,
    signer_key_id: signer.signerKeyId,
    report_signature: signer.signature,
    issued_at: input.issuedAt,
    expires_at: input.expiresAt,
  };

  const evidenceRows: RegistryEvidenceRow[] = input.evidence.map((item, index) => ({
    id: input.evidenceRowIds[index],
    report_id: input.reportId,
    evidence_type: item.type,
    source_table: null,
    source_record_id: item.sourceRecordId ?? null,
    source_version: item.sourceVersion ?? null,
    evidence_hash: item.contentHash,
    result: item.result,
    mandatory: item.mandatory,
    observed_at: item.observedAt,
    valid_until: item.validUntil,
    details: item.metadata ?? {},
  }));

  const eventDrafts = [
    {
      id: input.eventRowIds[0],
      event_type: "REPORT_CREATED" as const,
      metadata: { status: input.decision.status, reportHash: digestToSign, reportVersion: input.reportVersion },
    },
    ...evidenceRows.map((row, index) => ({
      id: input.eventRowIds[index + 1],
      event_type: "EVIDENCE_ATTACHED" as const,
      metadata: { evidenceRowId: row.id, evidenceType: row.evidence_type, evidenceHash: row.evidence_hash },
    })),
  ];

  const events: RegistryEventRow[] = await Promise.all(eventDrafts.map(async (draft) => {
    const body = {
      reportId: input.reportId,
      dealId: input.decision.dealId,
      eventType: draft.event_type,
      actorType: input.actorType,
      actorRef: input.actorRef ?? null,
      metadata: draft.metadata,
      createdAt: input.issuedAt,
    };
    return {
      id: draft.id,
      report_id: input.reportId,
      deal_id: input.decision.dealId,
      event_type: draft.event_type,
      actor_type: input.actorType,
      actor_ref: input.actorRef ?? null,
      event_hash: await sha256Hex(canonicalJson(body)),
      metadata: draft.metadata,
      created_at: input.issuedAt,
    };
  }));

  return {
    report,
    evidence: evidenceRows,
    events,
    canonicalEnvelope: envelope,
    digestToSign,
  };
}
