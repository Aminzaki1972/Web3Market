// Verify the SafeProxy deployed runtime emitted by the full pinned Safe v1.4.1 build.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const upstreamRoot = resolve(process.argv[2] || "safe-upstream");
const buildInfoDir = resolve(upstreamRoot, "build/artifacts/build-info");
const requireFromUpstream = createRequire(resolve(upstreamRoot, "package.json"));
const { ethers } = requireFromUpstream("ethers");

const EXPECTED_GIT_BLOB = "eb21260363a19f1a35ef34e323761e63cf5600e3";
const EXPECTED_SOLC = "0.7.6+commit.7338295f";
const EXPECTED_RUNTIME_HASH = "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c";
const SOURCE_PATH = "contracts/proxies/SafeProxy.sol";

const names = await readdir(buildInfoDir);
let selected;
for (const name of names.filter((name) => name.endsWith(".json"))) {
  const candidate = JSON.parse(await readFile(resolve(buildInfoDir, name), "utf8"));
  if (candidate.input?.sources?.[SOURCE_PATH] && candidate.output?.contracts?.[SOURCE_PATH]?.SafeProxy) {
    selected = candidate;
    break;
  }
}
if (!selected) throw new Error("SafeProxy build-info entry was not found in the full upstream build");

const source = selected.input.sources[SOURCE_PATH].content;
const gitBlob = createHash("sha1")
  .update(Buffer.from(`blob ${Buffer.byteLength(source)}\0`, "utf8"))
  .update(source, "utf8")
  .digest("hex");
if (gitBlob !== EXPECTED_GIT_BLOB) throw new Error(`Pinned Safe source blob mismatch: ${gitBlob}`);

const compilerVersion = selected.solcLongVersion || selected.solcVersion || "";
if (!compilerVersion.startsWith(EXPECTED_SOLC)) throw new Error(`Unexpected solc version: ${compilerVersion}`);
if (selected.input.settings?.optimizer?.enabled === true) throw new Error("SafeProxy build unexpectedly enables optimizer");

const deployedObject = selected.output.contracts[SOURCE_PATH].SafeProxy.evm.deployedBytecode.object;
if (typeof deployedObject !== "string" || !deployedObject.length) throw new Error("SafeProxy deployed runtime bytecode is missing");
const runtime = `0x${deployedObject}`;
const runtimeHash = ethers.utils.keccak256(runtime);
if (runtimeHash.toLowerCase() !== EXPECTED_RUNTIME_HASH) {
  throw new Error(`Full Safe v1.4.1 build runtime hash mismatch: ${runtimeHash}`);
}

console.log("Safe v1.4.1 full-source SafeProxy runtime reproduction: PASS");
console.log(`Compiler: ${compilerVersion}`);
console.log(`Pinned source Git blob: ${gitBlob}`);
console.log("Build source set: full upstream Safe repository at pinned commit");
console.log(`Optimizer enabled: ${Boolean(selected.input.settings?.optimizer?.enabled)}`);
console.log(`Runtime size: ${deployedObject.length / 2} bytes`);
console.log(`Runtime Keccak-256: ${runtimeHash}`);
console.log("Full-build runtime matches the BNB Mainnet eth_getCode runtime hash.");
