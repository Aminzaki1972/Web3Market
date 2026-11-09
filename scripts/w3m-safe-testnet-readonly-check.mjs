#!/usr/bin/env node
// Read-only W3M Safe reference check against BNB Smart Chain Testnet.
// This script only calls eth_chainId and eth_getCode. It never signs or broadcasts.
const RPC_URLS = [
  "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
  "https://data-seed-prebsc-2-s1.bnbchain.org:8545",
  "https://data-seed-prebsc-1-s2.bnbchain.org:8545",
];

const EXPECTED_CHAIN_ID = "0x61";
const SAFE_REFERENCES = [
  ["Safe singleton", "0x41675C099F32341bf84BFc5382aF534df5C7461a"],
  ["Safe L2 singleton", "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762"],
  ["Safe Proxy Factory", "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67"],
  ["Compatibility Fallback Handler", "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99"],
  ["MultiSend", "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526"],
  ["MultiSend Call Only", "0x9641d764fc13c8B624c04430C7356C1C7C8102e2"],
  ["Sign Message Library", "0xd53cd0aB83D845Ac265BE939c57F53AD838012c9"],
  ["Simulate Tx Accessor", "0x3d4BA2E0884aa488718476ca2FB8Efc291A46199"],
  ["Create Call", "0x9b35Af71d77eaf8d7e40252370304687390A1A52"],
];

let requestId = 0;

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++requestId,
      method,
      params,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`${method}: ${payload.error.message || "RPC error"}`);
  if (!("result" in payload)) throw new Error(`${method}: missing JSON-RPC result`);
  return payload.result;
}

async function checkEndpoint(url) {
  const chainId = await rpc(url, "eth_chainId");
  if (String(chainId).toLowerCase() !== EXPECTED_CHAIN_ID) {
    throw new Error(`wrong chain ID ${chainId}; expected ${EXPECTED_CHAIN_ID}`);
  }

  const missing = [];
  for (const [name, address] of SAFE_REFERENCES) {
    const code = await rpc(url, "eth_getCode", [address, "latest"]);
    if (typeof code !== "string" || !/^0x[0-9a-f]+$/i.test(code) || code.toLowerCase() === "0x") {
      missing.push(name);
    }
  }
  if (missing.length) {
    throw new Error(`reference contract bytecode missing: ${missing.join(", ")}`);
  }

  return { chainId, checkedContracts: SAFE_REFERENCES.length };
}

let lastError;
for (const url of RPC_URLS) {
  try {
    const result = await checkEndpoint(url);
    console.log("W3M Safe Testnet read-only check: PASS");
    console.log(`RPC endpoint: ${url}`);
    console.log(`Chain ID: ${Number(result.chainId)}`);
    console.log(`Safe reference contracts with bytecode: ${result.checkedContracts}/${SAFE_REFERENCES.length}`);
    console.log("Methods used: eth_chainId, eth_getCode");
    console.log("No transaction was signed or broadcast.");
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.warn(`RPC check failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.error("W3M Safe Testnet read-only check: FAIL");
console.error(lastError instanceof Error ? lastError.message : String(lastError));
process.exit(1);
