// W3M Protocol V1 — server-derived buyer refund Safe request intent.
// This pure builder does not persist, sign, broadcast, or finalize a transaction.
// Every input must be loaded by a trusted server adapter, never copied from browser fields.
const SCALE = 10n ** 18n;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^(0|[1-9][0-9]*)$/;
const DECIMAL = /^(0|[1-9][0-9]*)(?:\\.([0-9]{1,18}))?$/;
export const W3M_BNB_CHAIN_ID = 56;
export const W3M_BNB_USDT = "0x55d398326f99059ff775485246999027b3197955";
export const W3M_PLATFORM_WALLET = "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9";

export interface BuyerRefundRequestContext {
  decision: { id: string; dealId: string; disputeId: string; outcome: "buyer_wins" | "seller_wins"; decisionHash: string; termsHash: string; refundAmount: string };
  terms: { dealId: string; termsHash: string; originalDealAmount: string; chainId: number; safeAddress: string; buyerId: string; sellerId: string; buyerAccepted: boolean; sellerAccepted: boolean };
  deal: { id: string; buyerId: string; sellerId: string; status: string; disputeStatus: string; chainId: number; safeAddress: string; tokenAddress: string };
  buyer: { id: string; wallet: string; verified: boolean };
  seller: { id: string; wallet: string; verified: boolean };
  funding: { confirmed: boolean; chainId: number; tokenAddress: string; safeAddress: string; amount: string; txHash: string; blockHash: string; confirmations: number };
  safe: { address: string; chainId: number; nonce: string; blockNumber: string; blockHash: string; owners: string[]; threshold: number; balance: string };
}
export interface BuyerRefundRequestIntent {
  action: "refund_to_buyer";
  decisionId: string;
  decisionHash: string;
  disputeId: string;
  dealId: string;
  termsHash: string;
  chainId: 56;
  safeAddress: string;
  safeNonce: string;
  safeSnapshot: { blockNumber: string; blockHash: string };
  tokenAddress: string;
  buyerRecipient: string;
  buyerRefundAmount: string;
  originalDealAmount: string;
  platformFeeAmount: string;
  confirmedFundedAmount: string;
  confirmedSafeBalance: string;
  transfers: Array<{ to: string; method: "transfer"; recipient: string; amount: string }>;
}
function parseDecimal(value: string): bigint {
  if (!DECIMAL.test(value)) throw new Error("REFUND_AMOUNT_FORMAT_INVALID");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt((fraction + "0".repeat(18)).slice(0, 18));
}
function formatDecimal(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}
function address(value: string): string { if (!ADDRESS.test(value || "")) throw new Error("REFUND_ADDRESS_INVALID"); return value.toLowerCase(); }
function hash(value: string): string { if (!HASH.test(value || "")) throw new Error("REFUND_HASH_INVALID"); return value.toLowerCase(); }

