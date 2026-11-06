// W3M Protocol V1 — read-only BNB Safe release receipt verifier.
// It verifies raw RPC receipt/log data; it never broadcasts or signs transactions.
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";
import type { JsonRpcClient } from "./bnb-revenue-adapter.ts";
import { finalizeOnlyAfterVerifiedSafeReceipt } from "./safe-finalization-guard.ts";
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";
import { loadSafeFinalizationExpectation } from "./safe-finalization-snapshot-adapter.ts";
import { verifySafeFinalizationAcquisitionBundle } from "./safe-finalization-acquisition-adapter.ts";
import type {
  SafeFinalizationExpectation,
  VerifiedSafeReceiptEvidence,
} from "./safe-finalization-guard.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const EXECUTION_SUCCESS_TOPIC = "0x" + Array.from(
  keccak_256(new TextEncoder().encode("ExecutionSuccess(bytes32,uint256)")),
  (b) => b.toString(16).padStart(2, "0"),
).join("");
const EXECUTION_FAILURE_TOPIC = "0x" + Array.from(
  keccak_256(new TextEncoder().encode("ExecutionFailure(bytes32,uint256)")),
  (b) => b.toString(16).padStart(2, "0"),
).join("");

export class BnbSafeReceiptVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BnbSafeReceiptVerificationError";
  }
}

export interface BnbSafeReceiptExpectation extends SafeFinalizationExpectation {}

interface RpcLog {
  address?: unknown;
  topics?: unknown;
  data?: unknown;
  logIndex?: unknown;
  removed?: unknown;
}
interface RpcReceipt {
  transactionHash?: unknown;
  blockHash?: unknown;
  blockNumber?: unknown;
  status?: unknown;
  logs?: unknown;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function quantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !QUANTITY.test(value)) {
    throw new BnbSafeReceiptVerificationError("Invalid RPC " + label + ".");
  }
  return BigInt(value);
}
function wordAddress(topic: unknown, label: string): string {
  if (typeof topic !== "string" || !/^0x[0-9a-f]{64}$/i.test(topic)) {
    throw new BnbSafeReceiptVerificationError("Invalid " + label + " topic.");
  }
  return "0x" + topic.slice(-40).toLowerCase();
}
function uint256(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) {
    throw new BnbSafeReceiptVerificationError("Invalid " + label + " uint256.");
  }
  return BigInt(value);
}
function decimalFromRaw(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}
function toQuantity(value: bigint): string {
  return "0x" + value.toString(16);
}
function same(a: unknown, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}

