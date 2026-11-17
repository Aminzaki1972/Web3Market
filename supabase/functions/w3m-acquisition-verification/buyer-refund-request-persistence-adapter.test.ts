import {
  persistBuyerRefundRequestAtomically,
  type BuyerRefundRequestPersistenceInput,
} from "./buyer-refund-request-persistence-adapter.ts";
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";

const DEAL="81000000-0000-4000-8000-000000000001";
const ACTOR="82000000-0000-4000-8000-000000000002";
const DECISION="83000000-0000-4000-8000-000000000003";
const DISPUTE="84000000-0000-4000-8000-000000000004";
const REQUEST="85000000-0000-4000-8000-000000000005";
const TX="86000000-0000-4000-8000-000000000006";
const SAFE="0x1111111111111111111111111111111111111111";
const BUYER="0x2222222222222222222222222222222222222222";
const HASH="0x"+"a".repeat(64);
function fixture():BuyerRefundRequestPersistenceInput{
 const safeFacts={chain_id:56,safe_address:SAFE,nonce:"9",block_number:"500",block_hash:HASH,
  owners:[BUYER,"0x3333333333333333333333333333333333333333","0x2b15cc63ee3b833f502c065767695fa2b584f8c9"],
  threshold:2,balance:"107.5",safe_tx_hash:HASH};
 const authorization={authorized:true,phase:"CREATE_REFUND_REQUEST",deal_id:DEAL,
  agreement_acceptances_verified:true,buyer_acceptance_digest:HASH,seller_acceptance_digest:"0x"+"b".repeat(64),
  safe_hash_verified:true,safe_block_canonical:true,funding_receipt_verified:true,
  funding_block_canonical:true,payload_verified:true,safe_tx_hash:HASH,safe_block_hash:HASH,issues:[]};
 return {dealId:DEAL,actorId:ACTOR,
  intent:{action:"refund_to_buyer",chainId:56,decisionId:DECISION,disputeId:DISPUTE,decisionHash:"b".repeat(64),
   termsHash:"c".repeat(64),safeAddress:SAFE,buyerRecipient:BUYER,safeSnapshot:{blockNumber:"500",blockHash:HASH}},
  safeTransaction:{to:"0x9641d764fc13c8b624c04430c7356c1c7c8102e2",data:"0x1234",operation:1,value:"0",nonce:"9",
   safeTxGas:"0",baseGas:"0",gasPrice:"0",gasToken:"0x0000000000000000000000000000000000000000",
   refundReceiver:"0x0000000000000000000000000000000000000000"},
  safeFacts,fundingFacts:{chain_id:56,token_address:"0x55d398326f99059ff775485246999027b3197955",
   safe_address:SAFE,confirmed:true,confirmations:"12",amount:"100",tx_hash:HASH,block_hash:HASH},
  serverAuthorization:authorization};
}
function fakeClient(response:unknown, capture:(name:string,args:Record<string,unknown>)=>void):W3MRpcClient{
 return {rpc:async(name,args)=>{capture(name,args);return {data:response,error:null};}};
}
Deno.test("persists exact buyer refund request via the dedicated atomic RPC",async()=>{
 const input=fixture();let calls=0;
 const client=fakeClient({created:true,idempotent_replay:false,request_id:REQUEST,
  safe_transaction_id:TX,safe_tx_hash:HASH,status:"awaiting_signatures"},(name,args)=>{
   calls++;if(name!=="w3m_create_buyer_refund_request")throw new Error("wrong RPC");
   if(args.p_deal_id!==DEAL||args.p_actor_id!==ACTOR||
      args.p_intent!==input.intent||args.p_safe_transaction!==input.safeTransaction||
      args.p_safe_facts!==input.safeFacts||args.p_funding_facts!==input.fundingFacts||
      args.p_server_authorization!==input.serverAuthorization)throw new Error("RPC args lost server bindings");
  });
 const result=await persistBuyerRefundRequestAtomically(client,input);
 if(calls!==1||result.requestId!==REQUEST||result.safeTransactionId!==TX||
    result.safeTransactionHash!==HASH||result.status!=="awaiting_signatures"||result.idempotentReplay){
  throw new Error("Atomic refund request result mismatch");
 }
});
Deno.test("rejects missing canonical block and payload attestations before RPC",async()=>{
 const input=fixture();input.serverAuthorization.payload_verified=false;
 let called=false;
 const client=fakeClient({},()=>{called=true;});
 let blocked=false;try{await persistBuyerRefundRequestAtomically(client,input);}catch{blocked=true;}
 if(!blocked||called)throw new Error("Unverified refund payload reached persistence RPC");
});
Deno.test("rejects an RPC response bound to a different Safe transaction hash",async()=>{
 const input=fixture();let blocked=false;
 const client=fakeClient({created:true,idempotent_replay:false,request_id:REQUEST,
  safe_transaction_id:TX,safe_tx_hash:"0x"+"f".repeat(64),status:"awaiting_signatures"},()=>{});
 try{await persistBuyerRefundRequestAtomically(client,input);}catch{blocked=true;}
 if(!blocked)throw new Error("Mismatched Safe hash response was accepted");
});

Deno.test("rejects absent or malformed EIP-712 acceptance attestations before RPC",async()=>{
 for(const patch of [
  {agreement_acceptances_verified:false},
  {buyer_acceptance_digest:"bad"},
  {seller_acceptance_digest:null},
 ]){
  const input=fixture();Object.assign(input.serverAuthorization,patch);
  let called=false;const client=fakeClient({},()=>{called=true;});
  let blocked=false;try{await persistBuyerRefundRequestAtomically(client,input);}catch{blocked=true;}
  if(!blocked||called)throw new Error("Unverified agreement acceptance reached atomic refund RPC");
 }
});
