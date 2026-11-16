// W3M payment evidence — strict, read-only canonical BNB receipt verifier.
// This module does not persist state, sign, broadcast, or trust browser-supplied facts.
import type { JsonRpcClient } from "./bnb-revenue-adapter.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const W3M_BNB_USDT = "0x55d398326f99059ff775485246999027b3197955";

export class BnbDealPaymentReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BnbDealPaymentReceiptError";
  }
}

export interface BnbDealPaymentExpectation {
  transactionHash: string;
  buyerWallet: string;
  safeAddress: string;
  tokenContract: string;
  expectedAmountBaseUnits: string;
  minConfirmations: number;
}

export interface VerifiedBnbDealPaymentReceipt {
  chainId: 56;
  transactionHash: string;
  blockHash: string;
  blockNumber: string;
  confirmations: number;
  buyerWallet: string;
  safeAddress: string;
  tokenContract: string;
  amountBaseUnits: string;
  logIndex: string;
}

function record(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function quantity(v: unknown, label: string): bigint {
  if (typeof v !== "string" || !QUANTITY.test(v)) {
    throw new BnbDealPaymentReceiptError("Malformed " + label + ".");
  }
  return BigInt(v);
}
function same(v: unknown, expected: string): boolean {
  return typeof v === "string" && v.toLowerCase() === expected.toLowerCase();
}
function wordAddress(v: unknown, label: string): string {
  if (typeof v !== "string" || !/^0x[0-9a-f]{64}$/i.test(v) || !/^0{24}/i.test(v.slice(2, 26))) {
    throw new BnbDealPaymentReceiptError("Malformed " + label + " topic.");
  }
  return "0x" + v.slice(-40).toLowerCase();
}
function hexQuantity(v: bigint): string {
  return "0x" + v.toString(16);
}

/** Verifies exact transaction, canonical receipt block and one exact ERC-20 transfer. */
export async function verifyBnbDealPaymentReceipt(
  rpc: JsonRpcClient,
  expected: BnbDealPaymentExpectation,
): Promise<VerifiedBnbDealPaymentReceipt> {
  if (!HASH.test(expected.transactionHash) || !ADDRESS.test(expected.buyerWallet) ||
      !ADDRESS.test(expected.safeAddress) || !ADDRESS.test(expected.tokenContract) ||
      expected.buyerWallet.toLowerCase() === expected.safeAddress.toLowerCase() ||
      expected.tokenContract.toLowerCase() !== W3M_BNB_USDT ||
      !/^(0|[1-9][0-9]*)$/.test(expected.expectedAmountBaseUnits) ||
      BigInt(expected.expectedAmountBaseUnits) <= 0n ||
      !Number.isSafeInteger(expected.minConfirmations) || expected.minConfirmations < 1) {
    throw new BnbDealPaymentReceiptError("Pinned payment expectations are invalid.");
  }

  const chainId = quantity(await rpc.request<string>("eth_chainId", []), "RPC chain ID");
  if (chainId !== 56n) throw new BnbDealPaymentReceiptError("RPC is not BNB Chain mainnet (56).");

  const tx = await rpc.request<unknown>("eth_getTransactionByHash", [expected.transactionHash]);
  if (!record(tx) || !same(tx.hash, expected.transactionHash) ||
      !same(tx.from, expected.buyerWallet) || !same(tx.to, expected.tokenContract)) {
    throw new BnbDealPaymentReceiptError("Payment transaction identity or sender/target is invalid.");
  }

  const receipt = await rpc.request<unknown>("eth_getTransactionReceipt", [expected.transactionHash]);
  if (!record(receipt) || !same(receipt.transactionHash, expected.transactionHash) ||
      receipt.status !== "0x1" || !HASH.test(String(receipt.blockHash ?? "")) ||
      !Array.isArray(receipt.logs)) {
    throw new BnbDealPaymentReceiptError("Payment receipt is unsuccessful or malformed.");
  }
  const blockNumber = quantity(receipt.blockNumber, "receipt block number");
  const head = quantity(await rpc.request<string>("eth_blockNumber", []), "head block");
  if (head < blockNumber || head - blockNumber + 1n < BigInt(expected.minConfirmations)) {
    throw new BnbDealPaymentReceiptError("Payment receipt has insufficient confirmations.");
  }
  const block = await rpc.request<unknown>("eth_getBlockByNumber", [hexQuantity(blockNumber), false]);
  if (!record(block) || !same(block.hash, String(receipt.blockHash))) {
    throw new BnbDealPaymentReceiptError("Payment receipt block is not canonical.");
  }

  let matches = 0;
  let matchedLogIndex = "";
  let matchedAmount = 0n;
  const seenIndexes = new Set<string>();
  for (const candidate of receipt.logs) {
    if (!record(candidate) || candidate.removed === true || !Array.isArray(candidate.topics)) {
      throw new BnbDealPaymentReceiptError("Payment receipt contains a removed or malformed log.");
    }
    if (!same(candidate.address, expected.tokenContract)) continue;
    if (candidate.topics.length === 0 || typeof candidate.topics[0] !== "string" ||
        candidate.topics[0].toLowerCase() !== TRANSFER_TOPIC) continue;
    if (candidate.topics.length !== 3) {
      throw new BnbDealPaymentReceiptError("Token Transfer log has invalid topic count.");
    }
    const from = wordAddress(candidate.topics[1], "Transfer sender");
    const to = wordAddress(candidate.topics[2], "Transfer recipient");
    if (typeof candidate.logIndex !== "string" || !QUANTITY.test(candidate.logIndex)) {
      throw new BnbDealPaymentReceiptError("Token Transfer log index is malformed.");
    }
    const index = quantity(candidate.logIndex, "Transfer log index").toString();
    if (seenIndexes.has(index)) throw new BnbDealPaymentReceiptError("Duplicate token Transfer log index.");
    seenIndexes.add(index);
    if (from === expected.buyerWallet.toLowerCase() && to === expected.safeAddress.toLowerCase()) {
      if (typeof candidate.data !== "string" || !/^0x[0-9a-f]{64}$/i.test(candidate.data)) {
        throw new BnbDealPaymentReceiptError("Matching Transfer amount is malformed.");
      }
      matches++;
      matchedAmount = BigInt(candidate.data);
      matchedLogIndex = index;
    }
  }
  if (matches !== 1) {
    throw new BnbDealPaymentReceiptError("Receipt must contain exactly one buyer-to-Safe token Transfer.");
  }
  if (matchedAmount.toString() !== expected.expectedAmountBaseUnits) {
    throw new BnbDealPaymentReceiptError("Buyer-to-Safe token Transfer amount does not match the deal.");
  }

  return {
    chainId: 56,
    transactionHash: expected.transactionHash.toLowerCase(),
    blockHash: String(receipt.blockHash).toLowerCase(),
    blockNumber: blockNumber.toString(),
    confirmations: Number(head - blockNumber + 1n),
    buyerWallet: expected.buyerWallet.toLowerCase(),
    safeAddress: expected.safeAddress.toLowerCase(),
    tokenContract: expected.tokenContract.toLowerCase(),
    amountBaseUnits: matchedAmount.toString(),
    logIndex: matchedLogIndex,
  };
}
