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
    if (!topicAddress(topics[1]) || topicAddress(topics[2]) !== recipient) return false;
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
