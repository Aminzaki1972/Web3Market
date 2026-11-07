import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
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

Deno.test("manifest excludes unscanned rows but checks scanned count", () => {
  const withUnscanned = [...files, { ...files[0], path: "ignored.txt", scanned: false }];
  assertEquals((buildW3MAuditManifest(audit, withUnscanned, findings).files as unknown[]).length, 2);
  assertThrows(() => buildW3MAuditManifest({ ...audit, files_scanned: 3 }, files, findings));
});

Deno.test("manifest rejects incomplete audits and missing immutable file SHAs", () => {
  assertThrows(() => buildW3MAuditManifest({ ...audit, status: "processing" }, files, findings));
  assertThrows(() => buildW3MAuditManifest(audit, [{ ...files[0], sha: null }, files[1]], findings));
  assertThrows(() => buildW3MAuditManifest({ ...audit, commit_sha: null }, files, findings));
});

Deno.test("manifest rejects duplicate and unsafe repository paths", () => {
  assertThrows(() => buildW3MAuditManifest(audit, [files[0], { ...files[1], path: files[0].path }], findings));
  for (const path of ["../secret.txt", "/etc/passwd", "src/../secret.ts", "src//file.ts", "C:/repo/file.ts"]) {
    assertThrows(() => buildW3MAuditManifest(audit, [{ ...files[0], path }, files[1]], findings));
  }
});

Deno.test("manifest rejects findings outside scanned evidence", () => {
  assertThrows(() => buildW3MAuditManifest(audit, files, [{ ...findings[0], file_path: "not-scanned.ts" }]));
});

Deno.test("manifest rejects invalid finding line ranges and confidence", () => {
  assertThrows(() => buildW3MAuditManifest(audit, files, [{ ...findings[0], line_start: 0 }]));
  assertThrows(() => buildW3MAuditManifest(audit, files, [{ ...findings[0], line_start: 9, line_end: 2 }]));
  assertThrows(() => buildW3MAuditManifest(audit, files, [{ ...findings[0], confidence: 101 }]));
});

Deno.test("manifest sorts findings deterministically even when primary sort keys match", () => {
  const first = { ...findings[0], title: "A", evidence: "z" };
  const second = { ...findings[0], title: "A", evidence: "a" };
  const a = buildW3MAuditManifest(audit, files, [first, second]);
  const b = buildW3MAuditManifest(audit, files, [second, first]);
  assertEquals(a, b);
});


Deno.test("manifest rejects malformed persisted audit identity and out-of-range summary metrics", () => {
  assertThrows(() => buildW3MAuditManifest({ ...audit, id: "not-a-uuid" }, files, findings));
  assertThrows(() => buildW3MAuditManifest({ ...audit, repo_owner: "../escape" }, files, findings));
  assertThrows(() => buildW3MAuditManifest({ ...audit, lines_scanned: -1 }, files, findings));
  assertThrows(() => buildW3MAuditManifest({ ...audit, security_score: 101 }, files, findings));
  assertThrows(() => buildW3MAuditManifest({ ...audit, overall_score: Number.NaN }, files, findings));
  assertThrows(() => buildW3MAuditManifest({ ...audit, files_scanned: 0 }, [], []));
});

Deno.test("manifest rejects malformed persisted file metadata and incomplete finding fields", () => {
  assertThrows(() => buildW3MAuditManifest(audit, [{ ...files[0], size_bytes: -1 }, files[1]], findings));
  assertThrows(() => buildW3MAuditManifest(audit, [{ ...files[0], line_count: 1.5 }, files[1]], findings));
  assertThrows(() => buildW3MAuditManifest(audit, [{ ...files[0], language: 7 as unknown as string }, files[1]], findings));
  assertThrows(() => buildW3MAuditManifest(audit, files, [{ ...findings[0], title: "" }]));
  assertThrows(() => buildW3MAuditManifest(audit, files, [{ ...findings[0], confidence: Number.NaN }]));
});
