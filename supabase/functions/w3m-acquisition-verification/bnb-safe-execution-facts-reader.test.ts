import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";
import type { JsonRpcClient } from "./bnb-revenue-adapter.ts";
import { readCanonicalBnbSafeExecutionFacts } from "./bnb-safe-execution-facts-reader.ts";

const SAFE = "0x2222222222222222222222222222222222222222";
const BUYER = "0x5555555555555555555555555555555555555555";
const SELLER = "0x4444444444444444444444444444444444444444";
const HASH = "0x" + "a".repeat(64);
const BLOCK = "0x123456";
const BLOCK_HASH = "0x" + "9".repeat(64);

function selector(signature: string): string {
  return "0x" + Array.from(keccak_256(new TextEncoder().encode(signature)).slice(0, 4),
    (b) => b.toString(16).padStart(2, "0")).join("");
}
function word(value: bigint): string { return value.toString(16).padStart(64, "0"); }
function addressWord(value: string): string { return value.slice(2).toLowerCase().padStart(64, "0"); }
function stringResult(value: string): string {
  const body = Array.from(new TextEncoder().encode(value), (b) => b.toString(16).padStart(2, "0")).join("");
  return "0x" + word(32n) + word(BigInt(body.length / 2)) + body.padEnd(Math.ceil(body.length / 64) * 64, "0");
}
function ownersResult(): string {
  return "0x" + word(32n) + word(2n) + addressWord(BUYER) + addressWord(SELLER);
}
function makeRpc(reorg = false): { rpc: JsonRpcClient; calls: string[] } {
  const calls: string[] = [];
  let blockReads = 0;
  const rpc: JsonRpcClient = {
    async request<T>(method: string, params: unknown[]): Promise<T> {
      calls.push(method);
      let result: unknown;
      if (method === "eth_chainId") result = "0x38";
      else if (method === "eth_blockNumber") result = BLOCK;
      else if (method === "eth_getBlockByNumber") {
        blockReads++;
        result = {
          number: BLOCK,
          hash: reorg && blockReads > 1 ? "0x" + "8".repeat(64) : BLOCK_HASH,
        };
      } else if (method === "eth_getCode") result = "0x60006000";
      else if (method === "eth_call") {
        const data = String((params[0] as Record<string, unknown>).data);
        const sig = data.slice(0, 10).toLowerCase();
        if (sig === selector("getOwners()")) result = ownersResult();
        else if (sig === selector("getThreshold()")) result = "0x" + word(2n);
        else if (sig === selector("nonce()")) result = "0x" + word(7n);
        else if (sig === selector("VERSION()")) result = stringResult("1.4.1");
        else if (sig === selector("getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)")) result = HASH;
        else result = "0x";
      } else result = null;
      return result as T;
    },
  };
  return { rpc, calls };
}
const expected = {
  safeAddress: SAFE,
  expectedSafeAddress: SAFE,
  expectedOwners: [BUYER, SELLER],
  expectedThreshold: 2,
  expectedVersion: "1.4.1",
  expectedChainId: 56,
  expectedNonce: "7",
  storedSafeTransactionHash: HASH,
  transaction: {
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
  },
};

Deno.test("canonical BNB Safe snapshot reads all facts at one block and rechecks its hash", async () => {
  const { rpc, calls } = makeRpc();
  const result = await readCanonicalBnbSafeExecutionFacts(rpc, expected);
  assertEquals(result.valid, true);
  assertEquals(result.readBlockNumber, BLOCK);
  assertEquals(result.readBlockHash, BLOCK_HASH);
  assertEquals(calls.filter((method) => method === "eth_getBlockByNumber").length, 2);
});

Deno.test("canonical BNB Safe snapshot fails closed when the pinned block is reorged", async () => {
  const { rpc } = makeRpc(true);
  const result = await readCanonicalBnbSafeExecutionFacts(rpc, expected);
  assertEquals(result.valid, false);
  assertEquals(result.issues.includes("SAFE_READ_BLOCK_NOT_CANONICAL"), true);
});

Deno.test("canonical BNB Safe snapshot rejects malformed block headers", async () => {
  const rpc: JsonRpcClient = {
    async request<T>(method: string): Promise<T> {
      if (method === "eth_chainId") return "0x38" as T;
      if (method === "eth_blockNumber") return BLOCK as T;
      if (method === "eth_getBlockByNumber") return { number: BLOCK, hash: "0x12" } as T;
      throw new Error("Unexpected RPC method");
    },
  };
  await assertRejects(() => readCanonicalBnbSafeExecutionFacts(rpc, expected));
});
