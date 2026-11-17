import {readBuyerRefundRequestSnapshot} from "./buyer-refund-request-snapshot-adapter.ts";
import type {W3MRpcClient} from "./supabase-rpc-adapter.ts";
const DEAL="81000000-0000-4000-8000-000000000001";
const ACTOR="82000000-0000-4000-8000-000000000002";
const BUYER="83000000-0000-4000-8000-000000000003";
const SELLER="84000000-0000-4000-8000-000000000004";
const DISPUTE="85000000-0000-4000-8000-000000000005";
const DECISION="86000000-0000-4000-8000-000000000006";
const TERMS="87000000-0000-4000-8000-000000000007";
function snapshot(){
 return {deal:{id:DEAL,buyer_id:BUYER,seller_id:SELLER},
  buyer_profile:{id:BUYER,wallet_address:"0x1111111111111111111111111111111111111111"},
  seller_profile:{id:SELLER,wallet_address:"0x2222222222222222222222222222222222222222"},
  dispute:{id:DISPUTE,deal_id:DEAL,status:"resolved",resolution:"buyer_wins"},
  decision:{id:DECISION,deal_id:DEAL,dispute_id:DISPUTE,terms_version_id:TERMS},
  terms:{id:TERMS,deal_id:DEAL},acceptances:[]};
}
function client(data:unknown,error:unknown=null,capture?:(name:string,args:Record<string,unknown>)=>void):W3MRpcClient{
 return {rpc:async(name,args)=>{capture?.(name,args);return {data,error};}};
}
Deno.test("loads only the dedicated admin-scoped buyer refund snapshot",async()=>{
 let called=false;
 const result=await readBuyerRefundRequestSnapshot(client(snapshot(),null,(name,args)=>{
  called=true;if(name!=="w3m_read_buyer_refund_request_snapshot"||args.p_deal_id!==DEAL||args.p_actor_id!==ACTOR)throw new Error("wrong RPC binding");
 }),{dealId:DEAL,actorId:ACTOR});
 if(!called||result.deal.id!==DEAL||result.decision?.id!==DECISION||result.terms?.id!==TERMS)throw new Error("snapshot fields were not preserved");
});
Deno.test("rejects RPC errors and cross-deal identity substitutions",async()=>{
 let blocked=false;try{await readBuyerRefundRequestSnapshot(client(null,new Error("db")), {dealId:DEAL,actorId:ACTOR});}catch{blocked=true;}
 if(!blocked)throw new Error("RPC error was ignored");
 const bad=snapshot();bad.deal={...bad.deal,id:"88000000-0000-4000-8000-000000000008"};
 blocked=false;try{await readBuyerRefundRequestSnapshot(client(bad),{dealId:DEAL,actorId:ACTOR});}catch{blocked=true;}
 if(!blocked)throw new Error("cross-deal snapshot was accepted");
});
Deno.test("rejects decision, terms and acceptance rows detached from the current dispute",async()=>{
 const bad=snapshot();bad.decision={...bad.decision,dispute_id:"88000000-0000-4000-8000-000000000008"};
 let blocked=false;try{await readBuyerRefundRequestSnapshot(client(bad),{dealId:DEAL,actorId:ACTOR});}catch{blocked=true;}
 if(!blocked)throw new Error("detached decision was accepted");
 const badTerms=snapshot();badTerms.terms={...badTerms.terms,id:"88000000-0000-4000-8000-000000000008"};
 blocked=false;try{await readBuyerRefundRequestSnapshot(client(badTerms),{dealId:DEAL,actorId:ACTOR});}catch{blocked=true;}
 if(!blocked)throw new Error("detached terms were accepted");
});
