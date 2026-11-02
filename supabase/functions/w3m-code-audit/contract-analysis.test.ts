import { analyzeSmartContracts } from "./contract-analysis.ts";
function equal(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(message + ": expected " + String(expected) + ", got " + String(actual));
}
Deno.test("only Solidity files are inspected", () => {
  equal(analyzeSmartContracts([{ path: "src/app.ts", content: "tx.origin; selfdestruct(payable(msg.sender));" }]).length, 0, "non-Solidity file should be ignored");
});
Deno.test("flags candidates with source evidence", () => {
  const findings = analyzeSmartContracts([{ path: "contracts/Vault.sol", content: "pragma solidity ^0.8.20;\nfunction auth() external { require(tx.origin == owner); }\nfunction pay() external { payable(msg.sender).call{value: amount}(\"\"); }" }]);
  equal(findings.length, 2, "expected two candidate findings");
  equal(findings[0].file_path, "contracts/Vault.sol", "finding path");
  equal(findings[0].line_start, 2, "finding line");
  equal(findings[0].status, "needs_verification", "finding status");
});
Deno.test("ignores line comments and caps findings", () => {
  const findings = analyzeSmartContracts([{ path: "contracts/Example.sol", content: "// tx.origin\n" + Array(50).fill("assembly { }").join("\n") }]);
  equal(findings.length, 40, "finding cap");
});
