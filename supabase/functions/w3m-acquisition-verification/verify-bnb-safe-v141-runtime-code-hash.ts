import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";

const CHAIN_ID = "0x38";
const SAFE = "0x41675c099f32341bf84bfc5382af534df5c7461a";
const EXPECTED = "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4";
const endpoints = [
  Deno.env.get("BNB_RPC_URL"),
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.binance.org",
  "https://bsc-dataseed2.binance.org",
].filter((value): value is string => Boolean(value));

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (payload.error) throw new Error(`${method}: ${payload.error.message ?? "RPC error"}`);
  if (payload.result === undefined) throw new Error(`${method}: missing result`);
  return payload.result;
}

function bytesFromHex(value: string): Uint8Array {
  if (!/^0x(?:[0-9a-f]{2})+$/i.test(value)) throw new Error("RPC returned empty or malformed runtime bytecode");
  const bytes = new Uint8Array((value.length - 2) / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(value.slice(2 + i * 2, 4 + i * 2), 16);
  return bytes;
}

const failures: string[] = [];
for (const endpoint of endpoints) {
  try {
    const chainId = await rpc<string>(endpoint, "eth_chainId", []);
    if (chainId.toLowerCase() !== CHAIN_ID) throw new Error(`Wrong chain id: ${chainId}`);
    const blockNumber = await rpc<string>(endpoint, "eth_blockNumber", []);
    if (!/^0x[0-9a-f]+$/i.test(blockNumber)) throw new Error("Malformed latest block number");
    const before = await rpc<{ number: string; hash: string }>(endpoint, "eth_getBlockByNumber", [blockNumber, false]);
    if (before.number.toLowerCase() !== blockNumber.toLowerCase() || !/^0x[0-9a-f]{64}$/i.test(before.hash)) {
      throw new Error("Malformed canonical block header");
    }
    const code = await rpc<string>(endpoint, "eth_getCode", [SAFE, blockNumber]);
    const actual = "0x" + Array.from(keccak_256(bytesFromHex(code)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const after = await rpc<{ number: string; hash: string }>(endpoint, "eth_getBlockByNumber", [blockNumber, false]);
    if (after.hash.toLowerCase() !== before.hash.toLowerCase()) throw new Error("Pinned BNB block changed during code read");
    if (actual.toLowerCase() !== EXPECTED) {
      throw new Error(`Runtime code hash mismatch: expected ${EXPECTED}, received ${actual}`);
    }
    console.log("PASS: BNB Chain 56 Safe v1.4.1 singleton runtime bytecode matches official Safe deployment hash.");
    console.log(`Safe: ${SAFE}`);
    console.log(`Block: ${blockNumber} (${before.hash})`);
    console.log(`Runtime code hash: ${actual}`);
    Deno.exit(0);
  } catch (error) {
    failures.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
throw new Error("Could not independently verify Safe runtime bytecode against BNB RPC endpoints:\n" + failures.join("\n"));
