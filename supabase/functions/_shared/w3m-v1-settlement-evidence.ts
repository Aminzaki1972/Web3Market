export type W3MSettlementEvidenceClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

export type W3MCanonicalSettlement = {
  dealId: string;
  termsVersion: string;
  termsHash: string;
  considerationAmount: string;
  currency: string;
  feePercent: string;
  feeAmount: string;
  sellerNetAmount: string;
  paymentAsset: string;
  tokenContract: string | null;
};

export class W3MSettlementEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "W3MSettlementEvidenceError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const BSC_USDT = "0x55d398326f99059ff775485246999027b3197955";

function field(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new W3MSettlementEvidenceError(label + " is missing or malformed.");
  }
  return value as Record<string, unknown>;
}
function decimal(value: unknown, label: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new W3MSettlementEvidenceError(label + " is missing.");
  }
  const result = String(value);
  if (!DECIMAL.test(result)) throw new W3MSettlementEvidenceError(label + " is not a plain decimal.");
  return result;
}
function scaleOf(value: string): number {
  return value.includes(".") ? value.length - value.indexOf(".") - 1 : 0;
}
function minor(value: string, scale: number): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * (10n ** BigInt(scale)) +
    BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0");
}
function normalizedAmount(value: unknown, label: string): string {
  const result = decimal(value, label);
  if (minor(result, scaleOf(result)) <= 0n) {
    throw new W3MSettlementEvidenceError(label + " must be positive.");
  }
  return result;
}

export async function getW3MCanonicalSettlement(
  admin: W3MSettlementEvidenceClient,
  dealId: string,
): Promise<W3MCanonicalSettlement> {
  if (!UUID.test(dealId)) throw new W3MSettlementEvidenceError("Deal ID is invalid.");
  const { data, error } = await admin.rpc("w3m_get_current_deal_settlement_terms", {
    p_deal_id: dealId,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new W3MSettlementEvidenceError("Current signed settlement terms could not be loaded.");
  }
  const envelope = data as Record<string, unknown>;
  const canonical = field(envelope.canonical_terms_json, "canonical_terms_json");
  if (String(envelope.deal_id || "").toLowerCase() !== dealId.toLowerCase() ||
      !/^[1-9][0-9]*$/.test(String(envelope.terms_version || "")) ||
      !HASH.test(String(envelope.terms_hash || "")) ||
      String(canonical.schema || "") !== "w3m-acquisition-terms-v1" ||
      String(canonical.terms_version || "") !== String(envelope.terms_version)) {
    throw new W3MSettlementEvidenceError("Current terms envelope does not match its canonical snapshot.");
  }

  const consideration = field(canonical.consideration, "consideration");
  const fee = field(canonical.platform_fee, "platform_fee");
  const net = field(canonical.seller_net, "seller_net");
  const payment = field(canonical.payment, "payment");
  const safe = field(canonical.safe_settlement, "safe_settlement");
  const considerationAmount = normalizedAmount(consideration.amount, "consideration.amount");
  const feeAmount = normalizedAmount(fee.amount, "platform_fee.amount");
  const sellerNetAmount = normalizedAmount(net.amount, "seller_net.amount");
  const feePercent = decimal(fee.percent, "platform_fee.percent");
  const currency = String(consideration.currency || "").trim().toUpperCase();
  const netCurrency = String(net.currency || "").trim().toUpperCase();
  const paymentAsset = String(payment.asset || "").trim().toUpperCase();
  const tokenContract = payment.token_contract == null ? null : String(payment.token_contract).toLowerCase();

  if (feePercent !== "7.5" && feePercent !== "7.50" && feePercent !== "7.500") {
    throw new W3MSettlementEvidenceError("Signed platform fee percentage is not the approved W3M V1 rate.");
  }
  if (currency !== "USDT" || netCurrency !== currency || paymentAsset !== "USDT" ||
      payment.method !== "safe_multisig" || payment.chain_id !== 56 ||
      safe.method !== "safe_multisig" || safe.dispute_hold !== true ||
      (tokenContract !== null && tokenContract !== BSC_USDT)) {
    throw new W3MSettlementEvidenceError("Signed settlement asset or Safe configuration is not supported by the current BNB settlement route.");
  }

  const scale = Math.max(scaleOf(considerationAmount), scaleOf(feeAmount), scaleOf(sellerNetAmount));
  const totalMinor = minor(considerationAmount, scale);
  const feeMinor = minor(feeAmount, scale);
  const netMinor = minor(sellerNetAmount, scale);
  const expectedFeeMinor = (totalMinor * 75n + 500n) / 1000n;
  if (feeMinor !== expectedFeeMinor || feeMinor + netMinor !== totalMinor) {
    throw new W3MSettlementEvidenceError("Signed fee and seller net do not reconcile to the final agreed consideration.");
  }

  return {
    dealId,
    termsVersion: String(envelope.terms_version),
    termsHash: String(envelope.terms_hash).toLowerCase(),
    considerationAmount,
    currency,
    feePercent: "7.5",
    feeAmount,
    sellerNetAmount,
    paymentAsset,
    tokenContract,
  };
}

export function assertW3MSettlementPolicyMatches(
  settlement: W3MCanonicalSettlement,
  policy: Record<string, unknown>,
): void {
  const dealAmount = decimal(policy.deal_amount, "release_policy.deal_amount");
  const feeAmount = decimal(policy.fee_amount, "release_policy.fee_amount");
  const sellerNetAmount = decimal(policy.seller_net_amount, "release_policy.seller_net_amount");
  const feePercent = decimal(policy.fee_percent, "release_policy.fee_percent");
  const scale = Math.max(
    scaleOf(dealAmount), scaleOf(feeAmount), scaleOf(sellerNetAmount),
    scaleOf(settlement.considerationAmount), scaleOf(settlement.feeAmount),
    scaleOf(settlement.sellerNetAmount),
  );
  if (minor(dealAmount, scale) !== minor(settlement.considerationAmount, scale) ||
      minor(feeAmount, scale) !== minor(settlement.feeAmount, scale) ||
      minor(sellerNetAmount, scale) !== minor(settlement.sellerNetAmount, scale) ||
      feePercent !== "7.5" && feePercent !== "7.50" && feePercent !== "7.500") {
    throw new W3MSettlementEvidenceError("Locked Safe release policy does not match the exact signed W3M V1 consideration, platform fee, and seller net.");
  }
  if (String(policy.token_contract || "").toLowerCase() !== BSC_USDT ||
      Number(policy.chain_id) !== 56) {
    throw new W3MSettlementEvidenceError("Locked Safe release policy does not match the configured BNB USDT settlement asset.");
  }
}
