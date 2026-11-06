// W3M Protocol V1 — service-role reader for the exact Safe finalization snapshot.
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";
import type { SafeFinalizationExpectation } from "./safe-finalization-guard.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const DECIMAL = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("W3M finalization snapshot is malformed.");
  }
  return value as Record<string, unknown>;
}
function textField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("W3M finalization snapshot field is missing: " + key);
  }
  return value;
}
function addressField(row: Record<string, unknown>, key: string): string {
  const value = textField(row, key);
  if (!ADDRESS.test(value)) throw new Error("W3M finalization snapshot address is invalid: " + key);
  return value.toLowerCase();
}
function hashField(row: Record<string, unknown>, key: string): string {
  const value = textField(row, key);
  if (!HASH.test(value)) throw new Error("W3M finalization snapshot hash is invalid: " + key);
  return value.toLowerCase();
}
function decimalField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value.trim() || !DECIMAL.test(value)) {
    throw new Error("W3M finalization snapshot decimal is invalid: " + key);
  }
  return value;
}

export async function loadSafeFinalizationExpectation(
  client: W3MRpcClient,
  input: {
    attemptId: string;
    actorId: string;
    minConfirmations: number;
  },
): Promise<SafeFinalizationExpectation> {
  if (!input.attemptId.trim() || !input.actorId.trim() ||
      !Number.isSafeInteger(input.minConfirmations) ||
      input.minConfirmations < 1 || input.minConfirmations > 1000) {
    throw new Error("W3M finalization snapshot request is invalid.");
  }
  const { data, error } = await client.rpc("w3m_read_safe_finalization_snapshot", {
    p_attempt_id: input.attemptId,
  });
  if (error) throw new Error("W3M finalization snapshot read failed.");
  const row = object(data);

  if (textField(row, "attempt_id") !== input.attemptId ||
      row.chain_id !== 56 ||
      row.attempt_state !== "BROADCAST" && row.attempt_state !== "RECONCILIATION_REQUIRED" ||
      row.transaction_status !== "signed" && row.transaction_status !== "submitted" ||
      row.policy_status !== "locked" && row.policy_status !== "ready") {
    throw new Error("W3M finalization snapshot state or binding is not eligible.");
  }
  textField(row, "deal_id");
  textField(row, "transaction_id");
  textField(row, "report_id");
  const buyerId = textField(row, "buyer_id");
  const sellerId = textField(row, "seller_id");
  if (input.actorId !== buyerId && input.actorId !== sellerId) {
    throw new Error("W3M finalization actor is not a deal participant.");
  }
  const packageActorId = textField(row, "package_actor_id");
  hashField(row, "package_hash");
  const packageIssuedAt = textField(row, "package_issued_at");
  const packageExpiresAt = textField(row, "package_expires_at");
  if (packageActorId !== buyerId && packageActorId !== sellerId ||
      !Number.isFinite(Date.parse(packageIssuedAt)) ||
      !Number.isFinite(Date.parse(packageExpiresAt)) ||
      Date.parse(packageExpiresAt) <= Date.parse(packageIssuedAt)) {
    throw new Error("W3M wallet package issuance binding is missing, expired, or invalid.");
  }
  const sellerWallet = addressField(row, "seller_wallet");
  const platformWallet = addressField(row, "platform_wallet");
  if (sellerWallet === platformWallet) {
    throw new Error("W3M seller and platform wallets must be distinct.");
  }

  // Preserve exact decimal strings; JavaScript number conversion is forbidden.
  return {
    attemptId: input.attemptId,
    broadcastTxHash: hashField(row, "broadcast_tx_hash"),
    actorId: input.actorId,
    safeTxHash: hashField(row, "safe_tx_hash"),
    safeAddress: addressField(row, "safe_address"),
    tokenContract: addressField(row, "token_contract"),
    sellerWallet,
    sellerAmount: decimalField(row, "seller_net_amount"),
    platformWallet,
    platformFee: decimalField(row, "platform_fee"),
    minConfirmations: input.minConfirmations,
    packageIssuedAt,
    packageExpiresAt,
  };
}
