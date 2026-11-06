import { assertEquals } from "jsr:@std/assert@1";
import {
  createW3MSafeWalletSubmissionRequestHandler,
} from "./safe-wallet-submission-request-handler.ts";
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";

const ACTOR = "23000000-0000-4000-8000-000000000003";
const ATTEMPT = "24000000-0000-4000-8000-000000000004";
const PACKAGE_HASH = "c".repeat(64);
const TX_HASH = "0x" + "d".repeat(64);
function req(body: unknown, method = "POST") {
  return new Request("https://isolated.invalid/submit", {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

Deno.test("wallet submission derives actor from session and reports hash as unverified", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc: W3MRpcClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: {
        recorded: true, idempotent_replay: false, attempt_id: ATTEMPT,
        state: "BROADCAST", broadcast_tx_hash: TX_HASH,
      }, error: null };
    },
  };
  const handler = createW3MSafeWalletSubmissionRequestHandler({
    authenticate: async () => ({ userId: ACTOR }),
    rpc,
  });
  const response = await handler(req({
    attempt_id: ATTEMPT, package_hash: PACKAGE_HASH, transaction_hash: TX_HASH,
  }));
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.state, "BROADCAST_UNVERIFIED");
  assertEquals(body.receipt_verified, false);
  assertEquals(body.finalized, false);
  assertEquals(calls[0]?.name, "w3m_record_safe_wallet_submission");
  assertEquals(calls[0]?.args.p_actor_id, ACTOR);
});

Deno.test("wallet submission rejects unauthenticated, malformed, and non-POST requests before RPC", async () => {
  let calls = 0;
  const rpc: W3MRpcClient = {
    async rpc() { calls++; return { data: null, error: null }; },
  };
  const handler = createW3MSafeWalletSubmissionRequestHandler({
    authenticate: async () => null,
    rpc,
  });
  assertEquals((await handler(req({
    attempt_id: ATTEMPT, package_hash: PACKAGE_HASH, transaction_hash: TX_HASH,
  }))).status, 401);
  const authHandler = createW3MSafeWalletSubmissionRequestHandler({
    authenticate: async () => ({ userId: ACTOR }),
    rpc,
  });
  assertEquals((await authHandler(req({ attempt_id: "bad" }))).status, 400);
  assertEquals((await authHandler(req({}, "GET"))).status, 405);
  assertEquals(calls, 0);
});

Deno.test("wallet submission persistence errors fail closed without claiming verification", async () => {
  const rpc: W3MRpcClient = {
    async rpc() { return { data: null, error: new Error("rejected") }; },
  };
  const handler = createW3MSafeWalletSubmissionRequestHandler({
    authenticate: async () => ({ userId: ACTOR }),
    rpc,
  });
  const response = await handler(req({
    attempt_id: ATTEMPT, package_hash: PACKAGE_HASH, transaction_hash: TX_HASH,
  }));
  const body = await response.json();
  assertEquals(response.status, 409);
  assertEquals(body.error, "W3M_WALLET_SUBMISSION_REJECTED");
});


Deno.test("wallet submission rejects client-supplied authority fields before RPC", async () => {
  let calls = 0;
  const rpc: W3MRpcClient = { async rpc() { calls++; return { data: null, error: null }; } };
  const handler = createW3MSafeWalletSubmissionRequestHandler({
    authenticate: async () => ({ userId: ACTOR }),
    rpc,
  });
  const response = await handler(req({
    attempt_id: ATTEMPT, package_hash: PACKAGE_HASH, transaction_hash: TX_HASH,
    actor_id: "attacker",
  }));
  assertEquals(response.status, 400);
  assertEquals(calls, 0);
});