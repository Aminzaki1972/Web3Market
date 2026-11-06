import { assertEquals } from "jsr:@std/assert@1";
import {
  commitReleasePreparationOnlyAfterW3M,
  type PrelockPrepareCommitBinding,
} from "./prelock-prepare-commit-boundary.ts";
import type { PrelockSafePrepareResult } from "./prelock-safe-prepare-gate.ts";

const HASH = "0x" + "a".repeat(64);
const authorized: PrelockSafePrepareResult = {
  authorized: true,
  issues: [],
  phase: "PREPARE",
  dealId: "71000000-0000-4000-8000-000000000001",
  dealTermsHash: HASH,
  safeNonce: "7",
  readBlockNumber: "0x123",
  readBlockHash: HASH,
};

Deno.test("PREPARE commit boundary never calls write callback when W3M denies", async () => {
  let writes = 0;
  const denied = await commitReleasePreparationOnlyAfterW3M(
    { ...authorized, authorized: false, issues: ["W3M_EVIDENCE_INCOMPLETE"] },
    async () => { writes += 1; return "written"; },
  );
  assertEquals(denied.committed, false);
  assertEquals(writes, 0);
});

Deno.test("PREPARE commit boundary rejects missing or malformed nonce/hash/block binding", async () => {
  let writes = 0;
  const invalid = await commitReleasePreparationOnlyAfterW3M(
    { ...authorized, safeNonce: "07" },
    async () => { writes += 1; return "written"; },
  );
  assertEquals(invalid.committed, false);
  assertEquals(writes, 0);
});

Deno.test("PREPARE commit boundary forwards exact authorized nonce and canonical block binding once", async () => {
  let writes = 0;
  let captured: PrelockPrepareCommitBinding | null = null;
  const result = await commitReleasePreparationOnlyAfterW3M(authorized, async (binding) => {
    writes += 1;
    captured = binding;
    return "policy-and-pending-row-written";
  });
  assertEquals(result.committed, true);
  assertEquals(writes, 1);
  assertEquals(captured, {
    dealId: authorized.dealId,
    dealTermsHash: HASH,
    safeNonce: "7",
    readBlockNumber: "0x123",
    readBlockHash: HASH,
  });
});
