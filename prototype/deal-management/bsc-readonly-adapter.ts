/**
 * Read-only BNB Smart Chain receipt adapter contract for the sandbox.
 *
 * This module has no RPC implementation, credentials, wallet, signer, or write method.
 * Production code must inject a trusted server-side reader and independently pin
 * the official USDT contract after verification from authoritative sources.
 */
import { validateDepositEvidence, type DepositEvidence } from "./core.ts";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export type ReadOnlyBscLog = {
  address: string;
  topics: string[];
  data: string;
  removed?: boolean;
};

export type ReadOnlyBscReceipt = {
  transactionHash: string;
  status: "success" | "failed" | "pending" | 0 | 1 | "0x0" | "0x1";
  blockNumber: number | null;
  logs: ReadOnlyBscLog[];
};

export interface ReadOnlyBscClient {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<number>;
  getTransactionReceipt(txHash: string): Promise<ReadOnlyBscReceipt | null>;
  isTransactionHashUsed(txHash: string): Promise<boolean>;
}

export type DepositCheckConfig = {
  txHash: string;
  expectedTokenAddress: string;
  expectedSafeAddress: string;
  expectedAmount: bigint;
  requiredConfirmations: number;
};

export type DepositCheckResult =
  | { ok: true; evidence: DepositEvidence; confirmations: number }
  | { ok: false; reason: string };

function addressTopic(address: string): string {
  return "0x" + "0".repeat(24) + address.slice(2).toLowerCase();
}

function isSuccess(status: ReadOnlyBscReceipt["status"]): boolean {
  return status === "success" || status === 1 || status === "0x1";
}

/**
 * Reads a receipt and validates the exact ERC-20 Transfer into the deal Safe.
 * The client must be server-controlled; never pass browser-supplied RPC results.
 */
export async function verifyBscUsdtDeposit(
  client: ReadOnlyBscClient,
  config: DepositCheckConfig,
): Promise<DepositCheckResult> {
  if (!HASH_RE.test(config.txHash)) return { ok: false, reason: "invalid_tx_hash" };
  if (!ADDRESS_RE.test(config.expectedTokenAddress)) return { ok: false, reason: "invalid_token_configuration" };
  if (!ADDRESS_RE.test(config.expectedSafeAddress)) return { ok: false, reason: "invalid_safe_configuration" };
  if (config.expectedAmount <= 0n) return { ok: false, reason: "invalid_expected_amount" };
  if (!Number.isInteger(config.requiredConfirmations) || config.requiredConfirmations < 1) {
    return { ok: false, reason: "invalid_confirmation_policy" };
  }

  const [chainId, receipt, alreadyUsedTxHash] = await Promise.all([
    client.getChainId(),
    client.getTransactionReceipt(config.txHash),
    client.isTransactionHashUsed(config.txHash.toLowerCase()),
  ]);
  if (chainId !== 56) return { ok: false, reason: "wrong_network" };
  if (!receipt) return { ok: false, reason: "receipt_not_found" };
  if (receipt.transactionHash.toLowerCase() !== config.txHash.toLowerCase()) {
    return { ok: false, reason: "receipt_hash_mismatch" };
  }

  const head = await client.getBlockNumber();
  if (!Number.isInteger(receipt.blockNumber) || receipt.blockNumber === null ||
      !Number.isInteger(head) || head < receipt.blockNumber) {
    return { ok: false, reason: "invalid_block_height" };
  }
  const confirmations = head - receipt.blockNumber + 1;
  const matchingTransfers = receipt.logs.filter((log) =>
    !log.removed &&
    log.address.toLowerCase() === config.expectedTokenAddress.toLowerCase() &&
    log.topics.length === 3 &&
    log.topics[0].toLowerCase() === TRANSFER_TOPIC &&
    log.topics[2].toLowerCase() === addressTopic(config.expectedSafeAddress)
  );

  if (!isSuccess(receipt.status)) {
    return { ok: false, reason: receipt.status === "pending" ? "transaction_pending" : "transaction_failed" };
  }
  if (matchingTransfers.length !== 1) return { ok: false, reason: "expected_single_matching_transfer" };
  const transfer = matchingTransfers[0];
  if (!/^0x[0-9a-fA-F]{64}$/.test(transfer.data)) return { ok: false, reason: "invalid_transfer_amount" };
  const amount = BigInt(transfer.data);

  const evidence: DepositEvidence = {
    chainId,
    tokenAddress: transfer.address,
    expectedTokenAddress: config.expectedTokenAddress,
    safeAddress: config.expectedSafeAddress,
    expectedSafeAddress: config.expectedSafeAddress,
    amount,
    expectedAmount: config.expectedAmount,
    txHash: receipt.transactionHash,
    receiptStatus: isSuccess(receipt.status) ? "success" : "failed",
    confirmations,
    requiredConfirmations: config.requiredConfirmations,
    transferLogTo: config.expectedSafeAddress,
    alreadyUsedTxHash,
  };
  const validation = validateDepositEvidence(evidence);
  return validation.ok ? { ok: true, evidence, confirmations } : validation;
}
