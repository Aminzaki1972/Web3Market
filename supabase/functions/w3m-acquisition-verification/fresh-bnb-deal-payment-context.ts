// Build payment expectations exclusively from freshly loaded, server-trusted rows.
import type { BnbDealPaymentExpectation } from "./bnb-deal-payment-receipt-verifier.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const BNB_USDT = "0x55d398326f99059ff775485246999027b3197955";
const TOKEN_DECIMALS = 18;

export interface FreshDealPaymentRow {
  id: string;
  buyer_id: string;
  amount: string | number;
  expected_amount: string | number | null;
  status: string;
  payment_status: string | null;
  payment_tx_hash: string | null;
  chain_id: number | string;
  safe_address: string;
  token_contract: string;
}
export interface FreshVerifiedWalletRow {
  wallet_address: string;
  wallet_verified: boolean;
}
export interface FreshDealPaymentContextInput {
  actorUserId: string;
  deal: FreshDealPaymentRow;
  buyer: FreshVerifiedWalletRow;
  seller: FreshVerifiedWalletRow;
  transactionHash: string;
  minConfirmations?: number;
}
export interface FreshDealPaymentContext {
  dealId: string;
  expectation: BnbDealPaymentExpectation;
}

function fail(message: string): never {
  throw new Error("DEAL_PAYMENT_CONTEXT_INVALID: " + message);
}

function toBaseUnits(value: string | number): string {
  const raw = String(value);
  if (!/^(0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(raw)) {
    fail("deal amount is not a canonical decimal value");
  }
  const [whole, fraction = ""] = raw.split(".");
  const base = BigInt(whole) * (10n ** 18n) +
    BigInt((fraction + "0".repeat(TOKEN_DECIMALS)).slice(0, TOKEN_DECIMALS));
  if (base <= 0n) fail("deal amount must be positive");
  return base.toString();
}

/** Call only after loading deal, buyer and seller rows from Supabase using server authority. */
export function buildFreshBnbDealPaymentContext(
  input: FreshDealPaymentContextInput,
): FreshDealPaymentContext {
  const { deal, buyer, seller, transactionHash } = input;
  if (!input.actorUserId || input.actorUserId !== deal.buyer_id) {
    fail("only the deal buyer may submit payment verification");
  }
  if (!deal.id || !deal.buyer_id || !deal.safe_address || !deal.token_contract) {
    fail("deal payment identity is incomplete");
  }
  if (Number(deal.chain_id) !== 56) fail("deal is not configured for BNB Chain mainnet");
  if (deal.token_contract.toLowerCase() !== BNB_USDT) {
    fail("deal token is not the approved BNB USDT contract");
  }
  if (!["accepted", "pending", "in_progress"].includes(deal.status)) {
    fail("deal status does not permit initial payment verification");
  }
  if (String(deal.payment_status ?? "pending").toLowerCase() !== "pending") {
    fail("deal payment is not pending");
  }
  if (deal.payment_tx_hash && deal.payment_tx_hash.toLowerCase() !== transactionHash.toLowerCase()) {
    fail("a different payment transaction is already recorded for this deal");
  }
  if (!HASH.test(transactionHash)) fail("transaction hash is malformed");
  if (!ADDRESS.test(buyer.wallet_address) || buyer.wallet_verified !== true) {
    fail("buyer wallet is missing or not verified");
  }
  if (!ADDRESS.test(seller.wallet_address) || seller.wallet_verified !== true) {
    fail("seller wallet is missing or not verified");
  }
  if (!ADDRESS.test(deal.safe_address)) fail("Safe address is malformed");
  if (buyer.wallet_address.toLowerCase() === deal.safe_address.toLowerCase()) {
    fail("buyer wallet cannot equal the deal Safe");
  }
  const amount = deal.expected_amount ?? deal.amount;
  const minConfirmations = input.minConfirmations ?? 3;
  if (!Number.isSafeInteger(minConfirmations) || minConfirmations < 1) {
    fail("confirmation policy is invalid");
  }
  return {
    dealId: deal.id,
    expectation: {
      transactionHash: transactionHash.toLowerCase(),
      buyerWallet: buyer.wallet_address.toLowerCase(),
      safeAddress: deal.safe_address.toLowerCase(),
      tokenContract: BNB_USDT,
      expectedAmountBaseUnits: toBaseUnits(amount),
      minConfirmations,
    },
  };
}
