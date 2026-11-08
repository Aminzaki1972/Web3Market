import { assertEquals } from "jsr:@std/assert@1.0.14";
import { classifyW3MAgreementGate } from "./w3m-deal-room-legacy-gate.js";

Deno.test("legacy acceptance remains available only when the V1 endpoint is absent", () => {
  assertEquals(classifyW3MAgreementGate(404, { message: "Function not found" }), "legacy");
  assertEquals(classifyW3MAgreementGate(404, { error: "Deal not found" }), "blocked");
  assertEquals(classifyW3MAgreementGate(400, { error: "Unknown action" }), "legacy");
  assertEquals(classifyW3MAgreementGate(400, { error: "Invalid deal_id" }), "blocked");
});

Deno.test("legacy acceptance remains available when the server confirms no V1 terms exist", () => {
  assertEquals(classifyW3MAgreementGate(200, {
    ok: true, result: { current_terms: null },
  }), "legacy");
});

Deno.test("published canonical V1 terms disable the legacy acceptance path", () => {
  assertEquals(classifyW3MAgreementGate(200, {
    ok: true,
    result: {
      current_terms: {
        terms_version: "1",
        terms_hash: "a".repeat(64),
        canonical_terms: { schema: "w3m-acquisition-terms-v1" },
      },
    },
  }), "v1");
});

Deno.test("ambiguous, malformed, unauthorized and failed status responses fail closed", () => {
  assertEquals(classifyW3MAgreementGate(200, { ok: true, result: {} }), "blocked");
  assertEquals(classifyW3MAgreementGate(200, {
    ok: true, result: { current_terms: { terms_version: "0", terms_hash: "bad", canonical_terms: {} } },
  }), "blocked");
  assertEquals(classifyW3MAgreementGate(401, { ok: false, error: "Unauthorized" }), "blocked");
  assertEquals(classifyW3MAgreementGate(403, { ok: false, error: "Not a participant" }), "blocked");
  assertEquals(classifyW3MAgreementGate(500, { ok: false, error: "Database unavailable" }), "blocked");
  assertEquals(classifyW3MAgreementGate(404, { message: "Function route missing" }), "blocked");
});
