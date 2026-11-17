import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { buildFreshBnbDealPaymentContext } from "./fresh-bnb-deal-payment-context.ts";

const BUYER="0x"+"1".repeat(40), SELLER="0x"+"3".repeat(40);
const SAFE="0x"+"2".repeat(40), TOKEN="0x55d398326f99059ff775485246999027b3197955";
const TX="0x"+"4".repeat(64);
const deal={
  id:"deal-1",buyer_id:"buyer-1",amount:"10.00",expected_amount:"10.75",
  status:"accepted",payment_status:"pending",payment_tx_hash:null,
  chain_id:56,safe_address:SAFE,token_contract:TOKEN,
};
const buyer={wallet_address:BUYER,wallet_verified:true};
const seller={wallet_address:SELLER,wallet_verified:true};
const input={actorUserId:"buyer-1",deal,buyer,seller,transactionHash:TX};

Deno.test("derives exact amount and identity from fresh server rows",()=>{
 const result=buildFreshBnbDealPaymentContext(input);
 assertEquals(result.dealId,"deal-1");
 assertEquals(result.expectation.expectedAmountBaseUnits,"10750000000000000000");
 assertEquals(result.expectation.buyerWallet,BUYER);
 assertEquals(result.expectation.safeAddress,SAFE);
 assertEquals(result.expectation.tokenContract,TOKEN);
 assertEquals(result.expectation.minConfirmations,3);
});
Deno.test("uses database deal amount only when expected_amount is null",()=>{
 const result=buildFreshBnbDealPaymentContext({...input,deal:{...deal,expected_amount:null}});
 assertEquals(result.expectation.expectedAmountBaseUnits,"10000000000000000000");
});
Deno.test("rejects a caller who is not the buyer",()=>{
 assertThrows(()=>buildFreshBnbDealPaymentContext({...input,actorUserId:"seller-1"}),Error,"only the deal buyer");
});
Deno.test("rejects wrong chain and unapproved token",()=>{
 assertThrows(()=>buildFreshBnbDealPaymentContext({...input,deal:{...deal,chain_id:1}}),Error,"BNB Chain");
 assertThrows(()=>buildFreshBnbDealPaymentContext({...input,deal:{...deal,token_contract:SELLER}}),Error,"approved BNB USDT");
});
Deno.test("rejects unverified wallets and invalid deal states",()=>{
 assertThrows(()=>buildFreshBnbDealPaymentContext({...input,buyer:{...buyer,wallet_verified:false}}),Error,"buyer wallet");
 assertThrows(()=>buildFreshBnbDealPaymentContext({...input,seller:{...seller,wallet_verified:false}}),Error,"seller wallet");
 assertThrows(()=>buildFreshBnbDealPaymentContext({...input,deal:{...deal,status:"completed"}}),Error,"status");
 assertThrows(()=>buildFreshBnbDealPaymentContext({...input,deal:{...deal,payment_status:"confirmed"}}),Error,"not pending");
});
Deno.test("allows an idempotent retry only for the same confirmed deal hash",()=>{
 const result=buildFreshBnbDealPaymentContext({...input,deal:{...deal,status:"funded",payment_status:"confirmed",payment_tx_hash:TX}});
 assertEquals(result.dealId,"deal-1");
 assertEquals(result.expectation.transactionHash,TX);
 assertThrows(()=>buildFreshBnbDealPaymentContext({...input,deal:{...deal,status:"funded",payment_status:"confirmed",payment_tx_hash:"0x"+"9".repeat(64)}}),Error,"status");
});
Deno.test("allows same-hash confirmed retry after the deal advances beyond funded",()=>{
 for (const status of ["in_progress", "completed", "disputed"]) {
  const result=buildFreshBnbDealPaymentContext({...input,deal:{...deal,status,payment_status:"confirmed",payment_tx_hash:TX}});
  assertEquals(result.expectation.transactionHash,TX);
 }
});
Deno.test("rejects transaction replay against another deal binding",()=>{
 assertThrows(()=>buildFreshBnbDealPaymentContext({...input,deal:{...deal,payment_tx_hash:"0x"+"9".repeat(64)}}),Error,"different payment transaction");
});
Deno.test("rejects malformed transaction hashes and noncanonical amount precision",()=>{
 assertThrows(()=>buildFreshBnbDealPaymentContext({...input,transactionHash:"0x1234"}),Error,"transaction hash");
 assertThrows(()=>buildFreshBnbDealPaymentContext({...input,deal:{...deal,expected_amount:"01.00"}}),Error,"canonical decimal");
 assertThrows(()=>buildFreshBnbDealPaymentContext({...input,deal:{...deal,expected_amount:"1.0000000000000000001"}}),Error,"canonical decimal");
 assertThrows(()=>buildFreshBnbDealPaymentContext({...input,deal:{...deal,expected_amount:"0"}}),Error,"positive");
});
