import { assertEquals } from "jsr:@std/assert@1.0.14";
import { executeSafePhaseOnlyAfterW3M } from "./safe-edge-w3m-phase-boundary.ts";

Deno.test("PREPARE requires fresh matching deal authorization", async () => {
  let count = 0;
  const result = await executeSafePhaseOnlyAfterW3M(
    "PREPARE",
    async () => ({ authorized: true, issues: [], phase: "PREPARE", dealId: "deal-1" }),
    async () => { count += 1; return "prepared"; },
  );
  assertEquals(result.allowed, true);
  assertEquals(count, 1);
});

Deno.test("phase mismatch blocks protected action", async () => {
  let count = 0;
  const result = await executeSafePhaseOnlyAfterW3M(
    "EXECUTE",
    async () => ({ authorized: true, issues: [], phase: "PREPARE", dealId: "deal-1", safeTransactionHash: "0x"+"1".repeat(64) }),
    async () => { count += 1; },
  );
  assertEquals(result.allowed, false);
  assertEquals(count, 0);
});

Deno.test("EXECUTE requires a 32-byte Safe transaction hash", async () => {
  let count = 0;
  const result = await executeSafePhaseOnlyAfterW3M(
    "EXECUTE",
    async () => ({ authorized: true, issues: [], phase: "EXECUTE", dealId: "deal-1", safeTransactionHash: "0x1234" }),
    async () => { count += 1; },
  );
  assertEquals(result.allowed, false);
  assertEquals(count, 0);
});

Deno.test("FINALIZE accepts only its own phase and exact transaction hash", async () => {
  const result = await executeSafePhaseOnlyAfterW3M(
    "FINALIZE",
    async () => ({ authorized: true, issues: [], phase: "FINALIZE", dealId: "deal-1", safeTransactionHash: "0x"+"a".repeat(64) }),
    async () => "finalized",
  );
  assertEquals(result.allowed, true);
  assertEquals(result.value, "finalized");
});

Deno.test("blank deal binding blocks protected action", async () => {
  let count = 0;
  const result = await executeSafePhaseOnlyAfterW3M(
    "PREPARE",
    async () => ({ authorized: true, issues: [], phase: "PREPARE", dealId: " " }),
    async () => { count += 1; },
  );
  assertEquals(result.allowed, false);
  assertEquals(count, 0);
});
