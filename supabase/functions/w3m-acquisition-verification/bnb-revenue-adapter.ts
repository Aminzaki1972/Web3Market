// W3M Protocol V1 — read-only BNB/EVM ERC-20 receipt verifier.
// Scope: configured ERC-20 Transfer logs to deal-pinned revenue addresses.
// It does not prove off-chain revenue or commercial purpose and never submits transactions.

export const BNB_REVENUE_ADAPTER_VERSION = "w3m-bnb-revenue-adapter-1.0.0";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH32 = /^0x[0-9a-fA-F]{64}$/;
const HEX_QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;

export interface JsonRpcClient {
  request<T>(method: string, params: unknown[]): Promise<T>;
}

export interface BnbRevenueConfig {
  expectedChainId: 56 | 97;
  tokenAddress: string;
  revenueRecipients: string[];
  excludedSenders?: string[];
  fromBlock: number;
  toBlock: number;
  minConfirmations: number;
  maxBlockSpan: number;
  declaredRevenueRaw: string;
}

export interface BnbRevenueReceipt {
  transactionHash: string;
  logIndex: number;
  blockNumber: number;
  blockHash: string;
  from: string;
  to: string;
  amountRaw: string;
  confirmations: number;
}

export interface BnbRevenueDecision {
  status: "PASS" | "INCOMPLETE" | "BLOCKED";
  adapterVersion: string;
  chainId: number;
  tokenAddress: string;
  fromBlock: number;
  toBlock: number;
  observedHeadBlock: number;
  actualRevenueRaw: string;
  declaredRevenueRaw: string;
  receiptCount: number;
  pendingConfirmationCount: number;
  receipts: BnbRevenueReceipt[];
  proofHash: string;
  checkedAt: string;
  reasonCodes: string[];
}

export class BnbRevenueAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BnbRevenueAdapterError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS.test(value);
}

function parseQuantity(value: unknown, field: string): number {
  if (typeof value !== "string" || !HEX_QUANTITY.test(value)) {
    throw new BnbRevenueAdapterError(`Invalid RPC quantity for ${field}.`);
  }
  const parsed = Number(BigInt(value));
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new BnbRevenueAdapterError(`RPC quantity for ${field} exceeds safe integer bounds.`);
  }
  return parsed;
}

function toQuantity(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BnbRevenueAdapterError("Block number must be a non-negative safe integer.");
  }
  return `0x${value.toString(16)}`;
}

function addressTopic(address: string): string {
  if (!isAddress(address)) throw new BnbRevenueAdapterError("Invalid revenue recipient address.");
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

function topicAddress(topic: unknown): string {
  if (typeof topic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(topic)) {
    throw new BnbRevenueAdapterError("ERC-20 Transfer log contains an invalid indexed address.");
  }
  return `0x${topic.slice(-40).toLowerCase()}`;
}

function parseRawAmount(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new BnbRevenueAdapterError("ERC-20 Transfer log contains an invalid uint256 amount.");
  }
  return BigInt(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createAllowlistedBnbRpcClient(input: {
  rpcUrl: string;
  allowedHosts: string[];
  fetchImpl?: typeof fetch;
}): JsonRpcClient {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.rpcUrl);
  } catch {
    throw new BnbRevenueAdapterError("RPC URL is invalid.");
  }
  const allowed = new Set(input.allowedHosts.map((host) => host.toLowerCase()));
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password ||
      !allowed.has(parsedUrl.hostname.toLowerCase())) {
    throw new BnbRevenueAdapterError("RPC endpoint must use HTTPS and an explicitly allowlisted hostname.");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  let requestId = 0;
  return {
    async request<T>(method: string, params: unknown[]): Promise<T> {
      requestId += 1;
      const response = await fetchImpl(parsedUrl.toString(), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
      });
      if (!response.ok) {
        throw new BnbRevenueAdapterError(`RPC HTTP request failed with status ${response.status}.`);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new BnbRevenueAdapterError("RPC returned invalid JSON.");
      }
      if (!isRecord(payload) || payload.id !== requestId || !("result" in payload)) {
        if (isRecord(payload) && isRecord(payload.error)) {
          throw new BnbRevenueAdapterError("RPC returned a JSON-RPC error.");
        }
        throw new BnbRevenueAdapterError("RPC response envelope is invalid.");
      }
      return payload.result as T;
    },
  };
}

