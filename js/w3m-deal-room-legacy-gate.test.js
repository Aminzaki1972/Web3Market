import { assertEquals } from "jsr:@std/assert@1.0.14";
import { classifyW3MAgreementGate } from "./w3m-deal-room-legacy-gate.js";

Deno.test("only an explicit server-owned legacy track enables legacy acceptance", () => {
  assertEquals(classifyW3MAgreementGate(200, { ok: true, result: { protocol_track: "legacy" } }), "legacy");
  assertEquals(classifyW3MAgreementGate(200, { ok: true, result: { protocol_track: "v1" } }), "v1");
});

Deno.test("missing, malformed, unknown, unauthorized, and failed status responses fail closed", () => {
  assertEquals(classifyW3MAgreementGate(200, { ok: true, result: {} }), "blocked");
  assertEquals(classifyW3MAgreementGate(200, { ok: true, result: { protocol_track: null } }), "blocked");
  assertEquals(classifyW3MAgreementGate(200, { ok: true, result: { protocol_track: "legacy-ish" } }), "blocked");
  assertEquals(classifyW3MAgreementGate(200, { ok: true, result: { protocol_track: "v2" } }), "blocked");
  assertEquals(classifyW3MAgreementGate(404, { message: "Function not found" }), "blocked");
  assertEquals(classifyW3MAgreementGate(400, { error: "Unknown action" }), "blocked");
  assertEquals(classifyW3MAgreementGate(401, { ok: false, error: "Unauthorized" }), "blocked");
  assertEquals(classifyW3MAgreementGate(403, { ok: false, error: "Not a participant" }), "blocked");
  assertEquals(classifyW3MAgreementGate(500, { ok: false, error: "Database unavailable" }), "blocked");
});

Deno.test("legacy agreement upsert targets the database's actual unique key", async () => {
  const source = await Deno.readTextFile(new URL("./deal-room.js", import.meta.url));
  assertEquals(source.includes("onConflict:'deal_id,party_role'"), true);
  assertEquals(source.includes("onConflict:'deal_id,party_role,party_id'"), false);
});
