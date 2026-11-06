import { assertEquals } from "jsr:@std/assert@1";
import {
  createW3MSafeWalletPackageRequestHandler,
} from "./safe-wallet-package-request-handler.ts";
import type { SafeExecutionFreshSnapshot } from "./safe-execution-coordinator.ts";
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";
import type { SafeWalletExecutionPackage } from "./safe-wallet-execution-package.ts";

const ACTOR = "23000000-0000-4000-8000-000000000003";
const DEAL = "81000000-0000-4000-8000-000000000001";
const ATTEMPT = "24000000-0000-4000-8000-000000000004";
const HASH = "0x" + "a".repeat(64);
const EXPIRY = "2026-11-06T12:01:30.000Z";

function snapshot(): SafeExecutionFreshSnapshot {
  return {
    dealId: DEAL,
    transactionId: "82000000-0000-4000-8000-000000000002",
    reportId: "83000000-0000-4000-8000-000000000003",
    reportVersion: 1,
    executorRef: ACTOR,
    idempotencyKey: "w3m-package-idempotency-key-0001",
    executorWallet: "0x2222222222222222222222222222222222222222",
    agreementBinding: {
      termsVersionId: "84000000-0000-4000-8000-000000000004",
      termsVersion: "1",
      termsHash: "f".repeat(64),
      buyerAcceptanceId: "85000000-0000-4000-8000-000000000005",
      sellerAcceptanceId: "86000000-0000-4000-8000-000000000006",
      buyerDigest: "0x" + "1".repeat(64),
      sellerDigest: "0x" + "2".repeat(64),
    },
    guardInput: {} as SafeExecutionFreshSnapshot["guardInput"],
  };
}
function packageValue(dealId = DEAL): SafeWalletExecutionPackage {
  return {
    protocol: "W3M_PROTOCOL_V1",
    chainId: 56,
    dealId,
    transactionId: "82000000-0000-4000-8000-000000000002",
    reportId: "83000000-0000-4000-8000-000000000003",
    reportVersion: 1,
    agreementTermsVersionId: "84000000-0000-4000-8000-000000000004",
    agreementTermsHash: "f".repeat(64),
    safeAddress: "0x1111111111111111111111111111111111111111",
    executorWallet: "0x2222222222222222222222222222222222222222",
    safeOwners: [
      "0x2222222222222222222222222222222222222222",
      "0x3333333333333333333333333333333333333333",
      "0x4444444444444444444444444444444444444444",
    ],
    safeTransactionHash: HASH,
    safeVersion: "1.3.0",
    readBlockNumber: "90000000",
    readBlockHash: "0x" + "9".repeat(64),
    issuedAt: "2026-11-06T12:00:00.000Z",
    expiresAt: EXPIRY,
    call: {
      to: "0x2222222222222222222222222222222222222222",
      value: "0", data: "0x", operation: 1, safeTxGas: "0",
      baseGas: "0", gasPrice: "0",
      gasToken: "0x0000000000000000000000000000000000000000",
      refundReceiver: "0x0000000000000000000000000000000000000000",
      nonce: "7",
    },
    signatures: [],
    requiredSignatures: 2,
  };
}
function req(body: unknown, method = "POST") {
  return new Request("https://isolated.invalid/package", {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

Deno.test("wallet package endpoint accepts only authenticated deal requests and ignores client actor fields", async () => {
  const calls: string[] = [];
  let loads = 0;
  const pkg = packageValue();
  const rpc: W3MRpcClient = {
    async rpc(name, args) {
      calls.push(name);
      if (name === "w3m_claim_safe_execution_attempt") return {
        data: { attempt_id: ATTEMPT, state: "CLAIMED", claimed: true, idempotent_replay: false },
        error: null,
      };
      if (name === "w3m_issue_safe_execution_package") return {
        data: {
          issued: true, idempotent_replay: false, attempt_id: ATTEMPT,
          package_hash: String(args.p_package_hash), expires_at: EXPIRY, package: pkg,
        }, error: null,
      };
      return { data: { updated: true, idempotent_replay: false, state: "RECONCILIATION_REQUIRED" }, error: null };
    },
  };
  const handler = createW3MSafeWalletPackageRequestHandler({
    authenticate: async () => ({ userId: ACTOR }),
    loadFresh: async (actorId, dealId) => {
      assertEquals(actorId, ACTOR);
      assertEquals(dealId, DEAL);
      loads++;
      return snapshot();
    },
    loadLiveFacts: async () => ({} as never),
    rpc,
    now: () => Date.parse("2026-11-06T12:00:00.000Z"),
    buildPackage: async () => pkg,
  });
  const response = await handler(req({ deal_id: DEAL, actor_id: "attacker-controlled" }));
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.state, "PACKAGE_ISSUED");
  assertEquals(body.package, pkg);
  assertEquals(loads, 2);
  assertEquals(calls, ["w3m_claim_safe_execution_attempt", "w3m_issue_safe_execution_package"]);
});

Deno.test("wallet package endpoint rejects unauthenticated or malformed requests before RPC", async () => {
  let rpcCalls = 0;
  const rpc: W3MRpcClient = {
    async rpc() { rpcCalls++; return { data: null, error: null }; },
  };
  const handler = createW3MSafeWalletPackageRequestHandler({
    authenticate: async () => null,
    loadFresh: async () => snapshot(),
    loadLiveFacts: async () => ({} as never),
    rpc,
    buildPackage: async () => packageValue(),
  });
  assertEquals((await handler(req({ deal_id: DEAL }))).status, 401);
  const authenticated = createW3MSafeWalletPackageRequestHandler({
    authenticate: async () => ({ userId: ACTOR }),
    loadFresh: async () => snapshot(),
    loadLiveFacts: async () => ({} as never),
    rpc,
    buildPackage: async () => packageValue(),
  });
  assertEquals((await authenticated(req({ deal_id: "bad" }))).status, 400);
  assertEquals((await authenticated(req({}, "GET"))).status, 405);
  assertEquals(rpcCalls, 0);
});

Deno.test("changed Safe package between claim and issuance enters reconciliation and is not returned", async () => {
  const calls: string[] = [];
  let loads = 0;
  const rpc: W3MRpcClient = {
    async rpc(name) {
      calls.push(name);
      if (name === "w3m_claim_safe_execution_attempt") return {
        data: { attempt_id: ATTEMPT, state: "CLAIMED", claimed: true, idempotent_replay: false },
        error: null,
      };
      return { data: { updated: true, idempotent_replay: false, state: "RECONCILIATION_REQUIRED" }, error: null };
    },
  };
  const handler = createW3MSafeWalletPackageRequestHandler({
    authenticate: async () => ({ userId: ACTOR }),
    loadFresh: async () => { loads++; return snapshot(); },
    loadLiveFacts: async () => ({} as never),
    rpc,
    now: () => Date.parse("2026-11-06T12:00:00.000Z"),
    buildPackage: async () => packageValue(loads === 1 ? DEAL : "88000000-0000-4000-8000-000000000008"),
  });
  const response = await handler(req({ deal_id: DEAL }));
  const body = await response.json();
  assertEquals(response.status, 409);
  assertEquals(body.state, "RECONCILIATION_REQUIRED");
  assertEquals(calls, [
    "w3m_claim_safe_execution_attempt",
    "w3m_mark_safe_execution_reconciliation_required",
  ]);
});
