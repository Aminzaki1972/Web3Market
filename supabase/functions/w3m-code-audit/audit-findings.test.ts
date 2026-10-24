import { assertEquals } from "jsr:@std/assert@1";
import { auditFindingKey, filterMissingAuditFindings } from "./audit-findings.ts";

const finding = (overrides: Record<string, unknown> = {}) => ({
  file_path: "src\\contract.sol", line_start: 12, title: "Unchecked call",
  category: "security", severity: "high", ...overrides,
});

Deno.test("finding keys normalize path separators and case/whitespace", () => {
  assertEquals(auditFindingKey(finding()), auditFindingKey(finding({
    file_path: "src/contract.sol", title: " unchecked CALL ", category: "SECURITY", severity: "HIGH",
  })));
});

Deno.test("retry filtering excludes persisted findings", () => {
  const oldFinding = finding();
  const freshFinding = finding({ file_path: "src/new.sol", title: "Missing access control" });
  assertEquals(filterMissingAuditFindings([oldFinding, freshFinding], [oldFinding]), [freshFinding]);
});

Deno.test("retry filtering removes duplicates in the same insert batch", () => {
  const first = finding();
  const duplicate = finding({ title: " unchecked CALL " });
  assertEquals(filterMissingAuditFindings([first, duplicate], []), [first]);
});
