import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";
import type { JsonRpcClient } from "./bnb-revenue-adapter.ts";
import {
  BnbSafeLiveReadError,
  createBnbSafeLiveReadClient,
  createBnbSafeLiveReadClientAtCurrentBlock,
  getBnbSafeReadBlockTag,
} from "./bnb-safe-live-read-client.ts";

const SAFE = "0x2222222222222222222222222222222222222222";
const BLOCK = "0x123456";
const BUYER = "0x5555555555555555555555555555555555555555";
const SELLER = "0x4444444444444444444444444444444444444444";
const HASH = "0x" + "a".repeat(64);

function selector(signature: string): string {
  return "0x" + Array.from(
    keccak_256(new TextEncoder().encode(signature)).slice(0, 4),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}
function addressWord(value: string): string {
  return value.slice(2).toLowerCase().padStart(64, "0");
}
function stringResult(value: string): string {
  const body = Array.from(new TextEncoder().encode(value), (b) => b.toString(16).padStart(2, "0")).join("");
  return "0x" + word(32n) + word(BigInt(body.length / 2)) + body.padEnd(Math.ceil(body.length / 64) * 64, "0");
}
function ownersResult(owners: string[]): string {
  return "0x" + word(32n) + word(BigInt(owners.length)) + owners.map(addressWord).join("");
}

function mockRpc(overrides: Record<string, unknown> = {}): { rpc: JsonRpcClient; calls: Array<{method:string;params:unknown[]}> } {
  const calls: Array<{method:string;params:unknown[]}> = [];
  const rpc: JsonRpcClient = {
    async request<T>(method: string, params: unknown[]): Promise<T> {
      calls.push({ method, params });
      let result: unknown;
      if (method === "eth_chainId") result = "0x38";
      else if (method === "eth_blockNumber") result = "0x123456";
      else if (method === "eth_getCode") result = "0x60006000";
      else if (method === "eth_call") {
        const callData = String((params[0] as Record<string, unknown>).data);
        const sig = callData.slice(0, 10).toLowerCase();
        if (sig === selector("getOwners()")) result = ownersResult([BUYER, SELLER]);
        else if (sig === selector("getThreshold()")) result = "0x" + word(2n);
        else if (sig === selector("nonce()")) result = "0x" + word(7n);
        else if (sig === selector("VERSION()")) result = stringResult("1.4.1");
        else if (sig === selector("getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)")) {
          result = HASH;
        } else result = "0x";
      } else result = null;
      return (Object.hasOwn(overrides, method) ? overrides[method] : result) as T;
    },
  };
  return { rpc, calls };
}

const tx = {
  to: "0x9641d764fc13c8B624c04430C7356C1C7C8102e2",
  value: "0",
  data: "0x1234",
  operation: 1,
  safeTxGas: "0",
  baseGas: "0",
  gasPrice: "0",
  gasToken: "0x0000000000000000000000000000000000000000",
  refundReceiver: "0x0000000000000000000000000000000000000000",
  nonce: "7",
};

Deno.test("BNB Safe live reader pins every eth_call and code read to one block", async () => {
  const { rpc, calls } = mockRpc();
  const client = createBnbSafeLiveReadClient(rpc, BLOCK);
  assertEquals(await client.getChainId(), 56);
  assertEquals(await client.getCode(SAFE), "0x60006000");
  assertEquals(await client.getOwners(SAFE), [BUYER, SELLER]);
  assertEquals(await client.getThreshold(SAFE), 2n);
  assertEquals(await client.getNonce(SAFE), 7n);
  assertEquals(await client.getVersion(SAFE), "1.4.1");
  assertEquals(await client.getTransactionHash(SAFE, tx), HASH);
  assertEquals(calls.filter((call) => call.method === "eth_getCode").every((call) => call.params[1] === BLOCK), true);
  assertEquals(calls.filter((call) => call.method === "eth_call").every((call) => call.params[1] === BLOCK), true);
  assertEquals(client.blockTag, BLOCK);
});

Deno.test("Safe getTransactionHash call uses canonical ABI head and dynamic bytes tail", async () => {
  const { rpc, calls } = mockRpc();
  const client = createBnbSafeLiveReadClient(rpc, BLOCK);
  await client.getTransactionHash(SAFE, tx);
  const call = calls.find((entry) => entry.method === "eth_call")!;
  const data = String((call.params[0] as Record<string, unknown>).data).slice(2);
  assertEquals(data.slice(0, 8), selector("getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)").slice(2));
  // The third argument is dynamic bytes and points immediately after ten ABI words.
  assertEquals(data.slice(8 + 2 * 64, 8 + 3 * 64), word(320n));
  const tail = data.slice(8 + 10 * 64);
  assertEquals(tail.slice(0, 64), word(2n));
  assertEquals(tail.slice(64, 68), "1234");
});

Deno.test("Safe live reader rejects invalid block tags and malformed ABI results", async () => {
  await assertRejects(
    async () => { createBnbSafeLiveReadClient(mockRpc().rpc, "latest"); },
    BnbSafeLiveReadError,
  );
  const malformed = mockRpc({ eth_call: "0x01" });
  const client = createBnbSafeLiveReadClient(malformed.rpc, BLOCK);
  await assertRejects(() => client.getOwners(SAFE), BnbSafeLiveReadError);
});


Deno.test("BNB read client captures chain 56 block tag before contract reads", async () => {
  const { rpc, calls } = mockRpc();
  assertEquals(await getBnbSafeReadBlockTag(rpc), "0x123456");
  const client = await createBnbSafeLiveReadClientAtCurrentBlock(rpc);
  assertEquals(client.blockTag, "0x123456");
  assertEquals(calls.some((call) => call.method === "eth_blockNumber"), true);
  assertEquals(calls.filter((call) => call.method === "eth_chainId").length, 2);
});

Deno.test("BNB read client refuses wrong chain or malformed head block", async () => {
  const wrongChain = mockRpc({ eth_chainId: "0x61" });
  await assertRejects(() => getBnbSafeReadBlockTag(wrongChain.rpc), BnbSafeLiveReadError);
  const badHead = mockRpc({ eth_blockNumber: "latest" });
  await assertRejects(() => getBnbSafeReadBlockTag(badHead.rpc), BnbSafeLiveReadError);
});
