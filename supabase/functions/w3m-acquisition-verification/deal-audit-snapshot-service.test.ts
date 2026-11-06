import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { prepareDealAuditSnapshot } from "./deal-audit-snapshot-service.ts";
import type { AuditManifestRow } from "./audit-manifest.ts";
import type { AuditManifestSource } from "./audit-manifest-loader.ts";
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";

const dealId = "71000000-0000-4000-8000-000000000001";
const projectId = "72000000-0000-4000-8000-000000000002";
const auditId = "73000000-0000-4000-8000-000000000003";
const audit = {
  id: auditId, project_id: projectId, status: "completed", audit_type:"code",
  repo_owner: "owner", repo_name: "repo", repo_url: "https://github.com/owner/repo",
  commit_sha: "a".repeat(40), completed_at: "2026-11-07T10:00:00.000Z",
  engine_version: "w3m-code-audit-1.0", files_scanned: 1,
  critical_count: 0, high_count: 0, medium_count: 0, low_count: 0, info_count: 0,
  analysis_progress: {
    evidence_version: "w3m-audit-evidence-v1",
    tree_truncated: false,
    persisted_file_count: 1,
  },
};
const context = {
  deal_id: dealId, project_id: projectId, buyer_id:"83000000-0000-4000-8000-000000000003",
  seller_id:"84000000-0000-4000-8000-000000000004", audit_id: auditId,
  project_github_url: "https://github.com/owner/repo",
};
function source(auditRow: AuditManifestRow = audit): AuditManifestSource {
  return {
    async loadAudit(id) { return {data: id === auditId ? auditRow : null}; },
    async loadFilesPage(id, from, to) {
      assertEquals(id, auditId);
      return {data: from === 0 ? [{id:"file-row-1",audit_id:auditId,path:"README.md"}] : []};
    },
    async loadFindingsPage(id, from, to) {
      assertEquals(id, auditId);
      return {data: []};
    },
  };
}
function client(calls: unknown[] = [], contextData: unknown = context): W3MRpcClient {
  return {
    async rpc(name, args) {
      (calls as unknown[]).push({name,args});
      if (name === "w3m_read_deal_audit_snapshot_context") return {data:contextData,error:null};
      if (name === "w3m_create_deal_code_audit_snapshot") {
        return {error:null,data:{
          id:"74000000-0000-4000-8000-000000000004",
          deal_id:dealId, project_id:projectId, snapshot_version:1, audit_id:auditId,
          repository_owner:"owner", repository_name:"repo",
          repository_url:"https://github.com/owner/repo", commit_sha:"a".repeat(40),
          audit_type:"code", completed_at:"2026-11-07T10:00:00.000Z",
          manifest_version:args.p_manifest_version, manifest_hash:args.p_manifest_hash,
          file_count:args.p_file_count, finding_count:args.p_finding_count,
          idempotent_replay:false,
        }};
      }
      throw new Error("Unexpected RPC " + name);
    },
  };
}

Deno.test("prepares an independent audit snapshot without reading any acquisition report", async () => {
  const calls: unknown[] = [];
  const result = await prepareDealAuditSnapshot(client(calls), source(), dealId, "83000000-0000-4000-8000-000000000003");
  assertEquals(result.snapshot.dealId, dealId);
  assertEquals(result.snapshot.projectId, projectId);
  assertEquals(result.snapshot.binding.auditId, auditId);
  assertEquals(result.snapshot.fileCount, 1);
  assertEquals(result.snapshot.findingCount, 0);
  assertEquals((calls as {name:string}[]).map(x=>x.name), [
    "w3m_read_deal_audit_snapshot_context",
    "w3m_create_deal_code_audit_snapshot",
  ]);
});

Deno.test("rejects a repository that differs from the authoritative project listing before persistence", async () => {
  const calls: unknown[] = [];
  await assertRejects(() => prepareDealAuditSnapshot(
    client(calls, {...context,project_github_url:"https://github.com/other/repo"}),
    source(),
    dealId,
    "83000000-0000-4000-8000-000000000003",
  ));
  assertEquals((calls as {name:string}[]).map(x=>x.name), ["w3m_read_deal_audit_snapshot_context"]);
});

Deno.test("rejects a completed audit owned by another project before persistence", async () => {
  const calls: unknown[] = [];
  await assertRejects(() => prepareDealAuditSnapshot(
    client(calls),
    source({...audit,project_id:"75000000-0000-4000-8000-000000000005"}),
    dealId,
    "83000000-0000-4000-8000-000000000003",
  ));
  assertEquals((calls as {name:string}[]).map(x=>x.name), ["w3m_read_deal_audit_snapshot_context"]);
});

Deno.test("fails closed when the trusted context RPC errors or returns another deal", async () => {
  const errorClient: W3MRpcClient = {
    async rpc() { return {data:null,error:new Error("db")}; },
  };
  await assertRejects(() => prepareDealAuditSnapshot(errorClient, source(), dealId, "83000000-0000-4000-8000-000000000003"));
  await assertRejects(() => prepareDealAuditSnapshot(
    client([], {...context,deal_id:"75000000-0000-4000-8000-000000000005"}),
    source(),
    dealId,
    "83000000-0000-4000-8000-000000000003",
  ));
});

Deno.test("rejects a non-party actor before persisting the independent snapshot", async () => {
  const calls: unknown[] = [];
  await assertRejects(() => prepareDealAuditSnapshot(
    client(calls),
    source(),
    dealId,
    "75000000-0000-4000-8000-000000000005",
  ));
  assertEquals((calls as {name:string}[]).map(x=>x.name), ["w3m_read_deal_audit_snapshot_context"]);
});
