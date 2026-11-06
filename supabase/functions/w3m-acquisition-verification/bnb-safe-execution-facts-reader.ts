// W3M Protocol V1 — canonical-block wrapper for live BNB Safe facts.
// Uses only read-only JSON-RPC. All contract reads are pinned to one block;
// the block hash is checked again after the reads to detect a reorg during the snapshot.
import type { JsonRpcClient } from "./bnb-revenue-adapter.ts";
import {
  createBnbSafeLiveReadClient,
  getBnbSafeReadBlockTag,
} from "./bnb-safe-live-read-client.ts";
import {
  readAndVerifySafeLiveExecutionFacts,
  type SafeLiveExecutionExpectation,
  type SafeLiveExecutionFacts,
} from "./safe-live-execution-facts.ts";

const HASH = /^0x[0-9a-f]{64}$/i;

interface BlockHeader {
  number: string;
  hash: string;
}

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

export interface CanonicalBnbSafeExecutionFacts extends SafeLiveExecutionFacts {
  readBlockNumber: string;
  readBlockHash: string;
}

export async function readCanonicalBnbSafeExecutionFacts(
  rpc: JsonRpcClient,
  expected: SafeLiveExecutionExpectation,
): Promise<CanonicalBnbSafeExecutionFacts> {
  // This validates chain 56 and captures a single fixed head block.
  const blockTag = await getBnbSafeReadBlockTag(rpc);
  const before = await readBlockHeader(rpc, blockTag);
  const client = createBnbSafeLiveReadClient(rpc, blockTag);
  const facts = await readAndVerifySafeLiveExecutionFacts(client, expected);

  // Reject the whole snapshot if the selected height was reorged while reading.
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

  return {
    ...facts,
    readBlockNumber: blockTag,
    readBlockHash: before.hash,
  };
}
