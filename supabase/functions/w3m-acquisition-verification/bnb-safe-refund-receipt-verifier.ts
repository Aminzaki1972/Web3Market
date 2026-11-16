// W3M Protocol V1 — read-only BNB Safe buyer-refund receipt verifier.
// Separate from seller-release verification; never signs, broadcasts, or persists.
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";
import type { JsonRpcClient } from "./bnb-revenue-adapter.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const eventTopic = (signature: string) => "0x" + Array.from(
  keccak_256(new TextEncoder().encode(signature)),
  (b) => b.toString(16).padStart(2, "0"),
).join("");
const EXECUTION_SUCCESS_TOPIC = eventTopic("ExecutionSuccess(bytes32,uint256)");
const EXECUTION_FAILURE_TOPIC = eventTopic("ExecutionFailure(bytes32,uint256)");

export class BnbSafeRefundReceiptVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BnbSafeRefundReceiptVerificationError";
  }
}

export interface BnbSafeRefundReceiptExpectation {
  broadcastTxHash: string;
  safeTxHash: string;
  safeAddress: string;
  tokenContract: string;
  buyerWallet: string;
  buyerRefundAmount: string; // exact decimal amount from immutable decision
  originalDealAmount: string; // exact value from latest immutable signed terms
  platformWallet: string;
  platformFeeAmount: string; // fixed 7.5% of original signed deal value
  minConfirmations: number;
  decisionId: string;
  decisionHash: string;
  termsHash: string;
}

export interface VerifiedBnbSafeRefundReceipt {
  chainId: 56;
  transactionHash: string;
  blockHash: string;
  blockNumber: string;
  blockTimestamp: string;
  confirmations: number;
  safeAddress: string;
  safeTxHash: string;
  tokenContract: string;
  buyerWallet: string;
  buyerRefundAmount: string;
  platformWallet: string;
  platformFeeAmount: string;
  decisionId: string;
  decisionHash: string;
  termsHash: string;
  executionSuccess: true;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function quantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !QUANTITY.test(value)) {
    throw new BnbSafeRefundReceiptVerificationError("Invalid RPC " + label + ".");
  }
  return BigInt(value);
}
function same(value: unknown, expected: string): boolean {
  return typeof value === "string" && value.toLowerCase() === expected.toLowerCase();
}
function wordAddress(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) {
    throw new BnbSafeRefundReceiptVerificationError("Invalid " + label + " topic.");
  }
  return "0x" + value.slice(-40).toLowerCase();
}
function wordUint(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) {
    throw new BnbSafeRefundReceiptVerificationError("Invalid " + label + " uint256.");
  }
  return BigInt(value);
}
function parseDecimal(value: string, decimals: number, label: string): bigint {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    throw new BnbSafeRefundReceiptVerificationError("Invalid expected " + label + ".");
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) {
    throw new BnbSafeRefundReceiptVerificationError("Expected " + label + " exceeds token precision.");
  }
  return BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
}
function decimal(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}
function hexQuantity(value: bigint): string {
  return "0x" + value.toString(16);
}

/**
 * Confirms the canonical BNB receipt contains exactly the buyer refund and
 * fixed platform-fee transfers emitted by the Safe. Decision and terms hashes
 * are returned as bound evidence; caller must reload and compare them against
 * immutable server-side records before atomic finalization.
 */
