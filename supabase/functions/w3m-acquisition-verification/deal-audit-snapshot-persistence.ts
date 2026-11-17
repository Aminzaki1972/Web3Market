// W3M Protocol V1 — server-only persistence boundary for an independent
// pre-agreement Deal Code Audit snapshot. The manifest must be recomputed from
// complete trusted database pages before this function is called.
import type { AuditManifest } from "./audit-manifest.ts";
import { parseDealCodeAuditBinding, type DealCodeAuditBinding } from "./deal-code-audit-binding.ts";
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

export interface PersistedDealCodeAuditSnapshot {
  id: string;
  dealId: string;
  projectId: string;
  snapshotVersion: string;
  binding: DealCodeAuditBinding;
  manifestVersion: string;
  manifestHash: string;
  fileCount: number;
  findingCount: number;
  idempotentReplay: boolean;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " RPC returned a malformed response.");
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(label + " is required.");
  }
  return value.trim();
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(label + " must be a non-negative safe integer.");
  }
  return value;
}

/**
 * Persist a server-computed Audit Manifest before any party signs deal terms.
 * The RPC receives only the deal/audit identity and computed manifest facts;
 * repository, commit, timestamps, and project identity are re-derived from
 * trusted database rows by the RPC. Browser code must never call this boundary.
 */
export async function persistDealCodeAuditSnapshot(
  client: W3MRpcClient,
  input: {
    dealId: string;
    projectId: string;
    binding: DealCodeAuditBinding;
    manifest: AuditManifest;
  },
): Promise<PersistedDealCodeAuditSnapshot> {
  if (!UUID.test(input.dealId) || !UUID.test(input.projectId)) {
    throw new Error("Deal and project IDs must be valid UUIDs.");
  }
  const binding = parseDealCodeAuditBinding(input.binding);
  if (input.manifest.version !== "w3m-audit-manifest-v1" ||
      input.manifest.auditId !== binding.auditId ||
      !SHA256.test(input.manifest.digest) ||
      binding.auditEvidenceHash !== input.manifest.digest ||
      input.manifest.fileCount <= 0 ||
      !Number.isSafeInteger(input.manifest.fileCount) ||
      input.manifest.findingCount < 0 ||
      !Number.isSafeInteger(input.manifest.findingCount)) {
    throw new Error("The computed Audit Manifest does not match the selected Code Audit binding.");
  }

  const { data, error } = await client.rpc("w3m_create_deal_code_audit_snapshot", {
    p_deal_id: input.dealId,
    p_audit_id: binding.auditId,
    p_manifest_version: input.manifest.version,
    p_manifest_hash: input.manifest.digest,
    p_file_count: input.manifest.fileCount,
    p_finding_count: input.manifest.findingCount,
  });
  if (error) throw new Error("Independent Deal Code Audit snapshot could not be persisted.");

  const result = object(data, "Deal Code Audit snapshot");
  const snapshotId = requiredText(result.id, "Snapshot ID");
  const dealId = requiredText(result.deal_id, "Snapshot deal ID");
  const projectId = requiredText(result.project_id, "Snapshot project ID");
  const snapshotVersion = String(result.snapshot_version ?? "");
  const manifestVersion = requiredText(result.manifest_version, "Snapshot manifest version");
  const manifestHash = requiredText(result.manifest_hash, "Snapshot manifest hash").toLowerCase();
  const fileCount = nonNegativeInteger(result.file_count, "Snapshot file count");
  const findingCount = nonNegativeInteger(result.finding_count, "Snapshot finding count");

  if (!UUID.test(snapshotId) || !/^[1-9][0-9]*$/.test(snapshotVersion) ||
      dealId !== input.dealId || projectId !== input.projectId ||
      requiredText(result.audit_id, "Snapshot audit ID") !== binding.auditId ||
      manifestVersion !== input.manifest.version ||
      manifestHash !== input.manifest.digest ||
      fileCount !== input.manifest.fileCount ||
      findingCount !== input.manifest.findingCount ||
      typeof result.idempotent_replay !== "boolean") {
    throw new Error("Persisted Deal Code Audit snapshot does not match the verified source manifest.");
  }

  const returnedBinding: DealCodeAuditBinding = {
    auditId: requiredText(result.audit_id, "Snapshot audit ID"),
    repositoryOwner: requiredText(result.repository_owner, "Snapshot repository owner"),
    repositoryName: requiredText(result.repository_name, "Snapshot repository name"),
    repositoryUrl: requiredText(result.repository_url, "Snapshot repository URL"),
    commitSha: requiredText(result.commit_sha, "Snapshot commit SHA").toLowerCase(),
    auditType: requiredText(result.audit_type, "Snapshot audit type") as DealCodeAuditBinding["auditType"],
    completedAt: requiredText(result.completed_at, "Snapshot completion time"),
    auditEvidenceHash: manifestHash,
  };
  const returnedCompletedAt = Date.parse(returnedBinding.completedAt);
  const expectedCompletedAt = Date.parse(binding.completedAt);
  if (!Number.isFinite(returnedCompletedAt) ||
      returnedCompletedAt !== expectedCompletedAt ||
      returnedBinding.auditId !== binding.auditId ||
      returnedBinding.repositoryOwner !== binding.repositoryOwner ||
      returnedBinding.repositoryName !== binding.repositoryName ||
      returnedBinding.repositoryUrl !== binding.repositoryUrl ||
      returnedBinding.commitSha !== binding.commitSha.toLowerCase() ||
      returnedBinding.auditType !== binding.auditType ||
      returnedBinding.auditEvidenceHash !== binding.auditEvidenceHash.toLowerCase()) {
    throw new Error("Persisted snapshot repository or commit identity differs from the verified audit.");
  }

  return {
    id: snapshotId,
    dealId,
    projectId,
    snapshotVersion,
    binding: returnedBinding,
    manifestVersion,
    manifestHash,
    fileCount,
    findingCount,
    idempotentReplay: result.idempotent_replay,
  };
}