export async function verifyErc20Revenue(
  rpc: JsonRpcClient,
  config: BnbRevenueConfig,
  now = new Date().toISOString(),
): Promise<BnbRevenueDecision> {
  if (![56, 97].includes(config.expectedChainId) ||
      !isAddress(config.tokenAddress) ||
      !Array.isArray(config.revenueRecipients) ||
      config.revenueRecipients.length === 0 ||
      config.revenueRecipients.some((address) => !isAddress(address)) ||
      !Number.isSafeInteger(config.fromBlock) || !Number.isSafeInteger(config.toBlock) ||
      config.fromBlock < 0 || config.toBlock < config.fromBlock ||
      !Number.isSafeInteger(config.minConfirmations) || config.minConfirmations < 1 ||
      !Number.isSafeInteger(config.maxBlockSpan) || config.maxBlockSpan < 1 ||
      config.toBlock - config.fromBlock + 1 > config.maxBlockSpan ||
      !/^\d+$/.test(config.declaredRevenueRaw)) {
    throw new BnbRevenueAdapterError("Revenue verification configuration is invalid or exceeds the configured block window.");
  }

  const recipients = [...new Set(config.revenueRecipients.map((address) => address.toLowerCase()))];
  const excludedSenders = new Set((config.excludedSenders ?? []).map((address) => {
    if (!isAddress(address)) throw new BnbRevenueAdapterError("Invalid excluded sender address.");
    return address.toLowerCase();
  }));
  const tokenAddress = config.tokenAddress.toLowerCase();
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new BnbRevenueAdapterError("Verification clock is invalid.");

  const chainId = parseQuantity(await rpc.request<string>("eth_chainId", []), "chainId");
  if (chainId !== config.expectedChainId) {
    throw new BnbRevenueAdapterError("Connected RPC chain ID does not match the deal's pinned chain.");
  }
  const headBlock = parseQuantity(await rpc.request<string>("eth_blockNumber", []), "head block");
  if (config.toBlock > headBlock) {
    throw new BnbRevenueAdapterError("Requested revenue window extends beyond the current chain head.");
  }

  const logs = await rpc.request<unknown[]>("eth_getLogs", [{
    address: tokenAddress,
    fromBlock: toQuantity(config.fromBlock),
    toBlock: toQuantity(config.toBlock),
    topics: [TRANSFER_TOPIC, null, recipients.map(addressTopic)],
  }]);
  if (!Array.isArray(logs)) throw new BnbRevenueAdapterError("RPC log response is not an array.");

  const seenLogs = new Set<string>();
  const transactionReceipts = new Map<string, Record<string, unknown>>();
  const canonicalBlocks = new Map<number, string>();
  const receipts: BnbRevenueReceipt[] = [];
  const reasons = new Set<string>();
  let actualRevenue = 0n;
  let pendingCount = 0;

  for (const candidate of logs) {
    if (!isRecord(candidate) || !Array.isArray(candidate.topics) ||
        candidate.topics.length < 3 || typeof candidate.transactionHash !== "string" ||
        !HASH32.test(candidate.transactionHash) || typeof candidate.blockHash !== "string" ||
        !HASH32.test(candidate.blockHash) || typeof candidate.logIndex !== "string" ||
        !HEX_QUANTITY.test(candidate.logIndex) || !isAddress(candidate.address) ||
        candidate.address.toLowerCase() !== tokenAddress) {
      throw new BnbRevenueAdapterError("RPC returned a malformed or unexpected ERC-20 log.");
    }
    if (candidate.removed === true) {
      reasons.add("REMOVED_LOG_REQUIRES_REVIEW");
      continue;
    }
    if (String(candidate.topics[0]).toLowerCase() !== TRANSFER_TOPIC) {
      throw new BnbRevenueAdapterError("RPC returned a log with an unexpected event signature.");
    }

    const from = topicAddress(candidate.topics[1]);
    const to = topicAddress(candidate.topics[2]);
    if (!recipients.includes(to) || excludedSenders.has(from)) continue;

    const blockNumber = parseQuantity(candidate.blockNumber, "log block number");
    if (blockNumber < config.fromBlock || blockNumber > config.toBlock) {
      throw new BnbRevenueAdapterError("RPC returned a log outside the requested block range.");
    }
    const logIndex = parseQuantity(candidate.logIndex, "log index");
    const dedupeKey = `${candidate.transactionHash.toLowerCase()}:${logIndex}`;
    if (seenLogs.has(dedupeKey)) continue;
    seenLogs.add(dedupeKey);

    const txHash = candidate.transactionHash.toLowerCase();
    let receipt = transactionReceipts.get(txHash);
    if (!receipt) {
      const fetched = await rpc.request<unknown>("eth_getTransactionReceipt", [txHash]);
      if (!isRecord(fetched)) throw new BnbRevenueAdapterError("Transaction receipt is missing or malformed.");
      receipt = fetched;
      transactionReceipts.set(txHash, receipt);
    }
    if (receipt.status !== "0x1" || typeof receipt.blockHash !== "string" ||
        receipt.blockHash.toLowerCase() !== candidate.blockHash.toLowerCase()) {
      reasons.add("TRANSACTION_OR_RECEIPT_INVALID");
      continue;
    }

    let canonicalHash = canonicalBlocks.get(blockNumber);
    if (!canonicalHash) {
      const block = await rpc.request<unknown>("eth_getBlockByNumber", [toQuantity(blockNumber), false]);
      if (!isRecord(block) || typeof block.hash !== "string" || !HASH32.test(block.hash)) {
        throw new BnbRevenueAdapterError("Canonical block lookup failed.");
      }
      canonicalHash = block.hash.toLowerCase();
      canonicalBlocks.set(blockNumber, canonicalHash);
    }
    if (canonicalHash !== candidate.blockHash.toLowerCase()) {
      reasons.add("BLOCK_HASH_MISMATCH_REORG");
      continue;
    }

    const confirmations = headBlock - blockNumber + 1;
    if (confirmations < config.minConfirmations) {
      pendingCount += 1;
    }
    const amount = parseRawAmount(candidate.data);
    actualRevenue += amount;
    receipts.push({
      transactionHash: txHash,
      logIndex,
      blockNumber,
      blockHash: candidate.blockHash.toLowerCase(),
      from,
      to,
      amountRaw: amount.toString(),
      confirmations,
    });
  }

  const declared = BigInt(config.declaredRevenueRaw);
  if (reasons.has("TRANSACTION_OR_RECEIPT_INVALID") ||
      reasons.has("BLOCK_HASH_MISMATCH_REORG") ||
      reasons.has("REMOVED_LOG_REQUIRES_REVIEW")) {
    return {
      status: "BLOCKED",
      adapterVersion: BNB_REVENUE_ADAPTER_VERSION,
      chainId,
      tokenAddress,
      fromBlock: config.fromBlock,
      toBlock: config.toBlock,
      observedHeadBlock: headBlock,
      actualRevenueRaw: actualRevenue.toString(),
      declaredRevenueRaw: declared.toString(),
      receiptCount: receipts.length,
      pendingConfirmationCount: pendingCount,
      receipts,
      proofHash: await sha256Hex(stableJson({ chainId, tokenAddress, fromBlock: config.fromBlock, toBlock: config.toBlock, receipts })),
      checkedAt: now,
      reasonCodes: [...reasons],
    };
  }
  if (pendingCount > 0) reasons.add("CONFIRMATIONS_PENDING");
  if (actualRevenue !== declared) reasons.add("DECLARED_REVENUE_MISMATCH");

  const status: BnbRevenueDecision["status"] = pendingCount > 0
    ? "INCOMPLETE"
    : actualRevenue === declared ? "PASS" : "BLOCKED";

  const proof = {
    schema: "w3m-bnb-erc20-revenue-proof-v1",
    adapterVersion: BNB_REVENUE_ADAPTER_VERSION,
    chainId,
    tokenAddress,
    revenueRecipients: recipients,
    fromBlock: config.fromBlock,
    toBlock: config.toBlock,
    observedHeadBlock: headBlock,
    minConfirmations: config.minConfirmations,
    actualRevenueRaw: actualRevenue.toString(),
    declaredRevenueRaw: declared.toString(),
    receipts,
  };

  return {
    status,
    adapterVersion: BNB_REVENUE_ADAPTER_VERSION,
    chainId,
    tokenAddress,
    fromBlock: config.fromBlock,
    toBlock: config.toBlock,
    observedHeadBlock: headBlock,
    actualRevenueRaw: actualRevenue.toString(),
    declaredRevenueRaw: declared.toString(),
    receiptCount: receipts.length,
    pendingConfirmationCount: pendingCount,
    receipts,
    proofHash: await sha256Hex(stableJson(proof)),
    checkedAt: now,
    reasonCodes: [...reasons],
  };
}
