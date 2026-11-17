import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { finalizeVerifiedDealPayment } from "./deal-payment-finalization-rpc-adapter.ts";

const receipt={
  chainId:56 as const,
  transactionHash:"0x"+"1".repeat(64),
  blockHash:"0x"+"2".repeat(64),
  blockNumber:"123",
  confirmations:5,
  buyerWallet:"0x"+"3".repeat(40),
  safeAddress:"0x"+"4".repeat(40),
  tokenContract:"0x55d398326f99059ff775485246999027b3197955",
  amountBaseUnits:"10000000000000000000",
  logIndex:"7",
};
Deno.test("calls only the atomic finalization RPC with verified evidence",async()=>{
 let calls=0;
 const client={rpc:async(name:string,args:Record<string,unknown>)=>{
   calls++;
   assertEquals(name,"w3m_finalize_deal_payment");
   assertEquals(args.p_deal_id,"deal-1");
   assertEquals(args.p_actor_id,"buyer-1");
   assertEquals(args.p_tx_hash,receipt.transactionHash);
   assertEquals(args.p_verified_receipt,receipt);
   return {data:{ok:true,verified:true,idempotent:false,deal_id:"deal-1",tx_hash:receipt.transactionHash},error:null};
 }};
 const result=await finalizeVerifiedDealPayment(client,{dealId:"deal-1",actorId:"buyer-1",receipt});
 assertEquals(result.ok,true);
 assertEquals(calls,1);
});
Deno.test("propagates database atomicity and uniqueness failures",async()=>{
 const client={rpc:async()=>({data:null,error:{message:"W3M_PAYMENT_TRANSACTION_HASH_ALREADY_BOUND"}})};
 await assertRejects(()=>finalizeVerifiedDealPayment(client,{dealId:"deal-1",actorId:"buyer-1",receipt}),Error,"W3M_PAYMENT_TRANSACTION_HASH_ALREADY_BOUND");
});
Deno.test("fails closed on malformed RPC response",async()=>{
 const client={rpc:async()=>({data:{ok:true,verified:true,deal_id:"other-deal",tx_hash:receipt.transactionHash},error:null})};
 await assertRejects(()=>finalizeVerifiedDealPayment(client,{dealId:"deal-1",actorId:"buyer-1",receipt}),Error,"RESPONSE_INVALID");
});
Deno.test("rejects invalid caller input before making an RPC call",async()=>{
 let calls=0;
 const client={rpc:async()=>{calls++;return {data:null,error:null}}};
 await assertRejects(()=>finalizeVerifiedDealPayment(client,{dealId:"",actorId:"buyer-1",receipt}),Error,"INPUT_INVALID");
 assertEquals(calls,0);
});
