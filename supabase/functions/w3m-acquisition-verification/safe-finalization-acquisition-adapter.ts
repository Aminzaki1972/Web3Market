// W3M Protocol V1 — cryptographic persisted-report revalidation immediately before Safe finalization.
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";
import { verifyPersistedW3MReport } from "./persisted-report-guard.ts";
import type { W3MRegistryReadClient } from "./persisted-report-loader.ts";
import { loadAuditManifest } from "./audit-manifest-loader.ts";
import { createSupabaseAuditManifestSource } from "./audit-manifest-supabase-adapter.ts";

type Row = Record<string, unknown>;
function object(value: unknown, label: string): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("W3M " + label + " bundle is malformed.");
  }
  return value as Row;
}
function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("W3M " + label + " is missing.");
  }
  return value;
}
function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error("W3M " + label + " is invalid.");
  }
  return value as number;
}

export interface W3MAcquisitionFinalizationAttestation extends Record<string, unknown> {
  authorized: true;
  report_id: string;
  report_version: number;
  report_hash: string;
  evidence_hash: string;
  signer_key_id: string;
  terms_version_id: string;
  terms_version: number;
  terms_hash: string;
  signature_valid: true;
  recomputed_evidence_hash: string;
}

export async function verifySafeFinalizationAcquisitionBundle(
  client: W3MRpcClient & W3MRegistryReadClient,
  attemptId: string,
  now = new Date().toISOString(),
): Promise<W3MAcquisitionFinalizationAttestation> {
  requiredText(attemptId, "attempt ID");
  if (!Number.isFinite(Date.parse(now))) throw new Error("W3M finalization time is invalid.");
  const { data, error } = await client.rpc("w3m_read_safe_finalization_acquisition_bundle", {
    p_attempt_id: attemptId,
  });
  if (error) throw new Error("W3M acquisition finalization bundle read failed.");
  const bundle = object(data, "acquisition finalization");
  const attempt = object(bundle.attempt, "attempt");
  const deal = object(bundle.deal, "deal");
  const reportRow = object(bundle.report_row, "report");
  const dealId = requiredText(deal.id, "deal ID");
  const projectId = requiredText(deal.project_id, "project ID");
  const buyerId = requiredText(deal.buyer_id, "buyer ID");
  const sellerId = requiredText(deal.seller_id, "seller ID");
  const currentDealTermsHash = requiredText(bundle.current_deal_terms_hash, "current terms hash");
  const latestReportVersion = positiveInteger(bundle.latest_report_version, "latest report version");
  const reportVersion = positiveInteger(reportRow.report_version, "report version");
  if (reportVersion !== latestReportVersion) {
    throw new Error("W3M pinned acquisition report is no longer the latest report version.");
  }
  const reportDealId = requiredText(reportRow.deal_id, "report deal ID");
  const reportProjectId = requiredText(reportRow.project_id, "report project ID");
  const reportBuyerId = requiredText(reportRow.buyer_id, "report buyer ID");
  const reportSellerId = requiredText(reportRow.seller_id, "report seller ID");
  if (attempt.id !== attemptId || attempt.deal_id !== dealId ||
      attempt.report_id !== reportRow.id ||
      attempt.report_version !== reportVersion ||
      attempt.pinned_report_hash !== reportRow.report_hash ||
      attempt.pinned_evidence_hash !== reportRow.evidence_hash ||
      attempt.pinned_signer_key_id !== reportRow.signer_key_id ||
      attempt.pinned_terms_hash !== currentDealTermsHash) {
    throw new Error("W3M pinned acquisition bundle no longer matches the execution attempt.");
  }
  if (reportDealId !== dealId || reportProjectId !== projectId ||
      reportBuyerId !== buyerId || reportSellerId !== sellerId) {
    throw new Error("W3M pinned acquisition report is not bound to the exact deal, project, buyer, and seller.");
  }
  const termsVersionId = requiredText(attempt.pinned_terms_version_id, "pinned terms version ID");
  const termsVersion = positiveInteger(attempt.pinned_terms_version, "pinned terms version");
  const termsHash = requiredText(attempt.pinned_terms_hash, "pinned terms hash");
  const reportHash = requiredText(reportRow.report_hash, "report hash");
  const evidenceHash = requiredText(reportRow.evidence_hash, "evidence hash");
  const signerKeyId = requiredText(reportRow.signer_key_id, "signer key ID");
  if (!Array.isArray(bundle.evidence_rows) || !Array.isArray(bundle.trusted_signer_registry_rows)) {
    throw new Error("W3M persisted evidence or signer rows are malformed.");
  }

  const mandatoryAuditRows = bundle.evidence_rows
    .filter((value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
      const row = value as Record<string, unknown>;
      return row.evidence_type === "CODE_AUDIT" && row.mandatory === true;
    });
  if (mandatoryAuditRows.length !== 1) {
    throw new Error("Finalization requires exactly one mandatory Code Audit evidence row.");
  }
  const auditEvidence = object(mandatoryAuditRows[0], "Code Audit evidence");
  const auditId = requiredText(auditEvidence.source_record_id, "Code Audit record ID");
  const auditCommit = requiredText(auditEvidence.source_version, "Code Audit commit SHA").toLowerCase();
  const auditHash = requiredText(auditEvidence.evidence_hash, "Code Audit manifest hash").toLowerCase();
  const auditDetails = object(auditEvidence.details, "Code Audit details");
  if (auditEvidence.source_table !== "code_audits" ||
      auditEvidence.result !== "PASS" ||
      typeof auditEvidence.valid_until !== "string" ||
      !Number.isFinite(Date.parse(auditEvidence.valid_until)) ||
      Date.parse(auditEvidence.valid_until) <= Date.parse(now) ||
      typeof auditEvidence.observed_at !== "string" ||
      !Number.isFinite(Date.parse(auditEvidence.observed_at)) ||
      Date.parse(auditEvidence.observed_at) > Date.parse(now) ||
      auditDetails.auditManifestVersion !== "w3m-audit-manifest-v1" ||
      auditDetails.auditManifestHash !== auditHash ||
      auditDetails.commitSha !== auditCommit) {
    throw new Error("Persisted Code Audit evidence is stale or malformed.");
  }
  const manifest = await loadAuditManifest({
    auditId,
    source: createSupabaseAuditManifestSource(client),
    pageSize: 500,
  });
  if (manifest.auditId !== auditId || manifest.digest !== auditHash ||
      manifest.version !== auditDetails.auditManifestVersion ||
      manifest.fileCount !== auditDetails.auditFileCount ||
      manifest.findingCount !== auditDetails.auditFindingCount) {
    throw new Error("Current Code Audit source rows no longer match the signed manifest at finalization.");
  }

  const result = await verifyPersistedW3MReport({
    expectedDealId: dealId,
    expectedProjectId: projectId,
    expectedBuyerId: buyerId,
    expectedSellerId: sellerId,
    currentDealTermsHash,
    latestReportVersion,
    now,
    reportRow,
    evidenceRows: bundle.evidence_rows,
    trustedSignerRegistryRows: bundle.trusted_signer_registry_rows,
  });
  if (!result.authorized || !result.signatureValid ||
      result.recomputedEvidenceHash !== evidenceHash ||
      result.report?.reportHash !== reportHash ||
      result.report?.signerKeyId !== signerKeyId ||
      result.reportDealTermsHash !== termsHash) {
    throw new Error("W3M persisted acquisition report failed cryptographic or evidence revalidation.");
  }

  return {
    authorized: true,
    report_id: reportRow.id as string,
    report_version: reportVersion,
    report_hash: reportHash,
    evidence_hash: evidenceHash,
    signer_key_id: signerKeyId,
    terms_version_id: termsVersionId,
    terms_version: termsVersion,
    terms_hash: termsHash,
    signature_valid: true,
    recomputed_evidence_hash: result.recomputedEvidenceHash,
  };
}
