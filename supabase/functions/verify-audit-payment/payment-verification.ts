export const BNB_PEG_BSC_USD_CONTRACT = "0x55d398326f99059ff775485246999027b3197955";
export function assertSupportedPaymentAsset(chainId: number, tokenContract: string, tokenSymbol: string, tokenDecimals: number): void {
  if (chainId !== 56 || String(tokenContract || "").toLowerCase() !== BNB_PEG_BSC_USD_CONTRACT || tokenSymbol !== "BSC-USD" || tokenDecimals !== 18) {
    throw new Error("Unsupported payment asset. Only Binance-Peg BSC-USD on BNB Smart Chain (chain ID 56, approved contract, 18 decimals) is accepted.");
  }
}
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export type TransferLog = {
  address?: string;
  topics?: string[];
  data?: string;
  logIndex?: string;
  removed?: boolean;
};
export function normalizeAddress(value: unknown): string {
  const address = String(value || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error("Invalid EVM address.");
  return address;
}
function topicAddress(topic: unknown): string {
  const value = String(topic || "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(value)) return "";
  return "0x" + value.slice(-40);
}
export function findExactTransferLog(
  logs: TransferLog[],
  expectedToken: string,
  expectedRecipient: string,
  expectedAmount: bigint,
): { payerAddress: string; logIndex: number } {
  const token = normalizeAddress(expectedToken);
  const recipient = normalizeAddress(expectedRecipient);
  if (expectedAmount <= 0n) throw new Error("Expected transfer amount must be positive.");
  const matches = (Array.isArray(logs) ? logs : []).filter((log) => {
    if (log?.removed === true) return false;
    const topics = Array.isArray(log?.topics) ? log.topics : [];
    if (topics.length !== 3) return false;
    if (String(log.address || "").toLowerCase() !== token) return false;
    if (String(topics[0] || "").toLowerCase() !== TRANSFER_TOPIC) return false;
    const payer = topicAddress(topics[1]);
    if (!payer || payer === "0x0000000000000000000000000000000000000000" || topicAddress(topics[2]) !== recipient) return false;
    if (!/^0x[0-9a-f]{64}$/i.test(String(log.data || ""))) return false;
    try { return BigInt(String(log.data)) === expectedAmount; } catch { return false; }
  });
  if (matches.length === 0) throw new Error("No exact token Transfer event to the platform receiving wallet was found.");
  if (matches.length !== 1) throw new Error("Multiple matching token Transfer events were found; payment cannot be safely assigned.");
  const indexHex = String(matches[0].logIndex || "");
  if (!/^0x[0-9a-f]+$/i.test(indexHex)) throw new Error("Matching transfer event has no valid log index.");
  const index = BigInt(indexHex);
  if (index > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Transfer log index is out of range.");
  return { payerAddress: topicAddress(matches[0].topics![1]), logIndex: Number(index) };
}


export function assertCanonicalReceiptBlock(
  receiptBlockNumber: string,
  receiptBlockHash: string,
  canonicalBlock: { number?: unknown; hash?: unknown } | null,
): void {
  if (!canonicalBlock || typeof canonicalBlock.number !== "string" || typeof canonicalBlock.hash !== "string") {
    throw new Error("Canonical BNB block is unavailable; payment must remain pending.");
  }
  if (canonicalBlock.number.toLowerCase() !== receiptBlockNumber.toLowerCase()) {
    throw new Error("Canonical BNB block number does not match the transaction receipt.");
  }
  if (!/^0x[0-9a-f]{64}$/i.test(canonicalBlock.hash) || canonicalBlock.hash.toLowerCase() !== receiptBlockHash.toLowerCase()) {
    throw new Error("Transaction receipt block is not canonical; payment cannot be confirmed.");
  }
}

export function assertPaymentBlockBeforeExpiry(orderExpiresAt: string, canonicalBlockTimestamp: unknown): void {
  const expiryMs = Date.parse(orderExpiresAt);
  const timestampHex = String(canonicalBlockTimestamp || "");
  if (!Number.isFinite(expiryMs) || !/^0x[0-9a-f]+$/i.test(timestampHex)) {
    throw new Error("Payment order expiry or canonical block timestamp is invalid; payment cannot be confirmed.");
  }
  const blockTimeMs = Number(BigInt(timestampHex) * 1000n);
  if (!Number.isSafeInteger(blockTimeMs)) {
    throw new Error("Canonical block timestamp is outside the supported range.");
  }
  if (blockTimeMs > expiryMs) {
    throw new Error("Payment transaction was included after the payment order expired.");
  }
}
