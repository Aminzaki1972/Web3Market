import { assert, assertEquals } from "jsr:@std/assert@1";
import { selectCodeAuditEvidence, type CodeAuditSourceRow } from "./code-audit-evidence-selector.ts";

const expected = {
  dealId: "deal-1",
  projectId: "11111111-1111-4111-8111-111111111111",
  repositoryOwner: "Aminzaki1972",
  repositoryName: "Web3Market",
  commitSha: "a".repeat(40),
  now: "2026-11-06T18:00:00.000Z",
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
};
const row: CodeAuditSourceRow = {
  id: "22222222-2222-4222-8222-222222222222",
  project_id: expected.projectId,
  status: "completed",
  audit_type: "code",
  repo_owner: "Aminzaki1972",
  repo_name: "Web3Market",
  commit_sha: expected.commitSha,
  completed_at: "2026-11-01T10:00:00.000Z",
  overall_score: 87.5,
  risk_level: "Low Risk",
  analysis_method: "multi-pass-gemini-v3-executive-scores",
};

Deno.test("selects a completed audit only for exact project, repo and commit", async () => {
  const result = await selectCodeAuditEvidence(row, expected);
  assertEquals(result.result, "PASS");
  if (result.result !== "PASS") return;
  assertEquals(result.evidence.type, "CODE_AUDIT");
  assertEquals(result.evidence.sourceRecordId, row.id);
  assertEquals(result.evidence.sourceVersion, expected.commitSha);
  assertEquals(result.evidence.metadata?.auditStatus, "completed");
});

Deno.test("rejects an audit belonging to another project", async () => {
  const result = await selectCodeAuditEvidence({ ...row, project_id: "33333333-3333-4333-8333-333333333333" }, expected);
  assertEquals(result.result, "REVIEW_REQUIRED");
});

Deno.test("rejects a different repository identity or commit", async () => {
  assertEquals((await selectCodeAuditEvidence({ ...row, repo_name: "OtherRepo" }, expected)).result, "REVIEW_REQUIRED");
  assertEquals((await selectCodeAuditEvidence({ ...row, commit_sha: "b".repeat(40) }, expected)).result, "REVIEW_REQUIRED");
});

Deno.test("rejects incomplete, unsupported, stale and future-dated audits", async () => {
  assertEquals((await selectCodeAuditEvidence({ ...row, status: "processing" }, expected)).result, "REVIEW_REQUIRED");
  assertEquals((await selectCodeAuditEvidence({ ...row, audit_type: "unknown" }, expected)).result, "REVIEW_REQUIRED");
  assertEquals((await selectCodeAuditEvidence({ ...row, completed_at: "2026-01-01T00:00:00.000Z" }, expected)).result, "REVIEW_REQUIRED");
  assertEquals((await selectCodeAuditEvidence({ ...row, completed_at: "2026-11-07T00:00:00.000Z" }, expected)).result, "REVIEW_REQUIRED");
});

Deno.test("rejects missing analysis provenance and invalid score", async () => {
  assertEquals((await selectCodeAuditEvidence({ ...row, analysis_method: null }, expected)).result, "REVIEW_REQUIRED");
  assertEquals((await selectCodeAuditEvidence({ ...row, overall_score: 101 }, expected)).result, "REVIEW_REQUIRED");
});

Deno.test("hashes the normalized audit snapshot and binds evidence to deal", async () => {
  const result = await selectCodeAuditEvidence(row, expected);
  assert(result.result === "PASS");
  assertEquals(result.evidence.dealId, expected.dealId);
  assertEquals(result.evidence.projectId, expected.projectId);
  assertEquals(result.evidence.contentHash.length, 64);
});
