import { assertEquals } from "jsr:@std/assert";
import { clamp, domainIncludedInSale, fallback } from "./review-scoring.ts";

Deno.test("clamp keeps scores within 0–100 and rounds", () => {
  assertEquals(clamp(-4), 0);
  assertEquals(clamp(101), 100);
  assertEquals(clamp(74.6), 75);
});

Deno.test("complete real listing gets a completeness score, not a risk verdict", () => {
  const project = {
    title: "Project",
    website_url: "https://example.com",
    short_description: "Short description",
    full_description: "A sufficiently detailed project description",
    business_model: "SaaS",
    github_url: "https://github.com/example/project",
    github_ownership: "Repository access evidence supplied",
    ownership_declaration: "I own the assets",
  };
  assertEquals(fallback(project, []).score, 100);
  assertEquals(fallback(project, []).status, "recommended_for_admin_review");
});

Deno.test("findings reduce completeness score according to severity", () => {
  const project = {
    title: "Project",
    website_url: "https://example.com",
    short_description: "Short description",
    full_description: "A sufficiently detailed project description",
    business_model: "SaaS",
    ownership_declaration: "I own the assets",
  };
  assertEquals(fallback(project, [{ severity: "high" }]).score, 82);
  assertEquals(fallback(project, [{ severity: "medium" }]).score, 92);
  assertEquals(fallback(project, [{ severity: "low" }]).score, 97);
});

Deno.test("missing core fields cannot reach the admin-review threshold", () => {
  const result = fallback({ title: "Only a title" }, []);
  assertEquals(result.score, 20);
  assertEquals(result.status, "needs_changes");
});

Deno.test("test-mode completeness uses test workflow fields", () => {
  const project = {
    title: "Test listing",
    short_description: "Testing only",
    full_description: "Testing the workflow",
    ownership_declaration: "Test owner",
    buyer_pitch: "Test pitch",
  };
  assertEquals(fallback(project, [], true).score, 100);
  assertEquals(fallback(project, [], true).status, "recommended_for_admin_review");
});

Deno.test("domain ownership is required only when sale terms indicate domain transfer", () => {
  assertEquals(domainIncludedInSale({ website_url: "https://example.com" }), false);
  assertEquals(domainIncludedInSale({ transfer_terms: "Code files only; no domain transfer" }), true);
  assertEquals(domainIncludedInSale({ assets: ["GitHub repo", "website domain"] }), true);
});
