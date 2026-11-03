import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { validateStaticAnalysisReport, validateStaticAnalysisTarget } from "./github-static-analysis.ts";

Deno.test("accepts a valid immutable target and normalizes repository suffix", () => {
  const target = validateStaticAnalysisTarget({
    owner: "Aminzaki1972",
    repo: "Web3Market.git",
    commitSha: "A".repeat(40),
    auditId: "123e4567-e89b-42d3-a456-426614174000",
  });
  assertEquals(target.repo, "Web3Market");
  assertEquals(target.commitSha, "a".repeat(40));
});

Deno.test("rejects branch names and abbreviated commit hashes", () => {
  assertThrows(() => validateStaticAnalysisTarget({
    owner: "owner", repo: "repo", commitSha: "main",
    auditId: "123e4567-e89b-42d3-a456-426614174000",
  }));
});

Deno.test("rejects invalid audit identifiers", () => {
  assertThrows(() => validateStaticAnalysisTarget({
    owner: "owner", repo: "repo", commitSha: "a".repeat(40), auditId: "not-a-uuid",
  }));
});

Deno.test("rejects unsafe owner and repository strings", () => {
  assertThrows(() => validateStaticAnalysisTarget({
    owner: "owner/name", repo: "repo", commitSha: "a".repeat(40),
    auditId: "123e4567-e89b-42d3-a456-426614174000",
  }));
});

const validReport = () => ({
  schema_version: "w3m.static-analysis.v1",
  repository: "owner/repo",
  commit_sha: "a".repeat(40),
  audit_id: "123e4567-e89b-42d3-a456-426614174000",
  analysis_scope: "solidity_static_analysis",
  engines: {
    slither: { version: "0.11.6", status: "completed", process_exit_code: 1 },
    aderyn: { version: "0.6.8", status: "completed", process_exit_code: 0 },
  },
  findings: [{
    fingerprint: "abc123",
    confirmed: false,
    triage_status: "needs_ai_triage",
  }],
});

Deno.test("accepts a report bound to the exact audit, repository, and commit", () => {
  const report = validateStaticAnalysisReport(validReport(), {
    repository: "owner/repo",
    commitSha: "a".repeat(40),
    auditId: "123e4567-e89b-42d3-a456-426614174000",
  });
  assertEquals(report.findings.length, 1);
});

Deno.test("rejects a report from a different commit", () => {
  assertThrows(() => validateStaticAnalysisReport(validReport(), {
    repository: "owner/repo",
    commitSha: "b".repeat(40),
    auditId: "123e4567-e89b-42d3-a456-426614174000",
  }));
});

Deno.test("rejects findings marked confirmed before AI triage", () => {
  const report: any = validReport();
  report.findings[0].confirmed = true;
  assertThrows(() => validateStaticAnalysisReport(report, {
    repository: "owner/repo",
    commitSha: "a".repeat(40),
    auditId: "123e4567-e89b-42d3-a456-426614174000",
  }));
});

Deno.test("rejects a report with a missing engine result", () => {
  const report: any = validReport();
  delete report.engines.aderyn;
  assertThrows(() => validateStaticAnalysisReport(report, {
    repository: "owner/repo",
    commitSha: "a".repeat(40),
    auditId: "123e4567-e89b-42d3-a456-426614174000",
  }));
});
