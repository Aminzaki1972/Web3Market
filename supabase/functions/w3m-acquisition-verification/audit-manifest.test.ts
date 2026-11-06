import { assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert@1";
import { computeAuditManifest } from "./audit-manifest.ts";

function fixture() {
  const auditId = "audit-001";
  return {
    audit: {
      id: auditId,
      project_id: "project-001",
      repo_url: "https://github.com/example/project",
      repo_owner: "example",
      repo_name: "project",
      branch: "main",
      commit_sha: "a".repeat(40),
      status: "completed",
      completed_at: "2026-11-06T18:00:00.000Z",
      engine_version: "w3m-code-audit-2.0",
      overall_score: 87.5,
      files_scanned: 2,
      critical_count: 0,
      high_count: 1,
      medium_count: 1,
      low_count: 0,
      info_count: 0,
      analysis_progress: {
        evidence_version: "w3m-audit-evidence-v1",
        tree_truncated: false,
        persisted_file_count: 2,
      },
    },
    files: [
      { audit_id: auditId, path: "src/b.ts", line_count: 20, size_bytes: 500, selected_tier: "core" },
      { audit_id: auditId, path: "src/a.ts", line_count: 10, size_bytes: 300, selected_tier: "core" },
    ],
    findings: [
      { audit_id: auditId, file_path: "src/b.ts", line_start: 9, severity: "medium", category: "quality", title: "Finding B" },
      { audit_id: auditId, file_path: "src/a.ts", line_start: 4, severity: "high", category: "security", title: "Finding A" },
    ],
  };
}

Deno.test("audit manifest is deterministic regardless of row order", async () => {
  const input = fixture();
  const first = await computeAuditManifest(input);
  const second = await computeAuditManifest({
    ...input,
    files: [...input.files].reverse(),
    findings: [...input.findings].reverse(),
  });
  assertEquals(first, second);
  assertEquals(first.version, "w3m-audit-manifest-v1");
  assertEquals(first.fileCount, 2);
  assertEquals(first.findingCount, 2);
  assertEquals(first.digest.length, 64);
});

Deno.test("audit manifest changes when any audit, file, or finding evidence changes", async () => {
  const input = fixture();
  const base = await computeAuditManifest(input);
  const changedAudit = await computeAuditManifest({
    ...input,
    audit: { ...input.audit, overall_score: 88 },
  });
  const changedFile = await computeAuditManifest({
    ...input,
    files: input.files.map((row) => row.path === "src/a.ts" ? { ...row, size_bytes: 301 } : row),
  });
  const changedFinding = await computeAuditManifest({
    ...input,
    findings: input.findings.map((row) => row.title === "Finding A" ? { ...row, severity: "critical" } : row),
    audit: { ...input.audit, high_count: 0, critical_count: 1 },
  });
  assertNotEquals(base.digest, changedAudit.digest);
  assertNotEquals(base.digest, changedFile.digest);
  assertNotEquals(base.digest, changedFinding.digest);
});

Deno.test("audit manifest supports repository-level and file-level findings without line numbers", async () => {
  const input = fixture();
  const manifest = await computeAuditManifest({
    ...input,
    audit: { ...input.audit, info_count: 1, medium_count: 2 },
    findings: [
      ...input.findings,
      { audit_id: "audit-001", file_path: null, line_start: null,
        severity: "info", category: "repository", title: "Repository-wide observation" },
      { audit_id: "audit-001", file_path: "src/a.ts", line_start: null,
        severity: "medium", category: "quality", title: "File-level observation" },
    ],
  });
  assertEquals(manifest.findingCount, 4);
});

Deno.test("audit manifest rejects missing or duplicate natural keys", async () => {
  const input = fixture();
  await assertRejects(() => computeAuditManifest({ ...input, audit: { ...input.audit, id: "" } }));
  await assertRejects(() => computeAuditManifest({ ...input, files: [{ audit_id: "audit-001" }] }));
  await assertRejects(() => computeAuditManifest({
    ...input,
    files: [input.files[0], input.files[0]],
  }));
  await assertRejects(() => computeAuditManifest({
    ...input,
    findings: [input.findings[0], input.findings[0]],
  }));
  await assertRejects(() => computeAuditManifest({
    ...input,
    findings: [
      input.findings[1],
      { ...input.findings[1], file_path: "src\\a.ts", severity: "HIGH", category: "SECURITY", title: "Finding A" },
    ],
    audit: { ...input.audit, high_count: 2 },
  }));
});

Deno.test("audit manifest rejects incomplete, cross-audit, or mismatched evidence", async () => {
  const input = fixture();
  await assertRejects(() => computeAuditManifest({
    ...input,
    audit: { ...input.audit, status: "queued" },
  }));
  await assertRejects(() => computeAuditManifest({
    ...input,
    files: input.files.slice(0, 1),
  }));
  await assertRejects(() => computeAuditManifest({
    ...input,
    findings: input.findings.slice(0, 1),
  }));
  await assertRejects(() => computeAuditManifest({
    ...input,
    files: input.files.map((row) => ({ ...row, audit_id: "other-audit" })),
  }));
});

Deno.test("audit manifest rejects non-JSON, non-finite, and unsupported finding data", async () => {
  const input = fixture();
  await assertRejects(() => computeAuditManifest({
    ...input,
    audit: { ...input.audit, unsafe: Number.NaN },
  }));
  await assertRejects(() => computeAuditManifest({
    ...input,
    files: [{ audit_id: "audit-001", path: "bad", unsupported: BigInt(1) as unknown as number }],
  }));
  await assertRejects(() => computeAuditManifest({
    ...input,
    findings: input.findings.map((row) => row.title === "Finding A" ? { ...row, severity: "urgent" } : row),
  }));
});
