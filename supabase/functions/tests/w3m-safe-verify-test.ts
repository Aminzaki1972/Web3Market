import { assertEquals } from "jsr:@std/assert@1.0.14";
import { keccak256 } from "npm:viem@2.37.6";
import {
  handleW3MSafeVerify,
  type W3MSafeVerifyDependencies,
} from "../w3m-safe-verify/index.ts";
import { W3M_PLATFORM_WALLET } from "../_shared/w3m-safe-verification-context.ts";
import type { W3MSafeAuthenticityExpected } from "../_shared/w3m-safe-authenticity.ts";

const DEAL_ID = "00000000-0000-4000-8000-000000000001";
const BUYER_ID = "buyer-user";
const SELLER_ID = "seller-user";
const OTHER_ID = "unrelated-user";
const BUYER_WALLET = "0x1111111111111111111111111111111111111111";
const SELLER_WALLET = "0x2222222222222222222222222222222222222222";
const SAFE_ADDRESS = "0x3333333333333333333333333333333333333333";
const SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const OTHER_SINGLETON = "0x9999999999999999999999999999999999999999";
const PROXY_CODE = "0x608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033";
const SINGLETON_CODE = "0x6000600055";
const FACTORY_CODE = "0x6001600055";
const word = (address: string) => `0x${"0".repeat(24)}${address.slice(2)}`;

const TEST_EXPECTED_AUTHENTICITY: W3MSafeAuthenticityExpected = {
  chainId: 56,
  proxyRuntimeHash: keccak256(PROXY_CODE),
  singletonAddress: SINGLETON,
  singletonRuntimeHash: keccak256(SINGLETON_CODE),
  factoryAddress: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  factoryRuntimeHash: keccak256(FACTORY_CODE),
};

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
    readSafeAuthenticity: async () => ({
      proxyCode: PROXY_CODE,
      singletonCode: SINGLETON_CODE,
      factoryCode: FACTORY_CODE,
      singletonStorage: word(SINGLETON),
      masterCopy: word(SINGLETON),
    }),
    readSafePolicy: async () => ({
      owners: [BUYER_WALLET, SELLER_WALLET, W3M_PLATFORM_WALLET],
      threshold: 2n,
    }),
    expectedAuthenticity: TEST_EXPECTED_AUTHENTICITY,
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
  const response = await handleW3MSafeVerify(request(), makeDeps({
    loadDeal: async () => ({ deal: null }),
  }));
  assertEquals(response.status, 404);
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

Deno.test("Safe verifier rejects counterfeit proxy before reading owner policy", async () => {
  let policyRead = false;
  const response = await handleW3MSafeVerify(request(), makeDeps({
    readSafeAuthenticity: async () => ({
      proxyCode: "0x60006000",
      singletonCode: SINGLETON_CODE,
      factoryCode: FACTORY_CODE,
      singletonStorage: word(SINGLETON),
      masterCopy: word(SINGLETON),
    }),
    readSafePolicy: async () => {
      policyRead = true;
      return { owners: [BUYER_WALLET, SELLER_WALLET, W3M_PLATFORM_WALLET], threshold: 2n };
    },
  }));
  assertEquals(response.status, 503);
  assertEquals((await response.json()).reason, "safe_proxy_runtime_hash_mismatch");
  assertEquals(policyRead, false);
});

Deno.test("Safe verifier rejects singleton slot mismatch before reading owner policy", async () => {
  let policyRead = false;
  const response = await handleW3MSafeVerify(request(), makeDeps({
    readSafeAuthenticity: async () => ({
      proxyCode: PROXY_CODE,
      singletonCode: SINGLETON_CODE,
      factoryCode: FACTORY_CODE,
      singletonStorage: word(OTHER_SINGLETON),
      masterCopy: word(SINGLETON),
    }),
    readSafePolicy: async () => {
      policyRead = true;
      return { owners: [BUYER_WALLET, SELLER_WALLET, W3M_PLATFORM_WALLET], threshold: 2n };
    },
  }));
  assertEquals(response.status, 503);
  assertEquals((await response.json()).reason, "safe_singleton_storage_mismatch");
  assertEquals(policyRead, false);
});

Deno.test("Safe verifier rejects a wrong Safe owner set or threshold", async () => {
  const response = await handleW3MSafeVerify(request(), makeDeps({
    readSafePolicy: async () => ({ owners: [BUYER_WALLET, SELLER_WALLET, OTHER_SINGLETON], threshold: 3n }),
  }));
  assertEquals(response.status, 409);
  assertEquals((await response.json()).reason, "owner_set_mismatch");
});

Deno.test("Safe verifier accepts authentic Safe v1.4.1 with exact 2-of-3 owner policy", async () => {
  const response = await handleW3MSafeVerify(request(), makeDeps());
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.ok, true);
  assertEquals(body.verified, true);
  assertEquals(body.safe_policy_verified, true);
  assertEquals(body.safe_address, SAFE_ADDRESS);
  assertEquals(body.chain_id, 56);
  assertEquals(body.owner_count, 3);
  assertEquals(body.threshold, "2");
  assertEquals(body.authenticity.proxy_runtime_hash, TEST_EXPECTED_AUTHENTICITY.proxyRuntimeHash);
  assertEquals(body.authenticity.singleton_address, SINGLETON.toLowerCase());
  assertEquals("release_allowed" in body, false);
});
