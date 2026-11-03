import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { validateStaticAnalysisTarget } from "./github-static-analysis.ts";

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