/** Builds only the exact two-transfer intent after revalidating immutable server-side context. */
export function buildBuyerRefundRequestIntent(c: BuyerRefundRequestContext): BuyerRefundRequestIntent {
  if (c.decision.outcome !== "buyer_wins") throw new Error("BUYER_REFUND_REQUIRES_BUYER_WIN_DECISION");
  if (c.deal.status !== "disputed" || c.deal.disputeStatus !== "resolved_buyer") throw new Error("DEAL_NOT_IN_BUYER_REFUND_STATE");
  if (c.decision.dealId !== c.deal.id || c.decision.disputeId === "" || c.terms.dealId !== c.deal.id) throw new Error("DECISION_DEAL_BINDING_MISMATCH");
  if (c.decision.termsHash !== c.terms.termsHash || !/^[0-9a-f]{64}$/.test(c.terms.termsHash)) throw new Error("DECISION_TERMS_HASH_MISMATCH");
  hash(c.decision.decisionHash);
  if (c.terms.buyerId !== c.deal.buyerId || c.terms.sellerId !== c.deal.sellerId ||
      c.buyer.id !== c.deal.buyerId || c.seller.id !== c.deal.sellerId ||
      !c.buyer.verified || !c.seller.verified || !c.terms.buyerAccepted || !c.terms.sellerAccepted) {
    throw new Error("PARTICIPANT_WALLET_OR_SIGNED_TERMS_NOT_VERIFIED");
  }
  if (c.deal.chainId !== 56 || c.terms.chainId !== 56 || c.funding.chainId !== 56 ||
      c.safe.chainId !== 56 || c.funding.confirmed !== true || c.funding.confirmations < 1 ||
      !HASH.test(c.funding.txHash) || !HASH.test(c.funding.blockHash)) {
    throw new Error("CONFIRMED_BNB_FUNDING_REQUIRED");
  }
  const safe = address(c.deal.safeAddress);
  if (address(c.terms.safeAddress) !== safe || address(c.safe.address) !== safe ||
      address(c.funding.safeAddress) !== safe) throw new Error("SAFE_ADDRESS_BINDING_MISMATCH");
  if (address(c.deal.tokenAddress) !== W3M_BNB_USDT ||
      address(c.terms.safeAddress) !== safe || address(c.funding.tokenAddress) !== W3M_BNB_USDT) {
    throw new Error("OFFICIAL_BNB_USDT_REQUIRED");
  }
  if (!UINT.test(c.safe.nonce) || !UINT.test(c.safe.blockNumber) || !HASH.test(c.safe.blockHash)) throw new Error("SAFE_SNAPSHOT_INVALID");
  const buyer = address(c.buyer.wallet);
  const seller = address(c.seller.wallet);
  if (buyer === seller || buyer === W3M_PLATFORM_WALLET || seller === W3M_PLATFORM_WALLET) throw new Error("SAFE_OWNER_ROLES_MUST_BE_DISTINCT");
  const owners = c.safe.owners.map(address);
  if (owners.length !== 3 || new Set(owners).size !== 3 ||
      ![buyer, seller, W3M_PLATFORM_WALLET].every((owner) => owners.includes(owner)) ||
      c.safe.threshold !== 2) throw new Error("LIVE_SAFE_MUST_MATCH_EXACT_2_OF_3_OWNER_SET");
  const original = parseDecimal(c.terms.originalDealAmount);
  const funded = parseDecimal(c.funding.amount);
  const refund = parseDecimal(c.decision.refundAmount);
  const balance = parseDecimal(c.safe.balance);
  if (original <= 0n || funded <= 0n || refund <= 0n || refund > funded) throw new Error("REFUND_AMOUNT_OUT_OF_CONFIRMED_FUNDING_BOUNDS");
  const fee = (original * 75n + 500n) / 1000n;
  if (refund + fee > balance) throw new Error("SAFE_BALANCE_INSUFFICIENT_FOR_REFUND_AND_FIXED_PLATFORM_FEE");
  return {
    action: "refund_to_buyer",
    decisionId: c.decision.id,
    decisionHash: hash(c.decision.decisionHash),
    disputeId: c.decision.disputeId,
    dealId: c.deal.id,
    termsHash: c.terms.termsHash,
    chainId: 56,
    safeAddress: safe,
    safeNonce: c.safe.nonce,
    safeSnapshot: { blockNumber: c.safe.blockNumber, blockHash: hash(c.safe.blockHash) },
    tokenAddress: W3M_BNB_USDT,
    buyerRecipient: buyer,
    buyerRefundAmount: formatDecimal(refund),
    originalDealAmount: formatDecimal(original),
    platformFeeAmount: formatDecimal(fee),
    confirmedFundedAmount: formatDecimal(funded),
    confirmedSafeBalance: formatDecimal(balance),
    transfers: [
      { to: W3M_BNB_USDT, method: "transfer", recipient: buyer, amount: formatDecimal(refund) },
      { to: W3M_BNB_USDT, method: "transfer", recipient: W3M_PLATFORM_WALLET, amount: formatDecimal(fee) },
    ],
  };
}
