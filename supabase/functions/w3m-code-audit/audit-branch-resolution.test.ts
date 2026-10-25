import { assertEquals } from "jsr:@std/assert@1";
import { shouldFallbackToDefaultBranch } from "./audit-branch-resolution.ts";

Deno.test("missing stored main branch falls back to repository default master", () => {
  assertEquals(
    shouldFallbackToDefaultBranch("main", "main", "master", "GitHub API 422: No commit found for SHA: main"),
    true,
  );
});

Deno.test("missing stored branch reported as 404 falls back to repository default", () => {
  assertEquals(
    shouldFallbackToDefaultBranch("main", "main", "master", "GitHub API 404: Branch not found"),
    true,
  );
});

Deno.test("GitHub rate limits do not trigger a branch fallback", () => {
  assertEquals(
    shouldFallbackToDefaultBranch("main", "main", "master", "GitHub API rate limit or access restriction (403)."),
    false,
  );
});

Deno.test("a missing repository default branch does not retry the same branch", () => {
  assertEquals(
    shouldFallbackToDefaultBranch("master", "master", "master", "GitHub API 422: No commit found for SHA: master"),
    false,
  );
});

Deno.test("a blank stored branch does not count as a stale saved branch", () => {
  assertEquals(
    shouldFallbackToDefaultBranch("", "master", "master", "GitHub API 422: No commit found for SHA: main"),
    false,
  );
});
