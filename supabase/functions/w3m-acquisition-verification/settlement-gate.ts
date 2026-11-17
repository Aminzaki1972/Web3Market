// W3M Protocol V1 — deterministic settlement gate.
// Pure logic only. Inputs must be assembled by a trusted server-side adapter;
// never pass browser-supplied verification booleans into this function.

export type SettlementStage = "PREPARE" | "EXECUTE";
export type SignerState = "ACTIVE" | "REVOKED" | "UNKNOWN";

export interface SettlementReportSnapshot {
  id: string;
  dealId: string;
  projectId: string;
  status: string;
  reportVersion: number;
  issuedAt: string;
  expiresAt: string;
  evidenceHash: string;
  reportHash: string;
  signerKeyId: string | null;
  signature: string | null;
}

export interface SettlementGateInput {
  stage: SettlementStage;
  dealId: string;
  projectId: string;
  now: string;
  report: SettlementReportSnapshot | null;
  latestReportVersion: number | null;
  isSuperseded: boolean;
  signatureValid: boolean;
  signerState: SignerState;
  recomputedEvidenceHash: string | null;
  currentDealTermsHash: string;
  reportDealTermsHash: string;
  paymentConfirmed: boolean;
  deliveryAccepted: boolean;
  disputeOpen: boolean;
  safeConfigurationMatches: boolean;
  releaseAlreadyFinalized: boolean;
}

export interface SettlementGateIssue {
  code: string;
  message: string;
}

export interface SettlementGateDecision {
  authorized: boolean;
  stage: SettlementStage;
  dealId: string;
  reportId: string | null;
  reportVersion: number | null;
  checkedAt: string;
  issues: SettlementGateIssue[];
}

const SHA256 = /^[0-9a-f]{64}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

function timestamp(value: string): number | null {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function add(
  issues: SettlementGateIssue[],
  code: string,
  message: string,
): void {
  issues.push({ code, message });
}

export function evaluateSettlementGate(
  input: SettlementGateInput,
): SettlementGateDecision {
  const issues: SettlementGateIssue[] = [];
  const report = input.report;
  const now = timestamp(input.now);

  if (!input.dealId.trim() || !input.projectId.trim()) {
    add(issues, "DEAL_CONTEXT_MISSING", "Deal and project identifiers are required.");
  }
  if (now === null) {
    add(issues, "GATE_CLOCK_INVALID", "The gate evaluation timestamp is invalid.");
  }
  if (!report) {
    add(issues, "REPORT_MISSING", "No acquisition verification report exists for this deal.");
  } else {
    if (!report.id.trim()) add(issues, "REPORT_ID_MISSING", "The report ID is missing.");
    if (report.dealId !== input.dealId || report.projectId !== input.projectId) {
      add(issues, "REPORT_BINDING_MISMATCH", "The report is not bound to this exact deal and project.");
    }
    if (report.status !== "PASS") {
      add(issues, "REPORT_NOT_PASS", "Only a PASS report may authorize settlement.");
    }
    if (
      !Number.isInteger(report.reportVersion) ||
      report.reportVersion < 1 ||
      input.latestReportVersion === null ||
      report.reportVersion !== input.latestReportVersion
    ) {
      add(issues, "REPORT_NOT_LATEST", "The report is not the latest valid report version.");
    }
    if (input.isSuperseded) {
      add(issues, "REPORT_SUPERSEDED", "The report has been superseded.");
    }
    const issuedAt = timestamp(report.issuedAt);
    const expiresAt = timestamp(report.expiresAt);
    if (
      now === null ||
      issuedAt === null ||
      expiresAt === null ||
      issuedAt > now ||
      expiresAt <= now ||
      expiresAt <= issuedAt
    ) {
      add(issues, "REPORT_EXPIRED_OR_TIME_INVALID", "The report is expired or has an invalid validity window.");
    }
    if (!SHA256.test(report.evidenceHash) || !SHA256.test(report.reportHash)) {
      add(issues, "REPORT_HASH_INVALID", "The report or evidence hash is not a valid SHA-256 digest.");
    }
    if (!report.signerKeyId || !report.signature || !SIGNATURE.test(report.signature)) {
      add(issues, "REPORT_SIGNATURE_MISSING", "A signed report and signer key ID are required.");
    }
    if (!input.signatureValid) {
      add(issues, "REPORT_SIGNATURE_INVALID", "The report signature has not been cryptographically verified.");
    }
    if (input.signerState !== "ACTIVE") {
      add(issues, "SIGNER_NOT_ACTIVE", "The report signer is unknown or revoked.");
    }
    if (
      !input.recomputedEvidenceHash ||
      !SHA256.test(input.recomputedEvidenceHash) ||
      input.recomputedEvidenceHash !== report.evidenceHash
    ) {
      add(issues, "EVIDENCE_HASH_MISMATCH", "The stored evidence manifest does not match the signed report.");
    }
  }

  if (
    !SHA256.test(input.currentDealTermsHash || "") ||
    !SHA256.test(input.reportDealTermsHash || "") ||
    input.currentDealTermsHash !== input.reportDealTermsHash
  ) {
    add(issues, "DEAL_TERMS_CHANGED", "The current deal terms do not match the terms covered by the report.");
  }
  if (!input.paymentConfirmed) {
    add(issues, "PAYMENT_NOT_CONFIRMED", "Trusted payment verification is not confirmed.");
  }
  if (!input.deliveryAccepted) {
    add(issues, "DELIVERY_NOT_ACCEPTED", "Buyer acceptance of delivery is missing.");
  }
  if (input.disputeOpen) {
    add(issues, "OPEN_DISPUTE", "An open dispute blocks settlement.");
  }
  if (!input.safeConfigurationMatches) {
    add(issues, "SAFE_CONFIGURATION_MISMATCH", "Safe address, chain, owners, threshold, or transaction policy does not match.");
  }
  if (input.releaseAlreadyFinalized) {
    add(issues, "RELEASE_ALREADY_FINALIZED", "The release has already been finalized.");
  }

  return {
    authorized: issues.length === 0,
    stage: input.stage,
    dealId: input.dealId,
    reportId: report?.id || null,
    reportVersion: report?.reportVersion ?? null,
    checkedAt: input.now,
    issues,
  };
}
