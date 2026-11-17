import { assertEquals } from "jsr:@std/assert@1";
import {
  executePrelockPrepareOnlyAfterW3M,
} from "./prelock-safe-prepare-boundary.ts";
import type { PrelockSafePrepareDependencies } from "./prelock-safe-prepare-gate.ts";

const DEAL = "71000000-0000-4000-8000-000000000001";
const dependencies = {
  database: {
    rpc: async () => ({ data: null, error: new Error("database unavailable") }),
  },
  readSafeConfiguration: async () => {
    throw new Error("Safe reader must not run after snapshot failure");
  },
} as unknown as PrelockSafePrepareDependencies;

Deno.test("pre-lock side-effect boundary never writes when the fresh W3M gate denies", async () => {
  let writes = 0;
  const result = await executePrelockPrepareOnlyAfterW3M(
    dependencies,
    DEAL,
    "2026-11-06T00:00:00.000Z",
    async () => false,
    async () => {
      writes += 1;
      return "must-not-run";
    },
  );
  assertEquals(result.allowed, false);
  assertEquals(result.authorization.authorized, false);
  assertEquals(writes, 0);
});
