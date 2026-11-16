import { buildBuyerRefundRequestIntent, W3M_BNB_USDT, W3M_PLATFORM_WALLET } from "./buyer-refund-request-builder.ts";
import { buildBuyerRefundSafeTransaction, W3M_BNB_MULTISEND_CALL_ONLY } from "./buyer-refund-safe-transaction-builder.ts";
import { decodeSafeMultiSendCalldata } from "./safe-multisend-decoder.ts";
import { validateSafeRefundPayload } from "./safe-refund-payload-validator.ts";

const DEAL = "81000000-0000-4000-8000-000000000001";
const DISPUTE = "82000000-0000-4000-8000-000000000002";
const DECISION = "83000000-0000-4000-8000-000000000003";
const BUYER_ID = "84000000-0000-4000-8000-000000000004";
const SELLER_ID = "85000000-0000-4000-8000-000000000005";
const SAFE = "0x1111111111111111111111111111111111111111";
const BUYER = "0x2222222222222222222222222222222222222222";
const SELLER = "0x3333333333333333333333333333333333333333";
const HASH = "0x" + "a".repeat(64);
const TERMS_HASH = "b".repeat(64);

function intent() {
  return buildBuyerRefundRequestIntent({
    decision: { id: DECISION, dealId: DEAL, disputeId: DISPUTE, outcome: "buyer_wins", decisionHash: "c".repeat(64), termsHash: TERMS_HASH, buyerRefundAmount: "50" },
    terms: { dealId: DEAL, termsHash: TERMS_HASH, originalDealAmount: "100", chainId: 56, safeAddress: SAFE, buyerId: BUYER_ID, sellerId: SELLER_ID, buyerAccepted: true, sellerAccepted: true },
    deal: { id: DEAL, buyerId: BUYER_ID, sellerId: SELLER_ID, status: "disputed", disputeStatus: "resolved_buyer", chainId: 56, safeAddress: SAFE, tokenAddress: W3M_BNB_USDT },
    buyer: { id: BUYER_ID, wallet: BUYER, verified: true },
    seller: { id: SELLER_ID, wallet: SELLER, verified: true },
    funding: { confirmed: true, chainId: 56, tokenAddress: W3M_BNB_USDT, safeAddress: SAFE, amount: "100", txHash: HASH, blockHash: HASH, confirmations: 20 },
    safe: { address: SAFE, chainId: 56, nonce: "7", blockNumber: "90000000", blockHash: HASH, owners: [BUYER, SELLER, W3M_PLATFORM_WALLET], threshold: 2, balance: "107.5" },
  });
}
function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }

Deno.test("builds exact two-transfer buyer refund MultiSend calldata", () => {
  const built = buildBuyerRefundSafeTransaction(intent(), "7");
  assert(built.chainId === 56 && built.safeAddress === SAFE.toLowerCase(), "chain and Safe binding must be exact");
  assert(built.safeTransaction.to === W3M_BNB_MULTISEND_CALL_ONLY, "must target official MultiSendCallOnly");
  assert(built.safeTransaction.operation === 1 && built.safeTransaction.value === "0", "outer Safe operation/value must be exact");
  assert(built.safeTransaction.nonce === "7", "must bind live Safe nonce");
  const decoded = decodeSafeMultiSendCalldata(built.safeTransaction.data);
  assert(decoded.valid && decoded.calls.length === 2, JSON.stringify(decoded.issues));
  const decision = validateSafeRefundPayload({
    chainId: 56, safeAddress: SAFE, expectedSafeAddress: SAFE,
    outerTo: built.safeTransaction.to, expectedMultiSendCallOnly: W3M_BNB_MULTISEND_CALL_ONLY,
    outerOperation: built.safeTransaction.operation, outerValue: built.safeTransaction.value,
    tokenAddress: W3M_BNB_USDT, expectedTokenAddress: W3M_BNB_USDT,
    buyerWallet: BUYER, platformWallet: W3M_PLATFORM_WALLET,
    originalDealAmount: "100000000000000000000",
    buyerRefundAmount: "50000000000000000000",
    confirmedFundedAmount: "100000000000000000000",
    platformFeeAmount: "7500000000000000000",
    confirmedSafeBalance: "107500000000000000000",
    calls: decoded.calls,
  });
  assert(decision.valid, JSON.stringify(decision.issues));
});

Deno.test("blocks a Safe nonce that differs from the canonical intent", () => {
  let blocked = false;
  try { buildBuyerRefundSafeTransaction(intent(), "8"); } catch { blocked = true; }
  assert(blocked, "changed Safe nonce must block transaction construction");
});

Deno.test("blocks transfer recipient or amount substitution before encoding", () => {
  const value = intent();
  const altered = { ...value, transfers: [
    value.transfers[0],
    { ...value.transfers[1], recipient: BUYER },
  ] };
  let blocked = false;
  try { buildBuyerRefundSafeTransaction(altered, "7"); } catch { blocked = true; }
  assert(blocked, "platform fee must not be redirected to the buyer");
});
