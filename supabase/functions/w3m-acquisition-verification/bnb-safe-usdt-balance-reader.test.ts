import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readCanonicalBnbUsdtBalance } from "./bnb-safe-usdt-balance-reader.ts";
import type { JsonRpcClient } from "./bnb-revenue-adapter.ts";

const SAFE = "0x1111111111111111111111111111111111111111";
const BLOCK = "0x123";
const HASH = "0x" + "a".repeat(64);
const BALANCE = "0x" + (12500000000000000000n).toString(16).padStart(64, "0");

function rpcWith(handler: (method: string, params: unknown[]) => unknown): JsonRpcClient {
  return { async request<T>(method: string, params: unknown[]): Promise<T> {
    return handler(method, params) as T;
  } };
}

Deno.test("reads USDT balance at exact canonical Safe snapshot block", async () => {
  const calls: Array<[string, unknown[]]> = [];
  const rpc = rpcWith((method, params) => {
    calls.push([method, params]);
    if (method === "eth_chainId") return "0x38";
    if (method === "eth_getBlockByNumber") return { number: BLOCK, hash: HASH };
    if (method === "eth_call") {
      assertEquals(params[0], {
        to: "0x55d398326f99059ff775485246999027b3197955",
        data: "0x70a08231" + SAFE.slice(2).toLowerCase().padStart(64, "0"),
      });
      assertEquals(params[1], BLOCK);
      return BALANCE;
    }
    throw new Error("unexpected RPC method " + method);
  });
  const result = await readCanonicalBnbUsdtBalance(rpc, { safeAddress: SAFE, blockNumber: "291", blockHash: HASH });
  assertEquals(result.balance, "12.5");
  assertEquals(result.balanceBaseUnits, "12500000000000000000");
  assertEquals(calls.filter(([m]) => m === "eth_getBlockByNumber").length, 2);
});

Deno.test("rejects wrong chain before reading balance", async () => {
  const rpc = rpcWith((method) => method === "eth_chainId" ? "0x1" : (() => { throw new Error("must not read"); })());
  await assertRejects(() => readCanonicalBnbUsdtBalance(rpc, { safeAddress: SAFE, blockNumber: "291", blockHash: HASH }), Error, "BNB Chain");
});

Deno.test("rejects a non-canonical or changed snapshot block", async () => {
  let reads = 0;
  const rpc = rpcWith((method) => {
    if (method === "eth_chainId") return "0x38";
    if (method === "eth_getBlockByNumber") {
      reads++;
      return { number: BLOCK, hash: reads === 1 ? HASH : "0x" + "b".repeat(64) };
    }
    if (method === "eth_call") return BALANCE;
    throw new Error("unexpected RPC method");
  });
  await assertRejects(() => readCanonicalBnbUsdtBalance(rpc, { safeAddress: SAFE, blockNumber: "291", blockHash: HASH }), Error, "changed during read");
});

Deno.test("rejects malformed balanceOf response", async () => {
  const rpc = rpcWith((method) => {
    if (method === "eth_chainId") return "0x38";
    if (method === "eth_getBlockByNumber") return { number: BLOCK, hash: HASH };
    if (method === "eth_call") return "0x01";
    throw new Error("unexpected RPC method");
  });
  await assertRejects(() => readCanonicalBnbUsdtBalance(rpc, { safeAddress: SAFE, blockNumber: "291", blockHash: HASH }), Error, "malformed data");
});
