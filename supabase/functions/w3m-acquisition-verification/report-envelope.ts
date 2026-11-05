// W3M Protocol V1 — canonical immutable report envelope.
// Pure serialization/hash helper. It does NOT sign, persist, authorize, or deploy reports.
// A trusted server-side signer must sign reportHash and persist the report atomically.

import { canonicalJson, sha256Hex, type AcquisitionDecision } from "./decision-engine.ts";

export const W3M_REPORT_ENVELOPE_VERSION = "w3m-report-envelope-1.0.0";
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/i;

export interface ReportEnvelopeInput {
  reportId: string;
  reportVersion: number;
  supersedesReportId: string | null;
  buyerId: string | null;
  sellerId: string | null;
  dealTermsHash: string;
  auditId: string;
  expectedCommitSha: string;
  issuedAt: string;
  expiresAt: string;
  decision: AcquisitionDecision;
}

export interface CanonicalReportEnvelope {
  protocol: "W3M Protocol V1";
  envelopeVersion: string;
  reportId: string;
  reportVersion: number;
  supersedesReportId: string | null;
  dealId: string;
  projectId: string;
  buyerId: string | null;
  sellerId: string | null;
  dealTermsHash: string;
  auditId: string;
  expectedCommitSha: string;
  status: AcquisitionDecision["status"];
  engineVersion: string;
  evidenceHash: string;
  issuedAt: string;
  expiresAt: string;
  checkedAt: string;
  evidenceCount: number;
  passedMandatoryCount: number;
  requiredTypeCount: number;
  issues: AcquisitionDecision["issues"];
}

export interface BuiltReportEnvelope {
  envelope: CanonicalReportEnvelope;
  canonicalPayload: string;
  reportHash: string;
}

function requireText(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " is required.");
}

function validTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(label + " must be a valid timestamp.");
  return parsed;
}

export async function buildCanonicalReportEnvelope(
  input: ReportEnvelopeInput,
): Promise<BuiltReportEnvelope> {
  requireText(input.reportId, "Report ID");
  requireText(input.decision.dealId, "Decision deal ID");
  requireText(input.decision.projectId, "Decision project ID");
  requireText(input.decision.engineVersion, "Engine version");
  requireText(input.auditId, "Audit ID");
  if (!Number.isInteger(input.reportVersion) || input.reportVersion < 1) {
    throw new Error("Report version must be a positive integer.");
  }
  if (!SHA256.test(input.decision.evidenceHash)) throw new Error("Decision evidence hash is invalid.");
  if (!SHA256.test(input.dealTermsHash)) throw new Error("Deal terms hash is invalid.");
  if (!COMMIT_SHA.test(input.expectedCommitSha)) throw new Error("Expected commit SHA is invalid.");
  const issued = validTimestamp(input.issuedAt, "Issued-at");
  const expires = validTimestamp(input.expiresAt, "Expires-at");
  const checked = validTimestamp(input.decision.checkedAt, "Decision checked-at");
  if (issued > checked) throw new Error("Report cannot be issued before the evidence decision was checked.");
  if (expires <= issued) throw new Error("Report expiry must be later than issue time.");
  if (
    !Number.isInteger(input.decision.evidenceCount) || input.decision.evidenceCount < 0 ||
    !Number.isInteger(input.decision.passedMandatoryCount) || input.decision.passedMandatoryCount < 0 ||
    !Number.isInteger(input.decision.requiredTypeCount) || input.decision.requiredTypeCount < 1 ||
    input.decision.passedMandatoryCount > input.decision.evidenceCount
  ) {
    throw new Error("Decision evidence counters are invalid.");
  }
  if (input.buyerId !== null) requireText(input.buyerId, "Buyer ID");
  if (input.sellerId !== null) requireText(input.sellerId, "Seller ID");
  if (input.buyerId && input.sellerId && input.buyerId === input.sellerId) {
    throw new Error("Buyer and seller identities must be distinct.");
  }
  if (input.supersedesReportId === input.reportId) {
    throw new Error("A report cannot supersede itself.");
  }
  if (input.decision.status === "PASS" &&
      input.decision.passedMandatoryCount < input.decision.requiredTypeCount) {
    throw new Error("A PASS decision cannot have fewer passed mandatory records than required evidence categories.");
  }

  const envelope: CanonicalReportEnvelope = {
    protocol: "W3M Protocol V1",
    envelopeVersion: W3M_REPORT_ENVELOPE_VERSION,
    reportId: input.reportId,
    reportVersion: input.reportVersion,
    supersedesReportId: input.supersedesReportId,
    dealId: input.decision.dealId,
    projectId: input.decision.projectId,
    buyerId: input.buyerId,
    sellerId: input.sellerId,
    dealTermsHash: input.dealTermsHash,
    auditId: input.auditId,
    expectedCommitSha: input.expectedCommitSha.toLowerCase(),
    status: input.decision.status,
    engineVersion: input.decision.engineVersion,
    evidenceHash: input.decision.evidenceHash,
    issuedAt: new Date(issued).toISOString(),
    expiresAt: new Date(expires).toISOString(),
    checkedAt: new Date(checked).toISOString(),
    evidenceCount: input.decision.evidenceCount,
    passedMandatoryCount: input.decision.passedMandatoryCount,
    requiredTypeCount: input.decision.requiredTypeCount,
    issues: input.decision.issues,
  };
  const canonicalPayload = canonicalJson(envelope);
  const reportHash = await sha256Hex(canonicalPayload);
  return { envelope, canonicalPayload, reportHash };
}
