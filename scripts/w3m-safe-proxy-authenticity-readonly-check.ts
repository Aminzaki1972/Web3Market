// Read-only BNB Smart Chain mainnet Safe v1.4.1 authenticity candidate check.
// This script only uses eth_chainId, eth_getCode, eth_getStorageAt, and eth_call.
// It never signs, sends, or broadcasts a transaction.
import { keccak256, type Hex } from "npm:viem@2.37.6";

const RPC_URLS = [
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc-dataseed1.ninicoin.io",
];

const EXPECTED_CHAIN_ID = "0x38";
const PROXY = "0x91F10950303c6fdAC09c957ac7B1aae9A4B7F2e7";
const SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const EXPECTED_HASHES = {
  proxy: "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
  singleton: "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4",
  factory: "0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317",
};

let requestId = 0;
async function rpc(url: string, method: string, params: unknown[] = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`${method}: ${payload.error.message || "RPC error"}`);
  if (typeof payload.result !== "string") throw new Error(`${method}: missing string result`);
  return payload.result as Hex;
}

function addressFromWord(word: string): string {
  if (!/^0x[0-9a-f]{64}$/i.test(word)) throw new Error("malformed 32-byte storage/return word");
  return `0x${word.slice(-40)}`.toLowerCase();
}

async function check(url: string) {
  const chainId = await rpc(url, "eth_chainId");
  if (chainId.toLowerCase() !== EXPECTED_CHAIN_ID) throw new Error(`wrong chain ID ${chainId}`);

  const [proxyCode, singletonCode, factoryCode] = await Promise.all([
    rpc(url, "eth_getCode", [PROXY, "latest"]),
    rpc(url, "eth_getCode", [SINGLETON, "latest"]),
    rpc(url, "eth_getCode", [FACTORY, "latest"]),
  ]);
  for (const [label, code] of [["proxy", proxyCode], ["singleton", singletonCode], ["factory", factoryCode]] as const) {
    if (code === "0x" || !/^0x[0-9a-f]+$/i.test(code)) throw new Error(`${label}: empty or malformed runtime bytecode`);
  }

  const hashes = {
    proxy: keccak256(proxyCode),
    singleton: keccak256(singletonCode),
    factory: keccak256(factoryCode),
  };
  for (const key of ["proxy", "singleton", "factory"] as const) {
    if (hashes[key].toLowerCase() !== EXPECTED_HASHES[key]) {
      throw new Error(`${key} runtime hash mismatch: got ${hashes[key]}`);
    }
  }

  const [slot0, getter] = await Promise.all([
    rpc(url, "eth_getStorageAt", [PROXY, "0x0", "latest"]),
    rpc(url, "eth_call", [{ to: PROXY, data: "0xa619486e" }, "latest"]),
  ]);
  const slotAddress = addressFromWord(slot0);
  const getterAddress = addressFromWord(getter);
  if (slotAddress !== SINGLETON.toLowerCase()) throw new Error(`slot(0) singleton mismatch: ${slotAddress}`);
  if (getterAddress !== SINGLETON.toLowerCase()) throw new Error(`masterCopy() mismatch: ${getterAddress}`);
  if (slotAddress !== getterAddress) throw new Error("slot(0) and masterCopy() disagree");

  return { chainId, hashes, slotAddress, getterAddress };
}

let lastError: unknown;
for (const url of RPC_URLS) {
  try {
    const result = await check(url);
    console.log("W3M SafeProxy BNB mainnet read-only authenticity candidate: PASS");
    console.log(`RPC endpoint: ${url}`);
    console.log(`Chain ID: ${Number(result.chainId)}`);
    console.log(`Proxy runtime hash: ${result.hashes.proxy}`);
    console.log(`Singleton runtime hash: ${result.hashes.singleton}`);
    console.log(`Factory runtime hash: ${result.hashes.factory}`);
    console.log(`slot(0): ${result.slotAddress}`);
    console.log(`masterCopy(): ${result.getterAddress}`);
    console.log("Methods used: eth_chainId, eth_getCode, eth_getStorageAt, eth_call");
    console.log("No transaction was signed or broadcast.");
    Deno.exit(0);
  } catch (error) {
    lastError = error;
    console.warn(`RPC check failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.error("W3M SafeProxy BNB mainnet read-only authenticity candidate: FAIL");
console.error(lastError instanceof Error ? lastError.message : String(lastError));
Deno.exit(1);
