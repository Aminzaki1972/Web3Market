// W3M Protocol V1 — strict adapter from authoritative Deal Room rows.
// It intentionally rejects numeric JSON values for financial fields: the
// caller must fetch PostgreSQL numeric values as exact decimal text.

import {
  checkDealRoomWithW3M,
  type DealRoomW3MServiceResult,
} from "./dealroom-w3m-service.ts";
import type { W3MRegistryReadClient } from "./persisted-report-loader.ts";
import type { SettlementStage } from "./settlement-gate.ts";
import type { EthereumDigestRecoveryVerifier } from "./signature-verifier.ts";

export interface DealRoomDealRow {
  id: unknown;
  project_id: unknown;
  buyer_id: unknown;
  seller_id: unknown;
  amount: unknown;
  currency: unknown;
  expected_amount: unknown;
  chain_id: unknown;
  safe_address: unknown;
  token_contract: unknown;
  payment_status: unknown;
  payment_tx_hash: unknown;
  delivery_status: unknown;
  buyer_approved_at: unknown;
  dispute_status: unknown;
  release_tx_hash: unknown;
}

export interface DealRoomPolicyRow {
  deal_id: unknown;
  deal_amount: unknown;
  fee_percent: unknown;
  fee_amount: unknown;
  seller_net_amount: unknown;
  chain_id: unknown;
  safe_address: unknown;
  token_contract: unknown;
  seller_wallet: unknown;
  platform_wallet: unknown;
  safe_nonce: unknown;
  status: unknown;
}

export interface DealRoomW3MAdapterInput {
  client: W3MRegistryReadClient;
  deal: DealRoomDealRow;
  policy: DealRoomPolicyRow;
  stage: SettlementStage;
  now: string;
  safeConfigurationMatches: boolean;
}

function exactText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("W3M requires exact PostgreSQL text for " + field + ".");
  }
  return value;
}

function idText(value: unknown, field: string): string {
  return exactText(value, field);
}

function chainId(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error("W3M requires an integer " + field + ".");
  }
  return value;
}

export async function evaluateDealRoomRowsWithW3M(
  input: DealRoomW3MAdapterInput,
  recoverAndVerify?: EthereumDigestRecoveryVerifier,
): Promise<DealRoomW3MServiceResult> {
  const d = input.deal;
  const p = input.policy;
  if (String(p.deal_id) !== String(d.id)) {
    throw new Error("W3M release policy is not bound to the current deal.");
  }
  if (String(d.dispute_status ?? "").trim().toLowerCase() !== "none") {
    throw new Error("W3M V1 blocks every dispute status except exact 'none'.");
  }
  const paymentConfirmed = d.payment_status === "confirmed" &&
    typeof d.payment_tx_hash === "string" && d.payment_tx_hash.trim().length > 0;
  const deliveryAccepted = d.delivery_status === "accepted" &&
    typeof d.buyer_approved_at === "string" && d.buyer_approved_at.trim().length > 0;

  return await checkDealRoomWithW3M({
    client: input.client,
    terms: {
      dealId: idText(d.id, "deal ID"),
      projectId: idText(d.project_id, "project ID"),
      buyerId: idText(d.buyer_id, "buyer ID"),
      sellerId: idText(d.seller_id, "seller ID"),
      amount: exactText(d.amount, "deal amount"),
      currency: exactText(d.currency, "deal currency"),
      expectedAmount: d.expected_amount === null
        ? null
        : exactText(d.expected_amount, "expected amount"),
      chainId: chainId(d.chain_id, "deal chain ID"),
      safeAddress: exactText(d.safe_address, "deal Safe address"),
      tokenContract: exactText(d.token_contract, "deal token contract"),
      policy: {
        dealAmount: exactText(p.deal_amount, "policy deal amount"),
        feePercent: exactText(p.fee_percent, "policy fee percent"),
        feeAmount: exactText(p.fee_amount, "policy fee amount"),
        sellerNetAmount: exactText(p.seller_net_amount, "policy seller net amount"),
        chainId: chainId(p.chain_id, "policy chain ID"),
        safeAddress: exactText(p.safe_address, "policy Safe address"),
        tokenContract: exactText(p.token_contract, "policy token contract"),
        sellerWallet: exactText(p.seller_wallet, "policy seller wallet"),
        platformWallet: exactText(p.platform_wallet, "policy platform wallet"),
        safeNonce: typeof p.safe_nonce === "number" && Number.isSafeInteger(p.safe_nonce)
          ? String(p.safe_nonce)
          : exactText(p.safe_nonce, "policy Safe nonce"),
        status: p.status === "locked" ? "locked" : p.status === "ready" ? "ready" : (() => {
          throw new Error("W3M release policy must be locked or ready.");
        })(),
      },
    },
    stage: input.stage,
    now: input.now,
    paymentConfirmed,
    deliveryAccepted,
    disputeOpen: false,
    safeConfigurationMatches: input.safeConfigurationMatches,
    releaseAlreadyFinalized: typeof d.release_tx_hash === "string" && d.release_tx_hash.length > 0,
  }, recoverAndVerify);
}
