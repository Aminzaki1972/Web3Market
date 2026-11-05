// Server-only exact-text loader for the W3M Deal Room snapshot RPC.
import {
  evaluateDealRoomRowsWithW3M,
  type DealRoomDealRow,
  type DealRoomPolicyRow,
} from "./dealroom-supabase-adapter.ts";
import type { DealRoomW3MServiceResult } from "./dealroom-w3m-service.ts";
import type { SettlementStage } from "./settlement-gate.ts";
import type { EthereumDigestRecoveryVerifier } from "./signature-verifier.ts";

export interface DealRoomTermsSnapshotRow {
  deal_id: unknown; project_id: unknown; buyer_id: unknown; seller_id: unknown;
  deal_amount: unknown; currency: unknown; expected_amount: unknown;
  deal_chain_id: unknown; deal_safe_address: unknown; deal_token_contract: unknown;
  payment_status: unknown; payment_tx_hash: unknown; delivery_status: unknown;
  buyer_approved_at: unknown; dispute_status: unknown; release_tx_hash: unknown;
  policy_deal_id: unknown; policy_deal_amount: unknown; policy_fee_percent: unknown;
  policy_fee_amount: unknown; policy_seller_net_amount: unknown; policy_chain_id: unknown;
  policy_safe_address: unknown; policy_token_contract: unknown; policy_seller_wallet: unknown;
  policy_platform_wallet: unknown; policy_safe_nonce: unknown; policy_status: unknown;
}

export interface DealRoomTermsRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: unknown;
  }>;
}

export interface CheckDealRoomFromSnapshotInput {
  client: DealRoomTermsRpcClient & Parameters<typeof evaluateDealRoomRowsWithW3M>[0]["client"];
  dealId: string;
  stage: SettlementStage;
  now: string;
  safeConfigurationMatches: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function checkDealRoomFromExactSnapshot(
  input: CheckDealRoomFromSnapshotInput,
  recoverAndVerify?: EthereumDigestRecoveryVerifier,
): Promise<DealRoomW3MServiceResult> {
  if (!input.dealId.trim()) throw new Error("Deal ID is required.");
  const result = await input.client.rpc("w3m_read_dealroom_terms_snapshot", {
    p_deal_id: input.dealId,
  });
  if (result.error) throw new Error("W3M exact Deal Room snapshot read failed.");
  if (!Array.isArray(result.data) || result.data.length !== 1 || !record(result.data[0])) {
    throw new Error("W3M exact Deal Room snapshot is missing or ambiguous.");
  }
  const row = result.data[0] as unknown as DealRoomTermsSnapshotRow;
  if (row.policy_deal_id === null || row.policy_deal_id === undefined) {
    throw new Error("W3M release policy is missing; settlement is blocked.");
  }
  const deal: DealRoomDealRow = {
    id: row.deal_id, project_id: row.project_id, buyer_id: row.buyer_id,
    seller_id: row.seller_id, amount: row.deal_amount, currency: row.currency,
    expected_amount: row.expected_amount, chain_id: row.deal_chain_id,
    safe_address: row.deal_safe_address, token_contract: row.deal_token_contract,
    payment_status: row.payment_status, payment_tx_hash: row.payment_tx_hash,
    delivery_status: row.delivery_status, buyer_approved_at: row.buyer_approved_at,
    dispute_status: row.dispute_status, release_tx_hash: row.release_tx_hash,
  };
  const policy: DealRoomPolicyRow = {
    deal_id: row.policy_deal_id, deal_amount: row.policy_deal_amount,
    fee_percent: row.policy_fee_percent, fee_amount: row.policy_fee_amount,
    seller_net_amount: row.policy_seller_net_amount, chain_id: row.policy_chain_id,
    safe_address: row.policy_safe_address, token_contract: row.policy_token_contract,
    seller_wallet: row.policy_seller_wallet, platform_wallet: row.policy_platform_wallet,
    safe_nonce: row.policy_safe_nonce, status: row.policy_status,
  };
  return await evaluateDealRoomRowsWithW3M({
    client: input.client,
    deal,
    policy,
    stage: input.stage,
    now: input.now,
    safeConfigurationMatches: input.safeConfigurationMatches,
  }, recoverAndVerify);
}
