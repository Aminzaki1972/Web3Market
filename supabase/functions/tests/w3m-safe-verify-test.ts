import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  handleW3MSafeVerify,
  type W3MSafeVerifyDependencies,
} from "../w3m-safe-verify/index.ts";
import { W3M_PLATFORM_WALLET } from "../_shared/w3m-safe-verification-context.ts";

const DEAL_ID = "00000000-0000-4000-8000-000000000001";
const BUYER_ID = "buyer-user";
const SELLER_ID = "seller-user";
const OTHER_ID = "unrelated-user";
const BUYER_WALLET = "0x1111111111111111111111111111111111111111";
const SELLER_WALLET = "0x2222222222222222222222222222222222222222";
const SAFE_ADDRESS = "0x3333333333333333333333333333333333333333";
const VALID_CODE = "0x60006000";

function makeDeps(overrides: Partial<W3MSafeVerifyDependencies> = {}): W3MSafeVerifyDependencies {
  const deal = {
    id: DEAL_ID, buyer_id: BUYER_ID, seller_id: SELLER_ID,
    chain_id: 56, safe_address: SAFE_ADDRESS,
  };
  const records = {
    buyer: { wallet_address: BUYER_WALLET, wallet_verified: true },
    seller: { wallet_address: SELLER_WALLET, wallet_verified: true },
    policy: {
      seller_wallet: SELLER_WALLET,
      platform_wallet: W3M_PLATFORM_WALLET,
      safe_address: SAFE_ADDRESS,
      chain_id: 56,
    },
  };
  return {
    authenticate: async () => ({ userId: BUYER_ID }),
    loadDeal: async () => ({ deal }),
    loadOwnerRecords: async () => ({ records }),
    getRpcChainId: async () => 56,
    readSafe: async () => ({
      code: VALID_CODE,
      owners: [BUYER_WALLET, SELLER_WALLET, W3M_PLATFORM_WALLET],
      threshold: 2n,
      nonce: 7n,
    }),
    ...overrides,
  };
}

function request() {
  return new Request("https://local.test", {
    method: "POST",
    headers: {
      Authorization: "Bearer isolated-test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ deal_id: DEAL_ID }),
  });
}

Deno.test("Safe verifier answers CORS preflight without touching services", async () => {
  const response = await handleW3MSafeVerify(new Request("https://local.test", { method: "OPTIONS" }));
  assertEquals(response.status, 204);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "https://web3market.xyz");
  assertEquals(response.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
});

Deno.test("Safe verifier rejects non-POST methods before authentication", async () => {
  const response = await handleW3MSafeVerify(new Request("https://local.test", { method: "GET" }));
  assertEquals(response.status, 405);
  assertEquals((await response.json()).reason, "method_not_allowed");
});

Deno.test("Safe verifier fails closed when Authorization is absent", async () => {
  const response = await handleW3MSafeVerify(new Request("https://local.test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deal_id: DEAL_ID }),
  }));
  assertEquals(response.status, 401);
  assertEquals((await response.json()).reason, "authentication_required");
});

Deno.test("Safe verifier rejects malformed JSON before dependency initialization", async () => {
  const response = await handleW3MSafeVerify(new Request("https://local.test", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: "{",
  }));
  assertEquals(response.status, 400);
  assertEquals((await response.json()).reason, "invalid_deal_id");
});

Deno.test("Safe verifier rejects a missing deal ID before dependency initialization", async () => {
  const response = await handleW3MSafeVerify(new Request("https://local.test", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }));
  assertEquals(response.status, 400);
  assertEquals((await response.json()).reason, "invalid_deal_id");
});

Deno.test("Safe verifier rejects a malformed deal ID before dependency initialization", async () => {
  const response = await handleW3MSafeVerify(new Request("https://local.test", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ deal_id: "not-a-uuid" }),
  }));
  assertEquals(response.status, 400);
  assertEquals((await response.json()).reason, "invalid_deal_id");
});

Deno.test("Safe verifier rejects an invalid authenticated session", async () => {
  const response = await handleW3MSafeVerify(request(), makeDeps({
    authenticate: async () => ({ userId: null, error: true }),
  }));
  assertEquals(response.status, 401);
  assertEquals((await response.json()).reason, "invalid_session");
});