export async function verifyBnbSafeReleaseReceipt(
  rpc: JsonRpcClient,
  expected: BnbSafeReceiptExpectation,
): Promise<VerifiedSafeReceiptEvidence> {
  if (!HASH.test(expected.broadcastTxHash) || !HASH.test(expected.safeTxHash) ||
      !ADDRESS.test(expected.safeAddress) || !ADDRESS.test(expected.tokenContract) ||
      !ADDRESS.test(expected.sellerWallet) || !ADDRESS.test(expected.platformWallet) ||
      expected.sellerWallet.toLowerCase() === expected.platformWallet.toLowerCase() ||
      !Number.isSafeInteger(expected.minConfirmations) || expected.minConfirmations < 1) {
    throw new BnbSafeReceiptVerificationError("Pinned Safe receipt expectations are invalid.");
  }

  const chainId = quantity(await rpc.request<string>("eth_chainId", []), "chain ID");
  if (chainId !== 56n) throw new BnbSafeReceiptVerificationError("RPC is not BNB Chain mainnet (56).");

  const rawReceipt = await rpc.request<unknown>("eth_getTransactionReceipt", [expected.broadcastTxHash]);
  if (!record(rawReceipt)) throw new BnbSafeReceiptVerificationError("BNB transaction receipt is missing.");
  const receipt = rawReceipt as RpcReceipt;
  if (!same(receipt.transactionHash, expected.broadcastTxHash) ||
      receipt.status !== "0x1" ||
      typeof receipt.blockHash !== "string" || !HASH.test(receipt.blockHash) ||
      !Array.isArray(receipt.logs)) {
    throw new BnbSafeReceiptVerificationError("BNB receipt is unsuccessful or malformed.");
  }
  const blockNumber = quantity(receipt.blockNumber, "receipt block number");
  const head = quantity(await rpc.request<string>("eth_blockNumber", []), "head block");
  if (head < blockNumber || head - blockNumber + 1n < BigInt(expected.minConfirmations)) {
    throw new BnbSafeReceiptVerificationError("BNB receipt has not reached the required confirmations.");
  }
  const block = await rpc.request<unknown>("eth_getBlockByNumber", [toQuantity(blockNumber), false]);
  if (!record(block) || !same(block.hash, receipt.blockHash)) {
    throw new BnbSafeReceiptVerificationError("Receipt block is no longer canonical.");
  }
  const blockTimestampSeconds = quantity(block.timestamp, "receipt block timestamp");
  if (blockTimestampSeconds > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000))) {
    throw new BnbSafeReceiptVerificationError("Receipt block timestamp exceeds supported precision.");
  }
  const blockTimestamp = new Date(Number(blockTimestampSeconds) * 1000).toISOString();
  const packageIssuedAt = Date.parse(expected.packageIssuedAt);
  const packageExpiresAt = Date.parse(expected.packageExpiresAt);
  const receiptBlockAt = Date.parse(blockTimestamp);
  if (!Number.isFinite(packageIssuedAt) || !Number.isFinite(packageExpiresAt) ||
      packageExpiresAt <= packageIssuedAt || receiptBlockAt < packageIssuedAt ||
      receiptBlockAt > packageExpiresAt) {
    throw new BnbSafeReceiptVerificationError("Receipt block timestamp is outside the issued W3M wallet package window.");
  }

  // Read token decimals at the receipt block, not from browser/config input.
  const decimalsResult = await rpc.request<unknown>("eth_call", [
    { to: expected.tokenContract, data: "0x313ce567" },
    toQuantity(blockNumber),
  ]);
  if (typeof decimalsResult !== "string" || !/^0x[0-9a-f]{64}$/i.test(decimalsResult)) {
    throw new BnbSafeReceiptVerificationError("Token decimals() returned malformed data.");
  }
  const decimalsBig = BigInt(decimalsResult);
  if (decimalsBig > 36n) throw new BnbSafeReceiptVerificationError("Token decimals exceed supported precision.");
  const decimals = Number(decimalsBig);

  let successCount = 0;
  let failureCount = 0;
  const transfers: Array<{ from_address: string; to_address: string; amount: string }> = [];
  const seenLogIndices = new Set<string>();

  for (const candidate of receipt.logs) {
    if (!record(candidate)) throw new BnbSafeReceiptVerificationError("Receipt contains a malformed log.");
    const log = candidate as RpcLog;
    if (log.removed === true || !Array.isArray(log.topics) || typeof log.address !== "string") {
      throw new BnbSafeReceiptVerificationError("Receipt contains a removed or malformed log.");
    }
    const topics = log.topics;
    if (topics.length === 0 || typeof topics[0] !== "string") {
      throw new BnbSafeReceiptVerificationError("Receipt log has no event signature.");
    }
    const topic0 = topics[0].toLowerCase();

    if (same(log.address, expected.safeAddress) &&
        (topic0 === EXECUTION_SUCCESS_TOPIC || topic0 === EXECUTION_FAILURE_TOPIC)) {
      if (topics.length !== 2 || !same(topics[1], expected.safeTxHash) ||
          typeof log.data !== "string" || !/^0x[0-9a-f]{64}$/i.test(log.data)) {
        if (topics.length > 1 && same(topics[1], expected.safeTxHash)) {
          throw new BnbSafeReceiptVerificationError("Matching Safe execution event is malformed.");
        }
        continue;
      }
      if (topic0 === EXECUTION_SUCCESS_TOPIC) successCount += 1;
      else failureCount += 1;
      continue;
    }

    if (topic0 === TRANSFER_TOPIC) {
      if (topics.length !== 3) throw new BnbSafeReceiptVerificationError("ERC-20 Transfer log has invalid topics.");
      const from = wordAddress(topics[1], "Transfer sender");
      if (from.toLowerCase() !== expected.safeAddress.toLowerCase()) continue;
      if (!same(log.address, expected.tokenContract)) {
        throw new BnbSafeReceiptVerificationError("Safe emitted a token transfer from an unapproved token contract.");
      }
      const to = wordAddress(topics[2], "Transfer recipient");
      const rawAmount = uint256(log.data, "Transfer amount");
      if (typeof log.logIndex !== "string" || !QUANTITY.test(log.logIndex)) {
        throw new BnbSafeReceiptVerificationError("Transfer log index is malformed.");
      }
      const logIndex = quantity(log.logIndex, "log index").toString();
      if (seenLogIndices.has(logIndex)) throw new BnbSafeReceiptVerificationError("Duplicate Transfer log index.");
      seenLogIndices.add(logIndex);
      transfers.push({
        from_address: from,
        to_address: to,
        amount: decimalFromRaw(rawAmount, decimals),
      });
    }
  }

  if (successCount !== 1 || failureCount !== 0) {
    throw new BnbSafeReceiptVerificationError("Exact Safe ExecutionSuccess event is missing, duplicated, or contradicted.");
  }
  if (transfers.length !== 2) {
    throw new BnbSafeReceiptVerificationError("Safe receipt must contain exactly two Safe-originating ERC-20 transfers.");
  }

  return {
    chain_id: 56,
    transaction_hash: expected.broadcastTxHash.toLowerCase(),
    receipt_status: 1,
    execution_success: true,
    execution_failure: false,
    safe_address: expected.safeAddress.toLowerCase(),
    safe_tx_hash: expected.safeTxHash.toLowerCase(),
    token_contract: expected.tokenContract.toLowerCase(),
    transfers,
    confirmations: Number(head - blockNumber + 1n),
    block_timestamp: blockTimestamp,
  } as VerifiedSafeReceiptEvidence;
}

/** Complete server-side read -> verify -> atomic-finalization composition. */
export async function finalizeBnbSafeReleaseAfterRpcVerification(
  database: W3MRpcClient,
  bnbRpc: JsonRpcClient,
  expected: BnbSafeReceiptExpectation,
) {
  return await finalizeOnlyAfterVerifiedSafeReceipt(
    database,
    expected,
    () => verifyBnbSafeReleaseReceipt(bnbRpc, expected),
  );
}

/** Fresh database snapshot -> raw BNB receipt verification -> atomic finalizer. */
export async function finalizeBnbSafeReleaseFromFreshSnapshot(
  database: W3MRpcClient,
  bnbRpc: JsonRpcClient,
  input: {
    attemptId: string;
    actorId: string;
    minConfirmations: number;
  },
) {
  const expected = await loadSafeFinalizationExpectation(database, input);
  const acquisitionAttestation = await verifySafeFinalizationAcquisitionBundle(database, input.attemptId);
  return await finalizeBnbSafeReleaseAfterRpcVerification(database, bnbRpc, {
    ...expected,
    acquisitionAttestation,
  });
}
