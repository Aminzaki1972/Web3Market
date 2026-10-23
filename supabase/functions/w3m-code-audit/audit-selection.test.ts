import { assertEquals } from "jsr:@std/assert@1";
import { auditPriority, calculateAuditCoverage, selectAuditCandidates } from "./audit-selection.ts";

Deno.test("production source is prioritized ahead of harnesses and tests", () => {
  const tree = [
    { type: "blob", path: "certora/harness/PoolHarness.sol", size: 100 },
    { type: "blob", path: "tests/Pool.test.ts", size: 100 },
    { type: "blob", path: "src/Pool.sol", size: 100 },
    { type: "blob", path: "package.json", size: 100 },
  ];
  const selected = selectAuditCandidates(tree, 2);
  assertEquals(selected.candidateCount, 4);
  assertEquals(selected.candidates.map((f: any) => f.path), ["src/Pool.sol", "package.json"]);
  assertEquals(auditPriority("src/Pool.sol") < auditPriority("certora/harness/PoolHarness.sol"), true);
});

Deno.test("selection keeps the cap while prioritizing production files", () => {
  const production = Array.from({ length: 105 }, (_, i) => ({
    type: "blob", path: "src/Contract" + String(i).padStart(3, "0") + ".sol", size: 100,
  }));
  const testFiles = Array.from({ length: 15 }, (_, i) => ({
    type: "blob", path: "tests/Contract" + String(i).padStart(3, "0") + ".test.ts", size: 100,
  }));
  const result = selectAuditCandidates([...testFiles, ...production], 100);
  assertEquals(result.candidateCount, 120);
  assertEquals(result.candidates.length, 100);
  assertEquals(result.candidates.every((f: any) => f.path.startsWith("src/")), true);
});

Deno.test("coverage uses all eligible files, not only the capped subset", () => {
  assertEquals(calculateAuditCoverage(100, 120), 83);
  assertEquals(calculateAuditCoverage(57, 100), 57);
  assertEquals(calculateAuditCoverage(5, 5), 100);
  assertEquals(calculateAuditCoverage(0, 0), 0);
});

Deno.test("non-code assets and excluded build folders are ignored", () => {
  const result = selectAuditCandidates([
    { type: "blob", path: "src/Pool.sol", size: 100 },
    { type: "blob", path: "node_modules/lib/index.js", size: 100 },
    { type: "blob", path: "assets/logo.png", size: 100 },
    { type: "tree", path: "src/nested", size: 0 },
  ], 100);
  assertEquals(result.candidateCount, 1);
  assertEquals(result.candidates[0].path, "src/Pool.sol");
});
