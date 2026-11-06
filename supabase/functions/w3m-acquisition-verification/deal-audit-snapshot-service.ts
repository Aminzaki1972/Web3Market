// W3M Protocol V1 — pre-agreement independent Code Audit snapshot orchestration.
// This service intentionally has no acquisition-report dependency: the first
// deal can bind a completed repository audit before any report exists.
import type { AuditManifestSource } from "./audit-manifest-loader.ts";
import { loadAuditManifestSnapshot } from "./audit-manifest-loader.ts";
import {
  assertDealCodeAuditMatchesProjectRepository,
  parseDealCodeAuditBinding,
} from "./deal-code-audit-binding.ts";
import type { DealCodeAuditBinding } from "./deal-code-audit-binding.ts";
import {
  persistDealCodeAuditSnapshot,
  type PersistedDealCodeAuditSnapshot,
} from "./deal-audit-snapshot-persistence.ts";
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " is missing or malformed.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(label + " is required.");
  }
  return value.trim();
}

export interface PreparedDealAuditSnapshot {
  snapshot: PersistedDealCodeAuditSnapshot;
  binding: DealCodeAuditBinding;
}

/**
 * Select the current completed audit for this deal's listed project using a
 * trusted SQL context RPC, recompute Manifest V1 from every trusted source
 * page, verify the repository against projects.github_url, and persist the
 * independent snapshot before the agreement signing flow begins.
 *
 * The context RPC must select an audit by deal/project identity only; it must
 * never accept a browser-supplied audit ID, repository URL, commit or digest.
 */
export async function prepareDealAuditSnapshot(
  client: W3MRpcClient,
  source: AuditManifestSource,
  dealId: string,
  actorId: string,
): Promise<PreparedDealAuditSnapshot> {
  if (!UUID.test(dealId) || !UUID.test(actorId)) {
    throw new Error("Valid deal and authenticated actor UUIDs are required.");
  }

  const { data, error } = await client.rpc("w3m_read_deal_audit_snapshot_context", {
    p_deal_id: dealId,
    p_actor_id: actorId,
  });
  if (error) throw new Error("The trusted Deal Code Audit context could not be loaded.");

  const context = object(data, "Deal Code Audit context");
  const contextDealId = text(context.deal_id, "Context deal ID");
  const projectId = text(context.project_id, "Context project ID");
  const buyerId = text(context.buyer_id, "Deal buyer ID");
  const sellerId = text(context.seller_id, "Deal seller ID");
  const auditId = text(context.audit_id, "Selected audit ID");
  const projectRepositoryUrl = text(context.project_github_url, "Project GitHub URL");
  if (contextDealId !== dealId || !UUID.test(projectId) || !UUID.test(auditId) ||
      !UUID.test(buyerId) || !UUID.test(sellerId) ||
      (actorId !== buyerId && actorId !== sellerId)) {
    throw new Error("The selected audit is not bound to this deal and authenticated buyer or seller.");
  }

  const loaded = await loadAuditManifestSnapshot({ auditId, source });
  const audit = loaded.audit;
  if (audit.project_id !== projectId || audit.id !== auditId) {
    throw new Error("The selected completed audit belongs to another project or audit identity.");
  }

  const repositoryOwner = text(audit.repo_owner, "Audit repository owner");
  const repositoryName = text(audit.repo_name, "Audit repository name");
  const binding = parseDealCodeAuditBinding({
    auditId,
    repositoryOwner,
    repositoryName,
    repositoryUrl: "https://github.com/" + repositoryOwner + "/" + repositoryName,
    commitSha: text(audit.commit_sha, "Audit commit SHA"),
    auditType: text(audit.audit_type, "Audit type"),
    completedAt: text(audit.completed_at, "Audit completion time"),
    auditEvidenceHash: loaded.manifest.digest,
  });
  assertDealCodeAuditMatchesProjectRepository(binding, projectRepositoryUrl);

  const snapshot = await persistDealCodeAuditSnapshot(client, {
    dealId,
    projectId,
    binding,
    manifest: loaded.manifest,
  });
  return { snapshot, binding };
}