export async function verifyBnbSafeBuyerRefundReceipt(
  rpc: JsonRpcClient,
  expected: BnbSafeRefundReceiptExpectation,
): Promise<VerifiedBnbSafeRefundReceipt> {
  if (!HASH.test(expected.broadcastTxHash) || !HASH.test(expected.safeTxHash) ||
      !ADDRESS.test(expected.safeAddress) || !ADDRESS.test(expected.tokenContract) ||
      !ADDRESS.test(expected.buyerWallet) || !ADDRESS.test(expected.platformWallet) ||
      expected.buyerWallet.toLowerCase() === expected.platformWallet.toLowerCase() ||
      !HASH.test("0x" + expected.decisionHash.replace(/^0x/, "")) ||
      !HASH.test("0x" + expected.termsHash.replace(/^0x/, "")) ||
      !expected.decisionId.trim() ||
      !Number.isSafeInteger(expected.minConfirmations) || expected.minConfirmations < 1) {
    throw new BnbSafeRefundReceiptVerificationError("Pinned buyer-refund expectations are invalid.");
  }
  const buyerExpected = expected.buyerRefundAmount;
  const originalExpected = expected.originalDealAmount;
  const feeExpected = expected.platformFeeAmount;
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(buyerExpected) ||
      !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(originalExpected) ||
      !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(feeExpected) ||
      buyerExpected === "0" || feeExpected === "0") {
    throw new BnbSafeRefundReceiptVerificationError("Pinned buyer-refund or platform-fee amount is invalid.");
  }

  const chainId = quantity(await rpc.request<string>("eth_chainId", []), "chain ID");
  if (chainId !== 56n) throw new BnbSafeRefundReceiptVerificationError("RPC is not BNB Chain mainnet (56).");
  const rawReceipt = await rpc.request<unknown>("eth_getTransactionReceipt", [expected.broadcastTxHash]);
  if (!record(rawReceipt) || !same(rawReceipt.transactionHash, expected.broadcastTxHash) ||
      rawReceipt.status !== "0x1" || typeof rawReceipt.blockHash !== "string" ||
      !HASH.test(rawReceipt.blockHash) || !Array.isArray(rawReceipt.logs)) {
    throw new BnbSafeRefundReceiptVerificationError("BNB refund receipt is unsuccessful or malformed.");
  }
  const blockNumber = quantity(rawReceipt.blockNumber, "receipt block number");
  const head = quantity(await rpc.request<string>("eth_blockNumber", []), "head block");
  if (head < blockNumber || head - blockNumber + 1n < BigInt(expected.minConfirmations)) {
    throw new BnbSafeRefundReceiptVerificationError("BNB refund receipt has insufficient confirmations.");
  }
  const block = await rpc.request<unknown>("eth_getBlockByNumber", [hexQuantity(blockNumber), false]);
  if (!record(block) || !same(block.hash, rawReceipt.blockHash)) {
    throw new BnbSafeRefundReceiptVerificationError("BNB refund receipt block is not canonical.");
  }
  const timestamp = quantity(block.timestamp, "receipt block timestamp");
  if (timestamp > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000))) {
    throw new BnbSafeRefundReceiptVerificationError("BNB refund receipt timestamp exceeds supported precision.");
  }
  const blockTimestamp = new Date(Number(timestamp) * 1000).toISOString();

  const decimalsRaw = await rpc.request<unknown>("eth_call", [
    { to: expected.tokenContract, data: "0x313ce567" },
    hexQuantity(blockNumber),
  ]);
  if (typeof decimalsRaw !== "string" || !/^0x[0-9a-f]{64}$/i.test(decimalsRaw)) {
    throw new BnbSafeRefundReceiptVerificationError("USDT decimals() response is malformed.");
  }
  const decimalsBig = BigInt(decimalsRaw);
  if (decimalsBig > 36n) throw new BnbSafeRefundReceiptVerificationError("USDT decimals exceed supported precision.");
  const decimalsCount = Number(decimalsBig);
  const expectedBuyerRaw = parseDecimal(buyerExpected, decimalsCount, "buyer refund");
  const originalDealRaw = parseDecimal(originalExpected, decimalsCount, "original deal value");
  const expectedFeeRaw = parseDecimal(feeExpected, decimalsCount, "platform fee");
  const fixedFeeRaw = (originalDealRaw * 75n + 500n) / 1000n;
  if (originalDealRaw <= 0n || expectedFeeRaw !== fixedFeeRaw) {
    throw new BnbSafeRefundReceiptVerificationError("Platform fee is not exactly 7.5% of the original signed deal value.");
  }

  let success = 0;
  let failure = 0;
  let buyerTransfer = 0;
  let feeTransfer = 0;
  const seen = new Set<string>();
  for (const candidate of rawReceipt.logs) {
    if (!record(candidate) || candidate.removed === true ||
        !Array.isArray(candidate.topics) || typeof candidate.address !== "string") {
      throw new BnbSafeRefundReceiptVerificationError("BNB refund receipt contains a removed or malformed log.");
    }
    const topics = candidate.topics;
    if (topics.length === 0 || typeof topics[0] !== "string") {
      throw new BnbSafeRefundReceiptVerificationError("BNB refund receipt log has no event signature.");
    }
    const topic0 = topics[0].toLowerCase();
    if (same(candidate.address, expected.safeAddress) &&
        (topic0 === EXECUTION_SUCCESS_TOPIC || topic0 === EXECUTION_FAILURE_TOPIC)) {
      if (topics.length !== 2 || !same(topics[1], expected.safeTxHash) ||
          typeof candidate.data !== "string" || !/^0x[0-9a-f]{64}$/i.test(candidate.data)) {
        if (topics.length > 1 && same(topics[1], expected.safeTxHash)) {
          throw new BnbSafeRefundReceiptVerificationError("Matching Safe refund execution event is malformed.");
        }
        continue;
      }
      if (topic0 === EXECUTION_SUCCESS_TOPIC) success++;
      else failure++;
      continue;
    }
    if (topic0 !== TRANSFER_TOPIC) continue;
    if (topics.length !== 3) throw new BnbSafeRefundReceiptVerificationError("USDT Transfer log has invalid topics.");
    const from = wordAddress(topics[1], "Transfer sender");
    if (from !== expected.safeAddress.toLowerCase()) continue;
    if (!same(candidate.address, expected.tokenContract)) {
      throw new BnbSafeRefundReceiptVerificationError("Safe refund includes an unapproved token contract.");
    }
    const to = wordAddress(topics[2], "Transfer recipient");
    const amount = wordUint(candidate.data, "Transfer amount");
    if (typeof candidate.logIndex !== "string" || !QUANTITY.test(candidate.logIndex)) {
      throw new BnbSafeRefundReceiptVerificationError("Safe refund Transfer log index is malformed.");
    }
    const index = quantity(candidate.logIndex, "log index").toString();
    if (seen.has(index)) throw new BnbSafeRefundReceiptVerificationError("Safe refund contains duplicate Transfer log indices.");
    seen.add(index);
    if (to === expected.buyerWallet.toLowerCase() && amount === expectedBuyerRaw) buyerTransfer++;
    else if (to === expected.platformWallet.toLowerCase() && amount === expectedFeeRaw) feeTransfer++;
    else throw new BnbSafeRefundReceiptVerificationError("Safe refund contains an unexpected recipient or amount.");
  }
  if (success !== 1 || failure !== 0) {
    throw new BnbSafeRefundReceiptVerificationError("Exact Safe ExecutionSuccess event is missing, duplicated, or contradicted.");
  }
  if (buyerTransfer !== 1 || feeTransfer !== 1 || seen.size !== 2) {
    throw new BnbSafeRefundReceiptVerificationError("Receipt must contain exactly one buyer refund and one platform-fee transfer.");
  }
  return {
    chainId: 56,
    transactionHash: expected.broadcastTxHash.toLowerCase(),
    blockHash: String(rawReceipt.blockHash).toLowerCase(),
    blockNumber: blockNumber.toString(),
    blockTimestamp,
    confirmations: Number(head - blockNumber + 1n),
    safeAddress: expected.safeAddress.toLowerCase(),
    safeTxHash: expected.safeTxHash.toLowerCase(),
    tokenContract: expected.tokenContract.toLowerCase(),
    buyerWallet: expected.buyerWallet.toLowerCase(),
    buyerRefundAmount: buyerExpected,
    platformWallet: expected.platformWallet.toLowerCase(),
    platformFeeAmount: feeExpected,
    decisionId: expected.decisionId,
    decisionHash: expected.decisionHash.replace(/^0x/, "").toLowerCase(),
    termsHash: expected.termsHash.replace(/^0x/, "").toLowerCase(),
    executionSuccess: true,
  };
}
