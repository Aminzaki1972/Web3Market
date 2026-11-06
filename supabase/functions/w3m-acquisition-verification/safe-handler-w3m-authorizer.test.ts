import { assertEquals } from "jsr:@std/assert@1.0.14";
import { authorizeSafeHandlerPhase } from "./safe-handler-w3m-authorizer.ts";
import { executeSafePhaseOnlyAfterW3M } from "./safe-edge-w3m-phase-boundary.ts";

const verifier = async () => false;
const codeAudit = {
  auditId: "75000000-0000-4000-8000-000000000005",
  repositoryOwner: "Aminzaki1972",
  repositoryName: "Web3Market",
  repositoryUrl: "https://github.com/Aminzaki1972/Web3Market",
  commitSha: "c".repeat(40),
  auditType: "complete" as const,
  completedAt: "2026-11-05T00:00:00.000Z",
  auditEvidenceHash: "d".repeat(64),
};

const agreementBinding = {
  termsVersionId: "81000000-0000-4000-8000-000000000001",
  termsVersion: "2",
  termsHash: "e".repeat(64),
  buyerAcceptanceId: "82000000-0000-4000-8000-000000000002",
  sellerAcceptanceId: "83000000-0000-4000-8000-000000000003",
  buyerDigest: "0x" + "1".repeat(64),
  sellerDigest: "0x" + "2".repeat(64),
};

Deno.test("generic Safe execution snapshot authorizer refuses PREPARE and blocks protected action", async () => {
  let loaderCalls = 0;
  let actionCount = 0;
  const authorization = await authorizeSafeHandlerPhase(
    "PREPARE",
    async () => { loaderCalls += 1; throw new Error("must use dedicated prepare snapshot"); },
    verifier,
  );
  const result = await executeSafePhaseOnlyAfterW3M(
    "PREPARE",
    { dealId: "deal-1" },
    async () => authorization,
    async () => { actionCount += 1; },
  );
  assertEquals(authorization.authorized, false);
  assertEquals(authorization.issues, ["W3M_PREPARE_REQUIRES_PREPARE_SNAPSHOT_PATH"]);
  assertEquals(result.allowed, false);
  assertEquals(loaderCalls, 0);
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
    { dealId: "deal-1", safeTransactionHash: hash },
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

Deno.test("generic Safe execution authorizer refuses PREPARE even when a fresh context callback is supplied", async () => {
  let loaderCalls = 0;
  let actionCount = 0;
  const authorization = await authorizeSafeHandlerPhase(
    "PREPARE",
    async () => {
      loaderCalls += 1;
      return { client: {} as never, dealId: "deal-1", now: "2026-11-06T00:00:00.000Z", safeFacts: {} as never, codeAudit };
    },
    verifier,
  );
  const result = await executeSafePhaseOnlyAfterW3M(
    "PREPARE",
    { dealId: "deal-1" },
    async () => authorization,
    async () => { actionCount += 1; },
  );
  assertEquals(result.allowed, false);
  assertEquals(authorization.issues, ["W3M_PREPARE_REQUIRES_PREPARE_SNAPSHOT_PATH"]);
  assertEquals(loaderCalls, 0);
  assertEquals(actionCount, 0);
});


Deno.test("SIGN refuses a Safe hash that differs from the fresh database transaction row", async () => {
  const databaseHash = "0x" + "a".repeat(64);
  const requestedHash = "0x" + "b".repeat(64);
  const authorization = await authorizeSafeHandlerPhase(
    "SIGN",
    async () => ({
      client: {} as never,
      dealId: "deal-1",
      now: "2026-11-06T00:00:00.000Z",
      safeFacts: {} as never,
      codeAudit,
      safeTransactionHash: databaseHash,
      agreementBinding,
    }),
    verifier,
    requestedHash,
  );
  assertEquals(authorization.authorized, false);
  assertEquals(authorization.issues, ["W3M_SAFE_TRANSACTION_HASH_BINDING_MISMATCH"]);
  assertEquals(authorization.safeTransactionHash, databaseHash);
});

Deno.test("EXECUTE refuses a Safe hash that differs from the fresh database transaction row", async () => {
  const databaseHash = "0x" + "c".repeat(64);
  const requestedHash = "0x" + "d".repeat(64);
  const authorization = await authorizeSafeHandlerPhase(
    "EXECUTE",
    async () => ({
      client: {} as never,
      dealId: "deal-1",
      now: "2026-11-06T00:00:00.000Z",
      safeFacts: {} as never,
      codeAudit,
      safeTransactionHash: databaseHash,
      agreementBinding,
    }),
    verifier,
    requestedHash,
  );
  assertEquals(authorization.authorized, false);
  assertEquals(authorization.issues, ["W3M_SAFE_TRANSACTION_HASH_BINDING_MISMATCH"]);
  assertEquals(authorization.safeTransactionHash, databaseHash);
});


Deno.test("SIGN and EXECUTE require both immutable EIP-712 party acceptances", async () => {
  const hash = "0x" + "a".repeat(64);
  const authorization = await authorizeSafeHandlerPhase(
    "SIGN",
    async () => ({
      client: {} as never,
      dealId: "deal-1",
      now: "2026-11-06T00:00:00.000Z",
      safeFacts: {} as never,
      codeAudit,
      safeTransactionHash: hash,
      agreementBinding: undefined,
    }),
    verifier,
    hash,
  );
  assertEquals(authorization.authorized, false);
  assertEquals(authorization.issues, ["W3M_IMMUTABLE_PARTY_AGREEMENT_REQUIRED"]);
});

Deno.test("valid immutable agreement binding clears the agreement precondition", async () => {
  const hash = "0x" + "a".repeat(64);
  const authorization = await authorizeSafeHandlerPhase(
    "SIGN",
    async () => ({
      client: {} as never,
      dealId: "deal-1",
      now: "2026-11-06T00:00:00.000Z",
      safeFacts: {} as never,
      codeAudit,
      safeTransactionHash: hash,
      agreementBinding,
    }),
    verifier,
    hash,
  );
  assertEquals(authorization.authorized, false);
  assertEquals(authorization.issues.includes("W3M_IMMUTABLE_PARTY_AGREEMENT_REQUIRED"), false);
});
