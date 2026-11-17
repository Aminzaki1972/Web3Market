// W3M Protocol V1 — canonical-block Safe configuration reader for PREPARE.
// All contract reads use one fixed BNB block; the block hash is checked again
// after reads. No transaction hash, signature, send, or broadcast is required.
import type { JsonRpcClient } from "./bnb-revenue-adapter.ts";
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";
import {
  createBnbSafeLiveReadClient,
  getBnbSafeReadBlockTag,
} from "./bnb-safe-live-read-client.ts";
import {
  readAndVerifySafeConfigurationFacts,
  type SafeConfigurationExpectation,
  type SafeConfigurationFacts,
} from "./safe-live-configuration-facts.ts";

const HASH = /^0x[0-9a-f]{64}$/i;
const SAFE_V141_SINGLETON = "0x41675c099f32341bf84bfc5382af534df5c7461a";
// Official @safe-global/safe-deployments v1.4.1 safe.json codeHash.
// BNB Smart Chain (chainId 56) maps to this canonical deployment.
const SAFE_V141_RUNTIME_CODE_HASH = "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4";
type RuntimeCodeHasher = (code: Uint8Array) => Uint8Array;

export function matchesSafeV141SingletonRuntimeCodeHash(
  code: unknown,
  hashRuntimeCode: RuntimeCodeHasher = keccak_256,
): boolean {
  if (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(code)) return false;
  const hex = code.slice(2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  const digest = hashRuntimeCode(bytes);
  const actual = "0x" + Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return actual.toLowerCase() === SAFE_V141_RUNTIME_CODE_HASH;
}
const MASTER_COPY_SELECTOR = "0xa619486e";
interface BlockHeader { number: string; hash: string; }

async function readBlockHeader(rpc: JsonRpcClient, blockTag: string): Promise<BlockHeader> {
  const value = await rpc.request<unknown>("eth_getBlockByNumber", [blockTag, false]);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("BNB RPC returned a malformed block header.");
  }
  const row = value as Record<string, unknown>;
  if (typeof row.number !== "string" || row.number.toLowerCase() !== blockTag.toLowerCase() ||
      typeof row.hash !== "string" || !HASH.test(row.hash)) {
    throw new Error("BNB RPC block header number or hash is invalid.");
  }
  return { number: row.number, hash: row.hash.toLowerCase() };
}

export interface CanonicalBnbSafeConfigurationFacts extends SafeConfigurationFacts {
  readBlockNumber: string;
  readBlockHash: string;
  singletonAddress: string | null;
}

export async function readCanonicalBnbSafeConfigurationFacts(
  rpc: JsonRpcClient,
  expected: SafeConfigurationExpectation,
  hashRuntimeCode: RuntimeCodeHasher = keccak_256,
): Promise<CanonicalBnbSafeConfigurationFacts> {
  const blockTag = await getBnbSafeReadBlockTag(rpc);
  const before = await readBlockHeader(rpc, blockTag);
  const client = createBnbSafeLiveReadClient(rpc, blockTag);
  const [facts, singletonStorage, masterCopyRaw, singletonCode] = await Promise.all([
    readAndVerifySafeConfigurationFacts(client, expected),
    rpc.request<unknown>("eth_getStorageAt", [expected.safeAddress, "0x0", blockTag]),
    rpc.request<unknown>("eth_call", [{ to: expected.safeAddress, data: MASTER_COPY_SELECTOR }, blockTag]),
    rpc.request<unknown>("eth_getCode", [SAFE_V141_SINGLETON, blockTag]),
  ]);
  const storageValid = typeof singletonStorage === "string" &&
    /^0x[0-9a-f]{64}$/i.test(singletonStorage) &&
    /^0{24}$/i.test(singletonStorage.slice(2, 26)) &&
    ("0x" + singletonStorage.slice(-40)).toLowerCase() === SAFE_V141_SINGLETON;
  const getterValid = typeof masterCopyRaw === "string" &&
    /^0x[0-9a-f]{64}$/i.test(masterCopyRaw) &&
    /^0{24}$/i.test(masterCopyRaw.slice(2, 26)) &&
    ("0x" + masterCopyRaw.slice(-40)).toLowerCase() === SAFE_V141_SINGLETON;
  const implementationCodePresent = typeof singletonCode === "string" &&
    /^0x(?:[0-9a-f]{2})+$/i.test(singletonCode);
  const implementationCodeHashValid = implementationCodePresent &&
    matchesSafeV141SingletonRuntimeCodeHash(singletonCode, hashRuntimeCode);
  const singletonIssues: string[] = [];
  if (expected.expectedVersion !== "1.4.1") singletonIssues.push("SAFE_SINGLETON_VERSION_NOT_PINNED");
  if (!storageValid || !getterValid) singletonIssues.push("SAFE_V141_SINGLETON_MISMATCH");
  if (!implementationCodePresent) singletonIssues.push("SAFE_V141_SINGLETON_CODE_MISSING");
  else if (!implementationCodeHashValid) singletonIssues.push("SAFE_V141_SINGLETON_CODE_HASH_MISMATCH");
  const after = await readBlockHeader(rpc, blockTag);
  if (before.hash !== after.hash) {
    return {
      ...facts,
      valid: false,
      readBlockNumber: blockTag,
      readBlockHash: before.hash,
      singletonAddress: storageValid && getterValid ? SAFE_V141_SINGLETON : null,
      issues: [...new Set([...facts.issues, ...singletonIssues, "SAFE_READ_BLOCK_NOT_CANONICAL"])],
    };
  }
  const issues = [...new Set([...facts.issues, ...singletonIssues])];
  return {
    ...facts,
    valid: issues.length === 0,
    readBlockNumber: blockTag,
    readBlockHash: before.hash,
    singletonAddress: storageValid && getterValid && implementationCodeHashValid ? SAFE_V141_SINGLETON : null,
    issues,
  };
}
