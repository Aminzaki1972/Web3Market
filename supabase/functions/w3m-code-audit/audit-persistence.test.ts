import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { assertAuditWriteSucceeded } from "./audit-persistence.ts";

Deno.test("successful audit persistence result is accepted", () => {
  assertEquals(assertAuditWriteSucceeded({ error: null }, "save checkpoint"), undefined);
  assertEquals(assertAuditWriteSucceeded({}, "save checkpoint"), undefined);
});

Deno.test("database write error stops audit progress with contextual message", () => {
  assertThrows(
    () => assertAuditWriteSucceeded({ error: { message: "connection lost" } }, "save AI chunk"),
    Error,
    "save AI chunk: connection lost",
  );
});

Deno.test("database write error without message still fails closed", () => {
  assertThrows(
    () => assertAuditWriteSucceeded({ error: {} }, "save file progress"),
    Error,
    "save file progress: database write failed",
  );
});
