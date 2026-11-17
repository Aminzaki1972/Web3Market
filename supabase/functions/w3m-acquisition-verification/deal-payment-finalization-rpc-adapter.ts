import type { VerifiedBnbDealPaymentReceipt } from "./bnb-deal-payment-receipt-verifier.ts";

export interface DealPaymentFinalizationRpcClient {
  rpc(
    functionName: string,
    args: {
      p_deal_id: string;
      p_actor_id: string;
      p_tx_hash: string;
      p_verified_receipt: VerifiedBnbDealPaymentReceipt;
    },
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
}

export interface DealPaymentFinalizationResult {
  ok: true;
  verified: true;
  idempotent: boolean;
  deal_id: string;
  tx_hash: string;
  [key: string]: unknown;
}

/** Calls the single atomic DB boundary; intentionally does not upsert or issue separate writes. */
export async function finalizeVerifiedDealPayment(
  client: DealPaymentFinalizationRpcClient,
  input: {
    dealId: string;
    actorId: string;
    receipt: VerifiedBnbDealPaymentReceipt;
  },
): Promise<DealPaymentFinalizationResult> {
  if (!input.dealId || !input.actorId ||
      !/^0x[0-9a-f]{64}$/i.test(input.receipt.transactionHash)) {
    throw new Error("DEAL_PAYMENT_FINALIZATION_INPUT_INVALID");
  }
  const { data, error } = await client.rpc("w3m_finalize_deal_payment", {
    p_deal_id: input.dealId,
    p_actor_id: input.actorId,
    p_tx_hash: input.receipt.transactionHash,
    p_verified_receipt: input.receipt,
  });
  if (error) {
    throw new Error("DEAL_PAYMENT_FINALIZATION_FAILED: " + (error.message || "database RPC rejected"));
  }
  if (!data || typeof data !== "object" ||
      (data as Record<string, unknown>).ok !== true ||
      (data as Record<string, unknown>).verified !== true ||
      (data as Record<string, unknown>).deal_id !== input.dealId ||
      String((data as Record<string, unknown>).tx_hash || "").toLowerCase() !== input.receipt.transactionHash.toLowerCase()) {
    throw new Error("DEAL_PAYMENT_FINALIZATION_RESPONSE_INVALID");
  }
  return data as DealPaymentFinalizationResult;
}
