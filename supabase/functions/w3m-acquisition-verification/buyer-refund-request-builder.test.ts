import {
  buildBuyerRefundRequestIntent,
  W3M_BNB_USDT,
  W3M_PLATFORM_WALLET,
  type BuyerRefundRequestContext,
} from "./buyer-refund-request-builder.ts";
const SAFE="0x1111111111111111111111111111111111111111";
const BUYER="0x4444444444444444444444444444444444444444";
const SELLER="0x6666666666666666666666666666666666666666";
const HASH="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const UUID="11111111-1111-4111-8111-111111111111";
function fixture(): BuyerRefundRequestContext {
  return {
    decision:{id:UUID,dealId:UUID,disputeId:"22222222-2222-4222-8222-222222222222",outcome:"buyer_wins",decisionHash:"a".repeat(64),termsHash:"b".repeat(64),refundAmount:"92.5"},
    terms:{dealId:UUID,termsHash:"b".repeat(64),originalDealAmount:"100",chainId:56,safeAddress:SAFE,buyerId:"buyer-id",sellerId:"seller-id",buyerAccepted:true,sellerAccepted:true},
    deal:{id:UUID,buyerId:"buyer-id",sellerId:"seller-id",status:"disputed",disputeStatus:"resolved_buyer",chainId:56,safeAddress:SAFE,tokenAddress:W3M_BNB_USDT},
    buyer:{id:"buyer-id",wallet:BUYER,verified:true},
    seller:{id:"seller-id",wallet:SELLER,verified:true},
    funding:{confirmed:true,chainId:56,tokenAddress:W3M_BNB_USDT,safeAddress:SAFE,amount:"100",txHash:HASH,blockHash:HASH,confirmations:12},
    safe:{address:SAFE,chainId:56,nonce:"9",blockNumber:"500",blockHash:HASH,owners:[BUYER,SELLER,W3M_PLATFORM_WALLET],threshold:2,balance:"100"},
  };
}
function rejects(fn:()=>unknown, code:string) {
  try { fn(); } catch(e) { if(e instanceof Error && e.message===code) return; throw e; }
  throw new Error("Expected "+code);
}
Deno.test("builds buyer refund intent from immutable decision and live 2-of-3 Safe facts",()=>{
  const result=buildBuyerRefundRequestIntent(fixture());
  if(result.action!=="refund_to_buyer" || result.buyerRefundAmount!=="92.5" ||
     result.originalDealAmount!=="100" || result.platformFeeAmount!=="7.5" ||
     result.decisionHash!=="a".repeat(64) ||
     result.safeNonce!=="9" || result.transfers.length!==2 ||
     result.transfers[0].recipient!==BUYER || result.transfers[1].recipient!==W3M_PLATFORM_WALLET.toLowerCase()) {
    throw new Error("Buyer refund intent did not preserve the exact approved bindings.");
  }
});
Deno.test("rejects seller-win decisions",()=>{
  const x=fixture(); x.decision.outcome="seller_wins";
  rejects(()=>buildBuyerRefundRequestIntent(x),"BUYER_REFUND_REQUIRES_BUYER_WIN_DECISION");
});
Deno.test("rejects changed signed terms and mismatched deal binding",()=>{
  const terms=fixture(); terms.decision.termsHash="c".repeat(64);
  rejects(()=>buildBuyerRefundRequestIntent(terms),"DECISION_TERMS_HASH_MISMATCH");
  const deal=fixture(); deal.decision.dealId="33333333-3333-4333-8333-333333333333";
  rejects(()=>buildBuyerRefundRequestIntent(deal),"DECISION_DEAL_BINDING_MISMATCH");
});
Deno.test("rejects noncanonical funding and wrong token",()=>{
  const x=fixture(); x.funding.confirmed=false;
  rejects(()=>buildBuyerRefundRequestIntent(x),"CONFIRMED_BNB_FUNDING_REQUIRED");
  const y=fixture(); y.deal.tokenAddress=SAFE;
  rejects(()=>buildBuyerRefundRequestIntent(y),"OFFICIAL_BNB_USDT_REQUIRED");
});
Deno.test("requires exact live Safe owner set and 2-of-3 threshold",()=>{
  const x=fixture(); x.safe.threshold=1;
  rejects(()=>buildBuyerRefundRequestIntent(x),"LIVE_SAFE_MUST_MATCH_EXACT_2_OF_3_OWNER_SET");
  const y=fixture(); y.safe.owners=[BUYER,SELLER,SELLER];
  rejects(()=>buildBuyerRefundRequestIntent(y),"LIVE_SAFE_MUST_MATCH_EXACT_2_OF_3_OWNER_SET");
});
Deno.test("bounds refund by confirmed deal funding and actual Safe balance",()=>{
  const x=fixture(); x.decision.refundAmount="101"; x.safe.balance="200";
  rejects(()=>buildBuyerRefundRequestIntent(x),"REFUND_AMOUNT_OUT_OF_CONFIRMED_FUNDING_BOUNDS");
  const y=fixture(); y.safe.balance="99.99";
  rejects(()=>buildBuyerRefundRequestIntent(y),"SAFE_BALANCE_INSUFFICIENT_FOR_REFUND_AND_FIXED_PLATFORM_FEE");
});
Deno.test("rejects a disputed deal without buyer-win state",()=>{
  const x=fixture(); x.deal.disputeStatus="open";
  rejects(()=>buildBuyerRefundRequestIntent(x),"DEAL_NOT_IN_BUYER_REFUND_STATE");
});
