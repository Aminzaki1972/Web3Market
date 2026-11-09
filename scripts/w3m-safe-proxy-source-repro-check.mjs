// Rebuild SafeProxy runtime from immutable Safe v1.4.1 source and compare it
// with the BNB Mainnet runtime hash observed by the read-only RPC check.
import { createHash } from "node:crypto";
import solc from "solc";
import { keccak256 } from "viem";

const SOURCE_URL = "https://raw.githubusercontent.com/safe-fndn/safe-smart-account/bf943f80fec5ac647159d26161446ac5d716a294/contracts/proxies/SafeProxy.sol";
const EXPECTED_GIT_BLOB = "eb21260363a19f1a35ef34e323761e63cf5600e3";
const EXPECTED_SOLC = "0.7.6+commit.7338295f";
const EXPECTED_RUNTIME_HASH = "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c";

const response = await fetch(SOURCE_URL);
if (!response.ok) throw new Error(`Pinned Safe source fetch failed: HTTP ${response.status}`);
const source = await response.text();

const gitBlob = createHash("sha1")
  .update(Buffer.from(`blob ${Buffer.byteLength(source)}\0`, "utf8"))
  .update(source, "utf8")
  .digest("hex");
if (gitBlob !== EXPECTED_GIT_BLOB) {
  throw new Error(`Safe source blob mismatch: ${gitBlob}`);
}

const compilerVersion = solc.version();
if (!compilerVersion.startsWith(EXPECTED_SOLC)) {
  throw new Error(`Unexpected solc version: ${compilerVersion}`);
}

const input = {
  language: "Solidity",
  sources: {
    "contracts/proxies/SafeProxy.sol": { content: source },
  },
  settings: {
    optimizer: { enabled: false },
    outputSelection: {
      "*": {
        "*": ["evm.deployedBytecode.object"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((entry) => entry.severity === "error");
if (errors.length) throw new Error(errors.map((entry) => entry.formattedMessage).join("\n"));

const object = output.contracts?.["contracts/proxies/SafeProxy.sol"]?.SafeProxy?.evm?.deployedBytecode?.object;
if (typeof object !== "string" || !object.length) throw new Error("Compiled SafeProxy runtime bytecode is missing");
const runtime = `0x${object}`;
const runtimeHash = keccak256(runtime);
if (runtimeHash.toLowerCase() !== EXPECTED_RUNTIME_HASH) {
  throw new Error(`Reproduced SafeProxy runtime hash mismatch: ${runtimeHash}`);
}

console.log("Safe v1.4.1 SafeProxy reproducible runtime build: PASS");
console.log(`Source URL: ${SOURCE_URL}`);
console.log(`Git blob SHA: ${gitBlob}`);
console.log(`Compiler: ${compilerVersion}`);
console.log("Optimizer: disabled");
console.log(`Runtime size: ${object.length / 2} bytes`);
console.log(`Runtime Keccak-256: ${runtimeHash}`);
console.log("Compiled runtime matches the independently observed BNB Mainnet candidate hash.");
