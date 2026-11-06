import { assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert@1";
import { computeAuditManifest } from "./audit-manifest.ts";

function fixture() {
  return {
    audit: {
      id: "audit-001",
      project_id: "project-001",
      repo_url: "https://github.com/example/project",
      commit_sha: "a".repeat(40),
      status: "completed",
      engine_version: "w3m-code-audit-2.0",
      overall_score: 87.5,
      analysis_progress: { evidence_version: "w3m-audit-evidence-v1", tree_truncated: false },
    },
    files: [
      { id: "file-2", path: "src/b.ts", content_hash: "b".repeat(64), lines_scanned: 20 },
      { id: "file-1", path: "src/a.ts", content_hash: "a".repeat(64), lines_scanned: 10 },
    ],
    findings: [
      { id: "finding-2", file_id: "file-2", severity: "medium", rule_id: "M-2", line: 9 },
      { id: "finding-1", file_id: "file-1", severity: "high", rule_id: "H-1", line: 4 },
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
    files: input.files.map((row) => row.id === "file-1" ? { ...row, content_hash: "c".repeat(64) } : row),
  });
  const changedFinding = await computeAuditManifest({
    ...input,
    findings: input.findings.map((row) => row.id === "finding-1" ? { ...row, severity: "critical" } : row),
  });
  assertNotEquals(base.digest, changedAudit.digest);
  assertNotEquals(base.digest, changedFile.digest);
  assertNotEquals(base.digest, changedFinding.digest);
});

Deno.test("audit manifest rejects missing IDs and duplicate row IDs", async () => {
  const input = fixture();
  await assertRejects(() => computeAuditManifest({ ...input, audit: { ...input.audit, id: "" } }));
  await assertRejects(() => computeAuditManifest({ ...input, files: [{ path: "missing-id.ts" }] }));
  await assertRejects(() => computeAuditManifest({
    ...input,
    findings: [input.findings[0], input.findings[0]],
  }));
});

Deno.test("audit manifest rejects non-JSON and non-finite evidence", async () => {
  const input = fixture();
  await assertRejects(() => computeAuditManifest({
    ...input,
    audit: { ...input.audit, unsafe: Number.NaN },
  }));
  await assertRejects(() => computeAuditManifest({
    ...input,
    files: [{ id: "bad", unsupported: BigInt(1) as unknown as number }],
  }));
});
