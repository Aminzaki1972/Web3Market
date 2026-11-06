import { assertEquals } from "jsr:@std/assert@1.0.14";
import { executeSafePhaseOnlyAfterW3M } from "./safe-edge-w3m-phase-boundary.ts";

const deal = "71000000-0000-4000-8000-000000000001";
const hash = "0x" + "a".repeat(64);

Deno.test("PREPARE requires fresh authorization for the exact requested deal", async () => {
  let count = 0;
  const result = await executeSafePhaseOnlyAfterW3M(
    "PREPARE", { dealId: deal },
    async () => ({ authorized: true, issues: [], phase: "PREPARE", dealId: deal }),
    async () => { count += 1; return "prepared"; },
  );
  assertEquals(result.allowed, true);
  assertEquals(count, 1);
});

Deno.test("phase mismatch blocks protected action", async () => {
  let count = 0;
  const result = await executeSafePhaseOnlyAfterW3M(
    "EXECUTE", { dealId: deal, safeTransactionHash: hash },
    async () => ({ authorized: true, issues: [], phase: "PREPARE", dealId: deal, safeTransactionHash: hash }),
    async () => { count += 1; },
  );
  assertEquals(result.allowed, false);
  assertEquals(count, 0);
});

Deno.test("authorization for a different deal cannot authorize the requested deal", async () => {
  let count = 0;
  const result = await executeSafePhaseOnlyAfterW3M(
    "PREPARE", { dealId: deal },
    async () => ({ authorized: true, issues: [], phase: "PREPARE", dealId: "another-deal" }),
    async () => { count += 1; },
  );
  assertEquals(result.allowed, false);
  assertEquals(result.authorization.issues, ["W3M_PHASE_OR_BINDING_MISMATCH"]);
  assertEquals(count, 0);
});

Deno.test("SIGN requires the exact expected Safe transaction hash", async () => {
  let count = 0;
  const result = await executeSafePhaseOnlyAfterW3M(
    "SIGN", { dealId: deal, safeTransactionHash: hash },
    async () => ({ authorized: true, issues: [], phase: "SIGN", dealId: deal, safeTransactionHash: "0x" + "b".repeat(64) }),
    async () => { count += 1; },
  );
  assertEquals(result.allowed, false);
  assertEquals(count, 0);
});

Deno.test("EXECUTE requires exact deal and exact 32-byte Safe transaction hash", async () => {
  let count = 0;
  const result = await executeSafePhaseOnlyAfterW3M(
    "EXECUTE", { dealId: deal, safeTransactionHash: hash },
    async () => ({ authorized: true, issues: [], phase: "EXECUTE", dealId: deal, safeTransactionHash: "0x1234" }),
    async () => { count += 1; },
  );
  assertEquals(result.allowed, false);
  assertEquals(count, 0);
});

Deno.test("FINALIZE accepts only its own phase and exact transaction hash", async () => {
  const result = await executeSafePhaseOnlyAfterW3M(
    "FINALIZE", { dealId: deal, safeTransactionHash: hash },
    async () => ({ authorized: true, issues: [], phase: "FINALIZE", dealId: deal, safeTransactionHash: hash.toUpperCase().replace("0X", "0x") }),
    async () => "finalized",
  );
  assertEquals(result.allowed, true);
  assertEquals(result.value, "finalized");
});

Deno.test("blank expected deal binding blocks protected action before authorization", async () => {
  let authorizationCalls = 0;
  let actionCount = 0;
  const result = await executeSafePhaseOnlyAfterW3M(
    "PREPARE", { dealId: " " },
    async () => { authorizationCalls += 1; return { authorized: true, issues: [], phase: "PREPARE", dealId: deal }; },
    async () => { actionCount += 1; },
  );
  assertEquals(result.allowed, false);
  assertEquals(authorizationCalls, 0);
  assertEquals(actionCount, 0);
});


Deno.test("FINALIZE is never authorized by the pre-execution phase boundary", async () => {
  let authorizationCalls = 0;
  let actionCalls = 0;
  const result = await executeSafePhaseOnlyAfterW3M(
    "FINALIZE", { dealId: deal, safeTransactionHash: hash },
    async () => {
      authorizationCalls += 1;
      return { authorized: true, issues: [], phase: "FINALIZE", dealId: deal, safeTransactionHash: hash };
    },
    async () => { actionCalls += 1; },
  );
  assertEquals(result.allowed, false);
  assertEquals(result.authorization.issues, ["W3M_FINALIZE_REQUIRES_VERIFIED_RECEIPT_PATH"]);
  assertEquals(authorizationCalls, 0);
  assertEquals(actionCalls, 0);
});


Deno.test("unknown phase values are rejected before fresh authorization", async () => {
  let authorizationCalls = 0;
  let actionCalls = 0;
  const result = await executeSafePhaseOnlyAfterW3M(
    "UNKNOWN" as never, { dealId: deal, safeTransactionHash: hash },
    async () => {
      authorizationCalls += 1;
      return { authorized: true, issues: [], phase: "EXECUTE", dealId: deal, safeTransactionHash: hash };
    },
    async () => { actionCalls += 1; },
  );
  assertEquals(result.allowed, false);
  assertEquals(result.authorization.issues, ["W3M_PHASE_INVALID"]);
  assertEquals(authorizationCalls, 0);
  assertEquals(actionCalls, 0);
});
