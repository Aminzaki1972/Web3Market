import { assertRejects } from "jsr:@std/assert@1";
import {
  loadFreshSafeHandlerContext,
  authorizeSafeHandlerPhaseFromFreshSources,
  type FreshSafeHandlerContextDependencies,
} from "./fresh-safe-handler-context.ts";

function dependencies(data: unknown): { value: FreshSafeHandlerContextDependencies; reads: string[] } {
  const reads: string[] = [];
  const database = {
    async rpc(name: string, args: Record<string, unknown>) {
      reads.push("db:" + name);
      if (name !== "w3m_read_safe_execution_snapshot") throw new Error("unexpected RPC");
      if (args.p_deal_id !== "71000000-0000-4000-8000-000000000001") {
        throw new Error("unexpected deal id");
      }
      return { data, error: null };
    },
    from() {
      throw new Error("registry reads must not occur before the DB snapshot is accepted");
    },
    request() {
      throw new Error("raw JSON-RPC is not used directly by this composer");
    },
  } as unknown as FreshSafeHandlerContextDependencies["database"];

  return {
    value: {
      database,
      async readSafeFacts() {
        reads.push("safe-facts");
        return {
          valid: true,
          chainId: 56,
          safeAddress: "0x2222222222222222222222222222222222222222",
          owners: [],
          threshold: 2,
          nonce: "7",
          version: "1.4.1",
          recomputedSafeTransactionHash: "0x" + "b".repeat(64),
          issues: [],
          readBlockNumber: "0x10",
          readBlockHash: "0x" + "c".repeat(64),
        };
      },
    },
    reads,
  };
}

Deno.test("fresh Safe context rejects a missing database snapshot before any chain read", async () => {
  const h = dependencies(null);
  await assertRejects(() => loadFreshSafeHandlerContext(
    h.value,
    "71000000-0000-4000-8000-000000000001",
    "2026-11-06T20:00:00.000Z",
  ));
  if (h.reads.includes("safe-facts")) throw new Error("chain read must not run after missing DB snapshot");
});

Deno.test("fresh Safe context rejects malformed snapshot before any chain read", async () => {
  const h = dependencies({});
  await assertRejects(() => loadFreshSafeHandlerContext(
    h.value,
    "71000000-0000-4000-8000-000000000001",
    "2026-11-06T20:00:00.000Z",
  ));
  if (h.reads.includes("safe-facts")) throw new Error("chain read must not run after malformed DB snapshot");
});

Deno.test("fresh Safe context rejects invalid time before database or chain reads", async () => {
  const h = dependencies(null);
  await assertRejects(() => loadFreshSafeHandlerContext(
    h.value,
    "71000000-0000-4000-8000-000000000001",
    "not-a-time",
  ));
  if (h.reads.length !== 0) throw new Error("invalid time must not trigger external reads");
});


Deno.test("phase authorizer blocks when fresh database context is unavailable", async () => {
  const h = dependencies(null);
  const result = await authorizeSafeHandlerPhaseFromFreshSources(
    "PREPARE",
    h.value,
    "71000000-0000-4000-8000-000000000001",
    "2026-11-06T20:00:00.000Z",
    async () => true,
  );
  if (result.authorized !== false ||
      !result.issues.includes("W3M_FRESH_AUTHORIZATION_READ_FAILED")) {
    throw new Error("Missing fresh database context must block PREPARE.");
  }
  if (h.reads.includes("safe-facts")) throw new Error("Safe facts must not be read without a database snapshot.");
});
