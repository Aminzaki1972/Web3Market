import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { persistDealCodeAuditSnapshot } from "./deal-audit-snapshot-persistence.ts";
import type { AuditManifest } from "./audit-manifest.ts";
import type { DealCodeAuditBinding } from "./deal-code-audit-binding.ts";
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";

const dealId = "71000000-0000-4000-8000-000000000001";
const projectId = "72000000-0000-4000-8000-000000000002";
const auditId = "73000000-0000-4000-8000-000000000003";
const binding: DealCodeAuditBinding = {
  auditId, repositoryOwner: "owner", repositoryName: "repo",
  repositoryUrl: "https://github.com/owner/repo", commitSha: "a".repeat(40),
  auditType: "code", completedAt: "2026-11-07T10:00:00.000Z",
  auditEvidenceHash: "b".repeat(64),
};
const manifest: AuditManifest = {
  version: "w3m-audit-manifest-v1", auditId, fileCount: 4, findingCount: 2,
  digest: "b".repeat(64),
};
const response = {
  id: "74000000-0000-4000-8000-000000000004",
  deal_id: dealId, project_id: projectId, snapshot_version: 1, audit_id: auditId,
  repository_owner: "owner", repository_name: "repo",
  repository_url: "https://github.com/owner/repo", commit_sha: "a".repeat(40),
  audit_type: "code", completed_at: "2026-11-07T10:00:00.000Z",
  manifest_version: "w3m-audit-manifest-v1", manifest_hash: "b".repeat(64),
  file_count: 4, finding_count: 2, idempotent_replay: false,
};
function client(data: unknown = response, error: unknown = null, calls: unknown[] = []): W3MRpcClient {
  return { async rpc(name, args) {
    (calls as unknown[]).push({name,args});
    return {data,error};
  }};
}

Deno.test("persists only the server-computed manifest facts and validates the exact returned snapshot", async () => {
  const calls: unknown[] = [];
  const saved = await persistDealCodeAuditSnapshot(client(response, null, calls), {
    dealId, projectId, binding, manifest,
  });
  assertEquals(saved.dealId, dealId);
  assertEquals(saved.projectId, projectId);
  assertEquals(saved.binding.commitSha, binding.commitSha);
  assertEquals(saved.manifestHash, manifest.digest);
  assertEquals(calls.length, 1);
  assertEquals(calls[0], {name:"w3m_create_deal_code_audit_snapshot",args:{
    p_deal_id:dealId, p_audit_id:auditId, p_manifest_version:manifest.version,
    p_manifest_hash:manifest.digest, p_file_count:4, p_finding_count:2,
  }});
});

Deno.test("rejects a manifest that does not match the selected audit binding before any RPC", async () => {
  const calls: unknown[] = [];
  await assertRejects(() => persistDealCodeAuditSnapshot(client(response, null, calls), {
    dealId, projectId, binding:{...binding,auditEvidenceHash:"c".repeat(64)}, manifest,
  }));
  assertEquals(calls.length, 0);
});

Deno.test("rejects a persisted snapshot for another project, deal, audit, or digest", async () => {
  for (const changed of [
    {...response, deal_id:"75000000-0000-4000-8000-000000000005"},
    {...response, project_id:"75000000-0000-4000-8000-000000000005"},
    {...response, audit_id:"75000000-0000-4000-8000-000000000005"},
    {...response, manifest_hash:"c".repeat(64)},
    {...response, file_count:5},
    {...response, repository_url:"https://github.com/other/repo"},
  ]) {
    await assertRejects(() => persistDealCodeAuditSnapshot(client(changed), {
      dealId, projectId, binding, manifest,
    }));
  }
});

Deno.test("fails closed when the snapshot RPC reports an error or malformed response", async () => {
  await assertRejects(() => persistDealCodeAuditSnapshot(client(null, new Error("db")), {
    dealId, projectId, binding, manifest,
  }));
  await assertRejects(() => persistDealCodeAuditSnapshot(client({id:"not-a-uuid"}), {
    dealId, projectId, binding, manifest,
  }));
});
