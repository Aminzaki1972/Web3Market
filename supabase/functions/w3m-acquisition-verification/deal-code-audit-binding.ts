// W3M Protocol V1 — canonical, immutable Code Audit terms binding.
// This pure boundary converts already-verified CODE_AUDIT evidence into the
// exact compact object that a future DealTermsSnapshot must include before
// computing the buyer/seller EIP-712 agreement hash. It performs no I/O.
import type { AcquisitionEvidence } from "./decision-engine.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA1 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export interface DealCodeAuditBinding {
  auditId: string;
  repositoryOwner: string;
  repositoryName: string;
  repositoryUrl: string;
  commitSha: string;
  auditType: "code" | "smart_contract" | "complete";
  completedAt: string;
  auditEvidenceHash: string;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(label + " is missing.");
  }
  return value.trim();
}

/**
 * Build the immutable Code Audit term only from the output of the strict
 * selector. The caller must separately compare repository identity against
 * the authoritative project listing and must pass the same result into the
 * signed terms object and report-evidence manifest.
 */
export function buildDealCodeAuditBinding(input: {
  evidence: AcquisitionEvidence;
  expectedDealId: string;
  expectedProjectId: string;
}): DealCodeAuditBinding {
  const { evidence } = input;
  if (!UUID.test(input.expectedDealId) || !UUID.test(input.expectedProjectId)) {
    throw new Error("Expected deal and project IDs must be UUIDs.");
  }
  if (evidence.type !== "CODE_AUDIT" || evidence.result !== "PASS" ||
      evidence.mandatory !== true) {
    throw new Error("Only mandatory passing Code Audit evidence can be bound to deal terms.");
  }
  if (evidence.dealId !== input.expectedDealId ||
      evidence.projectId !== input.expectedProjectId) {
    throw new Error("Code Audit evidence is not bound to the exact deal and project.");
  }
  if (!SHA256.test(evidence.contentHash)) {
    throw new Error("Code Audit evidence hash is invalid.");
  }
  const auditId = requiredText(evidence.sourceRecordId, "Audit record ID");
  const commitSha = requiredText(evidence.sourceVersion, "Audit commit SHA").toLowerCase();
  if (!UUID.test(auditId) || !SHA1.test(commitSha)) {
    throw new Error("Code Audit record ID or immutable commit SHA is invalid.");
  }
  const metadata = evidence.metadata || {};
  if (metadata.auditStatus !== "completed") {
    throw new Error("Only a completed Code Audit can be included in signed deal terms.");
  }
  const repositoryOwner = requiredText(metadata.repositoryOwner, "Repository owner");
  const repositoryName = requiredText(metadata.repositoryName, "Repository name");
  if (!GITHUB_OWNER.test(repositoryOwner) || !GITHUB_REPO.test(repositoryName) || repositoryName === "." || repositoryName === "..") {
    throw new Error("GitHub repository identity is malformed.");
  }
  if (String(metadata.commitSha || "").toLowerCase() !== commitSha) {
    throw new Error("Code Audit metadata and evidence commit SHA do not match.");
  }
  const auditType = requiredText(metadata.auditType, "Audit type");
  if (!["code", "smart_contract", "complete"].includes(auditType)) {
    throw new Error("Code Audit scope is unsupported.");
  }
  const completedAt = requiredText(metadata.completedAt, "Audit completion timestamp");
  const completedMs = Date.parse(completedAt);
  const observedMs = Date.parse(evidence.observedAt);
  const validUntilMs = evidence.validUntil === null ? Number.NaN : Date.parse(evidence.validUntil);
  if (!Number.isFinite(completedMs) || !Number.isFinite(observedMs) ||
      !Number.isFinite(validUntilMs) || completedMs > observedMs ||
      observedMs >= validUntilMs) {
    throw new Error("Code Audit completion, observation, or validity timestamps are invalid or out of order.");
  }
  return {
    auditId,
    repositoryOwner,
    repositoryName,
    repositoryUrl: "https://github.com/" + repositoryOwner + "/" + repositoryName,
    commitSha,
    auditType: auditType as DealCodeAuditBinding["auditType"],
    completedAt: new Date(completedMs).toISOString(),
    auditEvidenceHash: evidence.contentHash,
  };
}
