// W3M Protocol V1 — server-side persisted report verification.
// Rebuilds the evidence manifest from registry rows and cryptographically
// verifies the canonical report signature before a settlement gate may use it.
// This module is pure: callers must load every row from the service-role-only
// registry and provide the authoritative current deal-terms hash.

import {
  canonicalJson,
  evaluateAcquisition,
  sha256Hex,
  type AcquisitionEvidence,
  type EvidenceType,
} from "./decision-engine.ts";
import {
  verifyTrustedReportSignature,
  type EthereumDigestRecoveryVerifier,
  type TrustedSignerKey,
} from "./signature-verifier.ts";
import { verifyEthereumRawDigestSignature } from "./ethereum-signature-adapter.ts";
import { mapTrustedSignerRegistryRows } from "./trusted-signer-registry-adapter.ts";
import type { SettlementReportSnapshot, SignerState } from "./settlement-gate.ts";

const SHA256 = /^[0-9a-f]{64}$/i;
const EVIDENCE_TYPES = new Set<string>([
  "PROJECT_IDENTITY", "CODE_AUDIT", "OWNERSHIP_CONTROL", "ASSET_TRANSFER",
  "DEAL_AGREEMENT", "PAYMENT", "BUYER_ACCEPTANCE", "DISPUTE_CHECK",
  "REVENUE_VERIFICATION",
]);
const EVIDENCE_RESULTS = new Set<string>(["PASS", "MISSING", "FAILED", "STALE", "REVIEW_REQUIRED"]);

export interface PersistedReportGuardInput {
  expectedDealId: string;
  expectedProjectId: string;
  expectedBuyerId: string;
  expectedSellerId: string;
  currentDealTermsHash: string;
  latestReportVersion: number | null;
  now: string;
  reportRow: unknown;
  evidenceRows: unknown;
  trustedSignerRegistryRows: unknown;
}

