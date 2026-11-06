import { assertEquals } from "jsr:@std/assert@1";
import {
  authorizeAndCommitPrelockSafePrepare,
} from "./prelock-safe-prepare-commit.ts";
import type { PrelockPrepareDatabase, PrelockSafePrepareDependencies } from "./prelock-safe-prepare-gate.ts";
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";

const DEAL = "71000000-0000-4000-8000-000000000001";
Deno.test("PREPARE composition never calls atomic persistence when the fresh gate denies", async () => {
  const database = {
    async rpc(name: string) {
      if (name === "w3m_read_dealroom_terms_snapshot") return { data: [], error: null };
      if (name === "w3m_read_validated_release_policy") return { data: [], error: null };
      throw new Error("Unexpected read");
    },
  } as unknown as PrelockPrepareDatabase;
  const dependencies: PrelockSafePrepareDependencies = {
    database,
    async readSafeConfiguration() {
      throw new Error("Safe facts must not be read after a missing snapshot");
    },
  };
  let writes = 0;
  const persistence: W3MRpcClient = {
    async rpc() { writes++; return { data: null, error: null }; },
  };
  const result = await authorizeAndCommitPrelockSafePrepare(
    dependencies, persistence, DEAL, "82000000-0000-4000-8000-000000000002",
    "2026-11-06T00:00:00Z", async () => false,
  );
  assertEquals(result.allowed, false);
  assertEquals(result.authorization.issues, ["W3M_PRELOCK_DEAL_SNAPSHOT_UNAVAILABLE"]);
  assertEquals(writes, 0);
});
