import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { loadAuditManifest, type AuditManifestSource } from "./audit-manifest-loader.ts";

function source(): AuditManifestSource {
  const auditId = "audit-loader-1";
  const audit = {
    id: auditId, status: "completed", commit_sha: "a".repeat(40),
    repo_owner: "example", repo_name: "repo", completed_at: "2026-11-06T18:00:00.000Z",
    engine_version: "w3m-code-audit-2.0", files_scanned: 2,
    critical_count: 0, high_count: 0, medium_count: 0, low_count: 0, info_count: 0,
    analysis_progress: { evidence_version: "w3m-audit-evidence-v1", tree_truncated: false, persisted_file_count: 2 },
  };
  const files = [
    { audit_id: auditId, path: "a.ts", line_count: 1, size_bytes: 10, selected_tier: "core" },
    { audit_id: auditId, path: "b.ts", line_count: 2, size_bytes: 20, selected_tier: "core" },
  ];
  return {
    loadAudit: async () => ({ data: audit }),
    loadFilesPage: async (_id, from, to) => ({ data: files.slice(from, to + 1) }),
    loadFindingsPage: async () => ({ data: [] }),
  };
}

Deno.test("manifest loader exhausts every page and returns a complete digest", async () => {
  const result = await loadAuditManifest({ auditId: "audit-loader-1", source: source(), pageSize: 1 });
  assertEquals(result.fileCount, 2);
  assertEquals(result.findingCount, 0);
  assertEquals(result.digest.length, 64);
});

Deno.test("manifest loader fails closed on audit lookup errors or identity mismatch", async () => {
  const base = source();
  await assertRejects(() => loadAuditManifest({
    auditId: "audit-loader-1",
    source: { ...base, loadAudit: async () => ({ data: null, error: { message: "read failed" } }) },
  }));
  await assertRejects(() => loadAuditManifest({
    auditId: "audit-loader-1",
    source: { ...base, loadAudit: async () => ({ data: { id: "other" } }) },
  }));
});

Deno.test("manifest loader fails closed when any page read fails or page size is invalid", async () => {
  const base = source();
  await assertRejects(() => loadAuditManifest({
    auditId: "audit-loader-1",
    source: { ...base, loadFilesPage: async () => ({ data: null, error: { message: "page failed" } }) },
    pageSize: 1,
  }));
  await assertRejects(() => loadAuditManifest({ auditId: "audit-loader-1", source: base, pageSize: 0 }));
});
