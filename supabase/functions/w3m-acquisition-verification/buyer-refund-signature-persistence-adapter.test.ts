import {persistBuyerRefundSignatureAtomically,type BuyerRefundSignaturePersistenceInput} from "./buyer-refund-signature-persistence-adapter.ts";
import type {W3MRpcClient} from "./supabase-rpc-adapter.ts";
const input:BuyerRefundSignaturePersistenceInput={
 actorId:"11111111-1111-4111-8111-111111111111",dealId:"22222222-2222-4222-8222-222222222222",
 requestId:"33333333-3333-4333-8333-333333333333",decisionId:"44444444-4444-4444-8444-444444444444",
 decisionHash:"a".repeat(64),termsHash:"b".repeat(64),safeTransactionHash:"0x"+"c".repeat(64),
 safeAddress:"0x"+"d".repeat(40),safeNonce:"8",signature:"0x"+"e".repeat(130),
 verifiedWallet:"0x"+"1".repeat(40),buyerWallet:"0x"+"1".repeat(40),signerRole:"buyer",
 authorization:{authorized:true,phase:"SIGN",requestId:"33333333-3333-4333-8333-333333333333",safeTransactionHash:"0x"+"c".repeat(64),issues:[]},
};
Deno.test("buyer refund signature adapter calls only the dedicated atomic RPC",async()=>{
 let name="",args:Record<string,unknown>={};
 const client:W3MRpcClient={rpc:async(n,a)=>{name=n;args=a;return {data:{recorded:true,idempotent_replay:false,confirmations_count:1,required_signatures:2,status:"awaiting_signatures"},error:null}}};
 const result=await persistBuyerRefundSignatureAtomically(client,input);
 if(name!=="w3m_record_buyer_refund_signature")throw new Error("Wrong RPC selected");
 if(args.p_request_id!==input.requestId||args.p_actor_id!==input.actorId||args.p_signer_role!=="buyer")throw new Error("Refund request identity binding lost");
 if(result.confirmationsCount!==1||result.status!=="awaiting_signatures")throw new Error("RPC result mapping failed");
});
Deno.test("buyer refund signature adapter rejects stale authorization before RPC",async()=>{
 let calls=0;const client:W3MRpcClient={rpc:async()=>{calls++;return {data:null,error:null}}};
 try{await persistBuyerRefundSignatureAtomically(client,{...input,authorization:{...input.authorization,issues:["STALE"] as unknown as []}});throw new Error("Expected rejection")}
 catch(e){if(!(e instanceof Error)||!e.message.includes("Fresh request-bound"))throw e}
 if(calls!==0)throw new Error("Stale authorization reached RPC");
});
Deno.test("buyer refund signature adapter rejects malformed input before RPC",async()=>{
 let calls=0;const client:W3MRpcClient={rpc:async()=>{calls++;return {data:null,error:null}}};
 try{await persistBuyerRefundSignatureAtomically(client,{...input,safeNonce:"08"});throw new Error("Expected rejection")}
 catch(e){if(!(e instanceof Error)||!e.message.includes("malformed"))throw e}
 if(calls!==0)throw new Error("Malformed input reached RPC");
});
