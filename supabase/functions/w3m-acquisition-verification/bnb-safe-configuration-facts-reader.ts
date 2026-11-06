// W3M Protocol V1 — canonical-block Safe configuration reader for PREPARE.
// All contract reads use one fixed BNB block; the block hash is checked again
// after reads. No transaction hash, signature, send, or broadcast is required.
import type { JsonRpcClient } from "./bnb-revenue-adapter.ts";
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
}

export async function readCanonicalBnbSafeConfigurationFacts(
  rpc: JsonRpcClient,
  expected: SafeConfigurationExpectation,
): Promise<CanonicalBnbSafeConfigurationFacts> {
  const blockTag = await getBnbSafeReadBlockTag(rpc);
  const before = await readBlockHeader(rpc, blockTag);
  const client = createBnbSafeLiveReadClient(rpc, blockTag);
  const facts = await readAndVerifySafeConfigurationFacts(client, expected);
  const after = await readBlockHeader(rpc, blockTag);
  if (before.hash !== after.hash) {
    return {
      ...facts,
      valid: false,
      readBlockNumber: blockTag,
      readBlockHash: before.hash,
      issues: [...new Set([...facts.issues, "SAFE_READ_BLOCK_NOT_CANONICAL"])],
    };
  }
  return { ...facts, readBlockNumber: blockTag, readBlockHash: before.hash };
}
