// W3M Protocol V1 — cryptographic persisted-report revalidation immediately before Safe finalization.
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";
import { verifyPersistedW3MReport } from "./persisted-report-guard.ts";

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

export interface W3MAcquisitionFinalizationAttestation {
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
  client: W3MRpcClient,
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
  if (attempt.id !== attemptId || attempt.deal_id !== dealId ||
      attempt.report_id !== reportRow.id ||
      attempt.report_version !== reportRow.report_version ||
      attempt.pinned_report_hash !== reportRow.report_hash ||
      attempt.pinned_evidence_hash !== reportRow.evidence_hash ||
      attempt.pinned_signer_key_id !== reportRow.signer_key_id ||
      attempt.pinned_terms_hash !== currentDealTermsHash) {
    throw new Error("W3M pinned acquisition bundle no longer matches the execution attempt.");
  }
  const termsVersionId = requiredText(attempt.pinned_terms_version_id, "pinned terms version ID");
  const termsVersion = positiveInteger(attempt.pinned_terms_version, "pinned terms version");
  const termsHash = requiredText(attempt.pinned_terms_hash, "pinned terms hash");
  const reportVersion = positiveInteger(reportRow.report_version, "report version");
  const reportHash = requiredText(reportRow.report_hash, "report hash");
  const evidenceHash = requiredText(reportRow.evidence_hash, "evidence hash");
  const signerKeyId = requiredText(reportRow.signer_key_id, "signer key ID");
  if (!Array.isArray(bundle.evidence_rows) || !Array.isArray(bundle.trusted_signer_registry_rows)) {
    throw new Error("W3M persisted evidence or signer rows are malformed.");
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