Deno.test("Safe verifier rejects a user who is not a deal participant", async () => {
  const response = await handleW3MSafeVerify(request(), makeDeps({
    authenticate: async () => ({ userId: OTHER_ID }),
  }));
  assertEquals(response.status, 403);
  assertEquals((await response.json()).reason, "not_a_deal_participant");
});

Deno.test("Safe verifier fails closed when the deal lookup fails", async () => {
  const response = await handleW3MSafeVerify(request(), makeDeps({
    loadDeal: async () => ({ deal: null, error: true }),
  }));
  assertEquals(response.status, 503);
  assertEquals((await response.json()).reason, "deal_lookup_failed");
});

Deno.test("Safe verifier returns not found for an unknown deal", async () => {
  const response = await handleW3MSafeVerify(request(), makeDeps({
    loadDeal: async () => ({ deal: null }),
  }));
  assertEquals(response.status, 404);
  assertEquals((await response.json()).reason, "deal_not_found");
});

Deno.test("Safe verifier rejects incomplete owner or release-policy records", async () => {
  const response = await handleW3MSafeVerify(request(), makeDeps({
    loadOwnerRecords: async () => ({ records: null, error: true }),
  }));
  assertEquals(response.status, 503);
  assertEquals((await response.json()).reason, "expected_owner_records_unavailable");
});

Deno.test("Safe verifier rejects a deal assigned to the wrong chain before RPC reads", async () => {
  let rpcCalled = false;
  const response = await handleW3MSafeVerify(request(), makeDeps({
    loadDeal: async () => ({
      deal: { id: DEAL_ID, buyer_id: BUYER_ID, seller_id: SELLER_ID, chain_id: 97, safe_address: SAFE_ADDRESS },
    }),
    getRpcChainId: async () => { rpcCalled = true; return 56; },
  }));
  assertEquals(response.status, 409);
  assertEquals((await response.json()).reason, "deal_chain_mismatch");
  assertEquals(rpcCalled, false);
});

Deno.test("Safe verifier rejects an RPC connected to the wrong chain", async () => {
  const response = await handleW3MSafeVerify(request(), makeDeps({
    getRpcChainId: async () => 97,
  }));
  assertEquals(response.status, 503);
  assertEquals((await response.json()).reason, "bsc_rpc_chain_mismatch");
});

Deno.test("Safe verifier fails closed when RPC is unavailable", async () => {
  const response = await handleW3MSafeVerify(request(), makeDeps({
    getRpcChainId: async () => { throw new Error("RPC unavailable"); },
  }));
  assertEquals(response.status, 503);
  assertEquals((await response.json()).reason, "safe_verification_unavailable");
});

Deno.test("Safe verifier blocks before Safe reads while the authentic proxy hash is unapproved", async () => {
  let safeReadCalled = false;
  const response = await handleW3MSafeVerify(request(), makeDeps({
    readSafe: async () => {
      safeReadCalled = true;
      return {
        code: VALID_CODE,
        owners: [BUYER_WALLET, SELLER_WALLET, W3M_PLATFORM_WALLET],
        threshold: 2n,
        nonce: 7n,
      };
    },
  }));
  const body = await response.json();
  assertEquals(response.status, 503);
  assertEquals(body.ok, false);
  assertEquals(body.verified, false);
  assertEquals(body.safe_policy_verified, false);
  assertEquals(body.reason, "SAFE_AUTHENTICITY_UNVERIFIED");
  assertEquals(safeReadCalled, false);
});

Deno.test("Safe verifier never treats arbitrary non-empty bytecode as an authentic Safe", async () => {
  let safeReadCalled = false;
  const response = await handleW3MSafeVerify(request(), makeDeps({
    readSafe: async () => {
      safeReadCalled = true;
      return {
        code: VALID_CODE,
        owners: [BUYER_WALLET, SELLER_WALLET, W3M_PLATFORM_WALLET],
        threshold: 2n,
        nonce: 7n,
      };
    },
  }));
  const body = await response.json();
  assertEquals(response.status, 503);
  assertEquals(body.reason, "SAFE_AUTHENTICITY_UNVERIFIED");
  assertEquals(safeReadCalled, false);
});
