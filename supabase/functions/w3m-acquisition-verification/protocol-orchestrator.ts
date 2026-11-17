// W3M Protocol V1 — pure end-to-end acquisition report orchestrator.
// Composes trusted provider evidence, deterministic decision, canonical report,
// and signed registry batch. It does not access Supabase, persist rows, authorize
// settlement, call Safe, or execute any blockchain transaction.

import {
  aggregateAcquisitionEvidence,
  type UnifiedEvidenceInput,
  type UnifiedEvidenceResult,
} from "./unified-evidence-aggregator.ts";
import {
  buildSignedRegistryBatch,
  type RegistryBatch,
  type RegistrySigner,
} from "./report-registry-batch.ts";
import { mapTrustedSignerRegistryRows } from "./trusted-signer-registry-adapter.ts";
import { verifyTrustedEthereumReportSignature } from "./signature-verifier.ts";
import {
  selectCodeAuditEvidence,
  type CodeAuditSourceRow,
} from "./code-audit-evidence-selector.ts";
import type { AuditManifest } from "./audit-manifest.ts";

export const W3M_PROTOCOL_ORCHESTRATOR_VERSION = "w3m-protocol-orchestrator-1.0.0";

export interface ProtocolOrchestratorInput {
  acquisition: UnifiedEvidenceInput;
  reportId: string;
  evidenceRowIds: string[];
  eventRowIds: string[];
  reportVersion: number;
  supersedesReportId?: string | null;
  dealTermsHash: string;
  auditId: string;
  /** Trusted server-loaded audit row plus a freshly recomputed complete manifest. */
  codeAudit: {
    row: CodeAuditSourceRow;
    manifest: AuditManifest;
    repositoryOwner: string;
    repositoryName: string;
    maxAgeMs: number;
  };
  issuedAt: string;
  expiresAt: string;
  actorType: "SYSTEM" | "VERIFIER";
  actorRef?: string | null;
  /** Raw rows from the service-role-only w3m_trusted_signer_key_status view. */
  trustedSignerRegistryRows: unknown;
}

export interface ProtocolOrchestratorResult {
  orchestratorVersion: string;
  aggregation: UnifiedEvidenceResult;
  registryBatch: RegistryBatch;
  persistenceRequired: true;
  settlementAuthorized: false;
  executionEnabled: false;
}

export async function prepareAcquisitionProtocolBatch(
  input: ProtocolOrchestratorInput,
  signDigest: (digestHex: string) => Promise<RegistrySigner>,
): Promise<ProtocolOrchestratorResult> {
  if (input.acquisition.baseEvidence.some((item) => item.type === "CODE_AUDIT")) {
    throw new Error("Code Audit evidence must be produced by the trusted manifest selector, not caller-supplied base evidence.");
  }
  const selectedAudit = await selectCodeAuditEvidence(input.codeAudit.row, {
    dealId: input.acquisition.dealId,
    projectId: input.acquisition.projectId,
    repositoryOwner: input.codeAudit.repositoryOwner,
    repositoryName: input.codeAudit.repositoryName,
    commitSha: input.acquisition.expectedCommitSha,
    now: input.acquisition.now,
    maxAgeMs: input.codeAudit.maxAgeMs,
    manifest: input.codeAudit.manifest,
  });
  if (selectedAudit.result !== "PASS" || selectedAudit.evidence.sourceRecordId !== input.auditId) {
    throw new Error("Current Code Audit selection failed: " +
      (selectedAudit.result === "PASS" ? "Audit ID does not match the report request." : selectedAudit.reason));
  }
  const aggregation = await aggregateAcquisitionEvidence({
    ...input.acquisition,
    baseEvidence: [...input.acquisition.baseEvidence, selectedAudit.evidence],
  });

  if (aggregation.decision.dealId !== input.acquisition.dealId ||
      aggregation.decision.projectId !== input.acquisition.projectId) {
    throw new Error("Aggregated decision is not bound to the requested deal and project.");
  }

  const auditEvidence = aggregation.evidence.filter((item) => item.type === "CODE_AUDIT");
  const auditMetadata = auditEvidence.length === 1 ? auditEvidence[0].metadata || {} : {};
  if (auditEvidence.length !== 1 ||
      auditEvidence[0].sourceRecordId !== input.auditId ||
      auditEvidence[0].sourceVersion?.toLowerCase() !== input.acquisition.expectedCommitSha.toLowerCase() ||
      auditMetadata.auditManifestVersion !== "w3m-audit-manifest-v1" ||
      auditMetadata.auditManifestHash !== auditEvidence[0].contentHash ||
      !Number.isSafeInteger(auditMetadata.auditFileCount) || Number(auditMetadata.auditFileCount) <= 0 ||
      !Number.isSafeInteger(auditMetadata.auditFindingCount) || Number(auditMetadata.auditFindingCount) < 0) {
    throw new Error("Exactly one Code Audit evidence record must match the report audit ID and exact commit SHA.");
  }

  const registryBatch = await buildSignedRegistryBatch({
    reportId: input.reportId,
    evidenceRowIds: input.evidenceRowIds,
    eventRowIds: input.eventRowIds,
    decision: aggregation.decision,
    evidence: aggregation.evidence,
    reportVersion: input.reportVersion,
    supersedesReportId: input.supersedesReportId ?? null,
    buyerId: input.acquisition.buyerIdentity,
    sellerId: input.acquisition.sellerIdentity,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    dealTermsHash: input.dealTermsHash,
    auditId: input.auditId,
    expectedCommitSha: input.acquisition.expectedCommitSha,
    actorType: input.actorType,
    actorRef: input.actorRef ?? null,
  }, signDigest);

  const signerRegistry = mapTrustedSignerRegistryRows(input.trustedSignerRegistryRows);
  if (!signerRegistry.ok) {
    throw new Error("Trusted signer registry is invalid: " + signerRegistry.reason);
  }

  const signatureCheck = await verifyTrustedEthereumReportSignature({
    digestHex: registryBatch.digestToSign,
    signature: registryBatch.report.report_signature,
    signerKeyId: registryBatch.report.signer_key_id,
    checkedAt: input.issuedAt,
    purpose: "SETTLEMENT",
  }, signerRegistry.keys);
  if (!signatureCheck.valid) {
    throw new Error("Trusted report signature verification failed: " + signatureCheck.code);
  }

  return {
    orchestratorVersion: W3M_PROTOCOL_ORCHESTRATOR_VERSION,
    aggregation,
    registryBatch,
    persistenceRequired: true,
    settlementAuthorized: false,
    executionEnabled: false,
  };
}
