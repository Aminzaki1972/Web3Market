import { assertEquals } from "jsr:@std/assert@1";
import { auditPriority, buildAuditChunks, calculateAuditCoverage, selectAuditBatch, selectAuditCandidates } from "./audit-selection.ts";

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


Deno.test("security-critical paths are selected before generic application code and tests", () => {
  const tree = [
    { type: "blob", path: "tests/auth.test.ts", size: 100 },
    { type: "blob", path: "src/components/Header.tsx", size: 100 },
    { type: "blob", path: "supabase/functions/settle-deal/index.ts", size: 100 },
    { type: "blob", path: "src/contracts/Vault.sol", size: 100 },
    { type: "blob", path: "package.json", size: 100 },
  ];
  const result = selectAuditCandidates(tree, 3);
  assertEquals(result.candidates.map((f: any) => f.path), [
    "src/contracts/Vault.sol",
    "supabase/functions/settle-deal/index.ts",
    "package.json",
  ]);
  assertEquals(auditPriority("supabase/functions/settle-deal/index.ts") < auditPriority("src/components/Header.tsx"), true);
  assertEquals(auditPriority("src/components/Header.tsx") < auditPriority("tests/auth.test.ts"), true);
});

Deno.test("the reported coverage percentage still uses all eligible files", () => {
  const tree = Array.from({ length: 100 }, (_, i) => ({
    type: "blob", path: i < 10 ? "supabase/functions/function" + i + ".ts" : "src/file" + i + ".ts", size: 100,
  }));
  const result = selectAuditCandidates(tree, 100);
  assertEquals(result.candidateCount, 100);
  assertEquals(calculateAuditCoverage(57, result.candidateCount), 57);
});


Deno.test("full-repository mode returns every eligible candidate without a fixed total cap", () => {
  const files = Array.from({ length: 257 }, (_, i) => ({
    type: "blob", path: "src/module" + String(i).padStart(3, "0") + ".ts", size: 100,
  }));
  const result = selectAuditCandidates(files, Number.MAX_SAFE_INTEGER);
  assertEquals(result.candidateCount, 257);
  assertEquals(result.candidates.length, 257);
});

Deno.test("file batches are deterministic, bounded, and cover each candidate exactly once", async () => {
  const files = Array.from({ length: 257 }, (_, i) => ({ path: "src/file" + i + ".ts" }));
  const first = selectAuditBatch(files, 0, 100);
  const second = selectAuditBatch(files, 1, 100);
  const third = selectAuditBatch(files, 2, 100);
  assertEquals([first.candidates.length, second.candidates.length, third.candidates.length], [100, 100, 57]);
  assertEquals([first.totalBatches, second.totalBatches, third.totalBatches], [3, 3, 3]);
  assertEquals([...first.candidates, ...second.candidates, ...third.candidates].map((f) => f.path), files.map((f) => f.path));
});


Deno.test("large source files are split across bounded AI evidence chunks instead of dropped", () => {
  const source = "const evidence = \"" + "x".repeat(8500) + "\";\\n".repeat(1);
  const chunks = buildAuditChunks([{ path: "src/large.ts", content: source }], 2048);
  assertEquals(chunks.length > 1, true);
  assertEquals(chunks.every((chunk) => chunk.length <= 2048), true);
  assertEquals(chunks.some((chunk) => chunk.includes("content part 1")), true);
  assertEquals(chunks.some((chunk) => chunk.includes("content part 2")), true);
  assertEquals(chunks.map((chunk) => chunk.length).reduce((sum, length) => sum + length, 0) >= source.length, true);
});
