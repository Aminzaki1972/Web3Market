import { assertEquals } from "jsr:@std/assert@1.0.14";
import { authorizeSafeHandlerPhase } from "./safe-handler-w3m-authorizer.ts";
import { executeSafePhaseOnlyAfterW3M } from "./safe-edge-w3m-phase-boundary.ts";

const verifier = async () => false;

Deno.test("fresh Deal Room read failure denies PREPARE and blocks protected action", async () => {
  let actionCount = 0;
  const authorization = await authorizeSafeHandlerPhase(
    "PREPARE",
    async () => { throw new Error("database unavailable"); },
    verifier,
  );
  const result = await executeSafePhaseOnlyAfterW3M(
    "PREPARE",
    async () => authorization,
    async () => { actionCount += 1; },
  );
  assertEquals(authorization.authorized, false);
  assertEquals(authorization.issues, ["W3M_FRESH_AUTHORIZATION_READ_FAILED"]);
  assertEquals(result.allowed, false);
  assertEquals(actionCount, 0);
});

Deno.test("EXECUTE read failure remains denied and preserves exact phase binding", async () => {
  const hash = "0x" + "a".repeat(64);
  const authorization = await authorizeSafeHandlerPhase(
    "EXECUTE",
    async () => { throw new Error("stale context"); },
    verifier,
    hash,
  );
  const result = await executeSafePhaseOnlyAfterW3M(
    "EXECUTE",
    async () => authorization,
    async () => "broadcast",
  );
  assertEquals(authorization.phase, "EXECUTE");
  assertEquals(authorization.safeTransactionHash, hash);
  assertEquals(result.allowed, false);
});

Deno.test("FINALIZE cannot pass through the pre-execution Deal Room authorizer", async () => {
  let loaderCalls = 0;
  const authorization = await authorizeSafeHandlerPhase(
    "FINALIZE",
    async () => {
      loaderCalls += 1;
      throw new Error("must not load as ordinary gate");
    },
    verifier,
    "0x" + "b".repeat(64),
  );
  assertEquals(authorization.authorized, false);
  assertEquals(authorization.issues, ["W3M_FINALIZATION_REQUIRES_VERIFIED_RECEIPT"]);
  assertEquals(loaderCalls, 0);
});

Deno.test("missing deal context denies without calling the protected action", async () => {
  let actionCount = 0;
  const authorization = await authorizeSafeHandlerPhase(
    "PREPARE",
    async () => ({
      client: {} as never,
      dealId: "",
      now: "2026-11-06T00:00:00.000Z",
      safeFacts: {} as never,
    }),
    verifier,
  );
  const result = await executeSafePhaseOnlyAfterW3M(
    "PREPARE",
    async () => authorization,
    async () => { actionCount += 1; },
  );
  assertEquals(result.allowed, false);
  assertEquals(actionCount, 0);
});
