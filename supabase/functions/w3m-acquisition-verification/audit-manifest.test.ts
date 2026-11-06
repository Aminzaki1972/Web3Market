import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { buildW3MAuditManifest } from "./audit-manifest.ts";

const audit = {
  id: "71000000-0000-4000-8000-000000000001", status: "completed",
  repo_owner: "Aminzaki1972", repo_name: "Web3Market", commit_sha: "a".repeat(40),
  engine_version: "w3m-code-audit-2.0", audit_type: "code",
  files_scanned: 2, lines_scanned: 120, overall_score: 88,
  security_score: 90, architecture_score: 87, code_quality_score: 86,
  dependency_score: 89, testing_score: 70, documentation_score: 80,
  web3_score: 91, scalability_score: 84, ai_fit_score: 30,
  risk_level: "Moderate", summary: "Example audit summary",
};
const files = [
  { path: "src/z.ts", sha: "b".repeat(40), language: "TypeScript", size_bytes: 20, line_count: 2, selected_tier: 1, scanned: true },
  { path: "src/a.ts", sha: "c".repeat(40), language: "TypeScript", size_bytes: 10, line_count: 1, selected_tier: 1, scanned: true },
];
const findings = [{
  severity: "low", category: "quality", title: "Example", status: "needs_verification",
  file_path: "src/a.ts", line_start: 1, line_end: 1, evidence: "example",
  description: "example finding", recommendation: "review", confidence: 50,
}];

Deno.test("manifest sorts files deterministically by normalized path", () => {
  const a = buildW3MAuditManifest(audit, files, findings);
  const b = buildW3MAuditManifest(audit, [...files].reverse(), findings);
  assertEquals(a, b);
  assertEquals((a.files as Array<{path:string}>).map((f) => f.path), ["src/a.ts", "src/z.ts"]);
});

Deno.test("manifest excludes unscanned rows but checks scanned count", async () => {
  const withUnscanned = [...files, { ...files[0], path: "ignored.txt", scanned: false }];
  assertEquals((buildW3MAuditManifest(audit, withUnscanned, findings).files as unknown[]).length, 2);
  await assertRejects(() => buildW3MAuditManifest({ ...audit, files_scanned: 3 }, files, findings));
});

Deno.test("manifest rejects incomplete audits and missing immutable file SHAs", async () => {
  await assertRejects(() => buildW3MAuditManifest({ ...audit, status: "processing" }, files, findings));
  await assertRejects(() => buildW3MAuditManifest(audit, [{ ...files[0], sha: null }, files[1]], findings));
  await assertRejects(() => buildW3MAuditManifest({ ...audit, commit_sha: null }, files, findings));
});