export interface PersistedReportGuardResult {
  authorized: boolean;
  issues: string[];
  report: SettlementReportSnapshot | null;
  latestReportVersion: number | null;
  isSuperseded: boolean;
  signatureValid: boolean;
  signerState: SignerState;
  recomputedEvidenceHash: string | null;
  reportDealTermsHash: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function invalid(issues: string[], code: string): void {
  if (!issues.includes(code)) issues.push(code);
}

function signerState(keys: readonly TrustedSignerKey[], keyId: string | null): SignerState {
  if (!keyId) return "UNKNOWN";
  const matching = keys.filter((key) => key.keyId === keyId);
  if (matching.length !== 1) return "UNKNOWN";
  return matching[0].status === "ACTIVE" && matching[0].revokedAt === null ? "ACTIVE" : "REVOKED";
}

export async function verifyPersistedW3MReport(
  input: PersistedReportGuardInput,
  recoverAndVerify: EthereumDigestRecoveryVerifier = verifyEthereumRawDigestSignature,
): Promise<PersistedReportGuardResult> {
  const issues: string[] = [];
  let reportSnapshot: SettlementReportSnapshot | null = null;
  let signatureValid = false;
  let recomputedEvidenceHash: string | null = null;
  let signerKeys: TrustedSignerKey[] = [];
  let signerStatus: SignerState = "UNKNOWN";
  let reportDealTermsHash = "";

  const report = input.reportRow;
  if (!isRecord(report)) {
    invalid(issues, "REPORT_ROW_INVALID");
  } else {
    const payload = report.report_payload;
    if (!isRecord(payload)) invalid(issues, "REPORT_PAYLOAD_INVALID");

    const reportId = report.id;
    const dealId = report.deal_id;
    const projectId = report.project_id;
    const buyerId = report.buyer_id;
    const sellerId = report.seller_id;
    const status = report.status;
    const engineVersion = report.engine_version;
    const version = report.report_version;
    const issuedAt = report.issued_at;
    const expiresAt = report.expires_at;
    const evidenceHash = report.evidence_hash;
    const reportHash = report.report_hash;
    const signerKeyId = report.signer_key_id;
    const signature = report.report_signature;

    if (!text(reportId) || !text(dealId) || !text(projectId) ||
        !nullableText(buyerId) || !nullableText(sellerId) ||
        !text(status) || !text(engineVersion) || !Number.isInteger(version) || !text(issuedAt) ||
        !text(expiresAt) || !text(evidenceHash) || !text(reportHash) ||
        !nullableText(signerKeyId) || !nullableText(signature)) {
      invalid(issues, "REPORT_ROW_FIELDS_INVALID");
    } else {
      reportSnapshot = {
        id: reportId,
        dealId,
        projectId,
        status,
        reportVersion: version as number,
        issuedAt,
        expiresAt,
        evidenceHash,
        reportHash,
        signerKeyId,
        signature,
      };
      if (dealId !== input.expectedDealId || projectId !== input.expectedProjectId ||
          buyerId !== input.expectedBuyerId || sellerId !== input.expectedSellerId) {
        invalid(issues, "REPORT_PARTY_BINDING_MISMATCH");
      }
      if (status !== "PASS") invalid(issues, "REPORT_NOT_PASS");
      const nowMs = Date.parse(input.now);
      const issuedMs = Date.parse(issuedAt);
      const expiresMs = Date.parse(expiresAt);
      if (!Number.isFinite(nowMs) || !Number.isFinite(issuedMs) || !Number.isFinite(expiresMs) ||
          issuedMs > nowMs || expiresMs <= nowMs || expiresMs <= issuedMs) {
        invalid(issues, "REPORT_EXPIRED_OR_TIME_INVALID");
      }
      if (input.latestReportVersion === null ||
          version !== input.latestReportVersion) {
        invalid(issues, "REPORT_NOT_LATEST");
      }
      if (!SHA256.test(evidenceHash) || !SHA256.test(reportHash)) {
        invalid(issues, "REPORT_HASH_FORMAT_INVALID");
      }
    }

    if (isRecord(payload)) {
      reportDealTermsHash = typeof payload.dealTermsHash === "string" ? payload.dealTermsHash : "";
      if (payload.reportId !== reportId ||
          payload.dealId !== dealId ||
          payload.projectId !== projectId ||
          payload.buyerId !== buyerId ||
          payload.sellerId !== sellerId ||
          payload.reportVersion !== version ||
          payload.status !== status ||
          payload.engineVersion !== engineVersion ||
          payload.issuedAt !== issuedAt ||
          payload.expiresAt !== expiresAt ||
          payload.evidenceHash !== evidenceHash ||
          payload.protocol !== "W3M Protocol V1") {
        invalid(issues, "REPORT_PAYLOAD_BINDING_MISMATCH");
      }
      if (!SHA256.test(reportDealTermsHash) ||
          reportDealTermsHash !== input.currentDealTermsHash) {
        invalid(issues, "DEAL_TERMS_HASH_MISMATCH");
      }
      if (SHA256.test(String(reportHash || ""))) {
        const recomputedReportHash = await sha256Hex(canonicalJson(payload));
        if (recomputedReportHash !== String(reportHash).toLowerCase()) {
          invalid(issues, "CANONICAL_REPORT_HASH_MISMATCH");
        }
      }
    }

    if (!Array.isArray(input.evidenceRows)) {
      invalid(issues, "EVIDENCE_ROWS_INVALID");
    } else if (isRecord(payload)) {
      const mapped: AcquisitionEvidence[] = [];
      const seen = new Set<string>();
      for (const [index, raw] of input.evidenceRows.entries()) {
        if (!isRecord(raw) || raw.report_id !== reportId ||
            !text(raw.id) || !text(raw.evidence_type) ||
            !text(raw.result) || typeof raw.mandatory !== "boolean" ||
            !text(raw.evidence_hash) || !text(raw.observed_at) ||
            !(raw.valid_until === null || text(raw.valid_until)) ||
            !nullableText(raw.source_record_id) ||
            !nullableText(raw.source_version) ||
            !isRecord(raw.details)) {
          invalid(issues, "EVIDENCE_ROW_INVALID_" + index);
          continue;
        }
        const details = raw.details;
        const sourceEvidenceId = details.evidenceId;
        if (!text(sourceEvidenceId) || seen.has(sourceEvidenceId) ||
            !EVIDENCE_TYPES.has(raw.evidence_type) ||
            !EVIDENCE_RESULTS.has(raw.result) ||
            !SHA256.test(raw.evidence_hash)) {
          invalid(issues, "EVIDENCE_ID_OR_TYPE_INVALID_" + index);
          continue;
        }
        seen.add(sourceEvidenceId);
        const metadata = { ...details };
        delete metadata.evidenceId;
        mapped.push({
          id: sourceEvidenceId,
          type: raw.evidence_type as EvidenceType,
          result: raw.result as AcquisitionEvidence["result"],
          mandatory: raw.mandatory,
          dealId: String(dealId),
          projectId: String(projectId),
          contentHash: raw.evidence_hash,
          observedAt: raw.observed_at,
          validUntil: raw.valid_until as string | null,
          sourceRecordId: raw.source_record_id,
          sourceVersion: raw.source_version,
          metadata,
        });
      }

      if (mapped.length !== input.evidenceRows.length ||
          (typeof payload.evidenceCount === "number" && mapped.length !== payload.evidenceCount)) {
        invalid(issues, "EVIDENCE_COUNT_MISMATCH");
      }

      if (mapped.length === input.evidenceRows.length &&
          typeof payload.expectedCommitSha === "string") {
        const decision = await evaluateAcquisition({
          dealId: String(dealId),
          projectId: String(projectId),
          expectedCommitSha: payload.expectedCommitSha,
          evidence: mapped,
          now: input.now,
        });
        recomputedEvidenceHash = decision.evidenceHash;
        if (decision.status !== "PASS" ||
            decision.evidenceHash !== evidenceHash ||
            decision.evidenceHash !== payload.evidenceHash ||
            decision.evidenceCount !== payload.evidenceCount ||
            decision.passedMandatoryCount !== payload.passedMandatoryCount ||
            decision.requiredTypeCount !== payload.requiredTypeCount) {
          invalid(issues, "EVIDENCE_MANIFEST_RECOMPUTE_FAILED");
        }
        const codeAudit = mapped.filter((item) => item.type === "CODE_AUDIT");
        if (codeAudit.length !== 1 ||
            codeAudit[0].sourceRecordId !== payload.auditId ||
            codeAudit[0].sourceVersion?.toLowerCase() !== String(payload.expectedCommitSha).toLowerCase()) {
          invalid(issues, "CODE_AUDIT_REPORT_BINDING_MISMATCH");
        }
      }
    }
  }

  const registry = mapTrustedSignerRegistryRows(input.trustedSignerRegistryRows);
  if (!registry.ok) {
    invalid(issues, "TRUSTED_SIGNER_REGISTRY_INVALID");
  } else {
    signerKeys = registry.keys;
    signerStatus = signerState(signerKeys, reportSnapshot?.signerKeyId ?? null);
  }

  if (reportSnapshot && registry.ok &&
      !issues.includes("CANONICAL_REPORT_HASH_MISMATCH") &&
      !issues.includes("REPORT_PAYLOAD_BINDING_MISMATCH") &&
      reportSnapshot.signature && reportSnapshot.signerKeyId) {
    const verification = await verifyTrustedReportSignature({
      digestHex: reportSnapshot.reportHash,
      signature: reportSnapshot.signature,
      signerKeyId: reportSnapshot.signerKeyId,
      checkedAt: input.now,
      purpose: "SETTLEMENT",
    }, signerKeys, recoverAndVerify);
    signatureValid = verification.valid;
    if (!signatureValid) invalid(issues, "REPORT_SIGNATURE_INVALID");
  }

  if (!text(input.expectedDealId) || !text(input.expectedProjectId) ||
      !text(input.expectedBuyerId) || !text(input.expectedSellerId) ||
      !SHA256.test(input.currentDealTermsHash) ||
      !Number.isFinite(Date.parse(input.now))) {
    invalid(issues, "REPORT_GUARD_CONTEXT_INVALID");
  }

  return {
    authorized: issues.length === 0 && signatureValid && signerStatus === "ACTIVE",
    issues,
    report: reportSnapshot,
    latestReportVersion: input.latestReportVersion,
    isSuperseded: reportSnapshot !== null &&
      input.latestReportVersion !== null &&
      reportSnapshot.reportVersion < input.latestReportVersion,
    signatureValid,
    signerState: signerStatus,
    recomputedEvidenceHash,
    reportDealTermsHash,
  };
}
