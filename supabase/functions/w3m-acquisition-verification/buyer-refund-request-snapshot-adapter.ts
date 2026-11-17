// W3M Protocol V1 — strict adapter for the dedicated fresh buyer-refund snapshot RPC.
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(value:unknown,label:string):Record<string,unknown>{
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(label+" is malformed");
 return value as Record<string,unknown>;
}
function text(value:unknown,label:string):string{
 if(typeof value!=="string"||!value.trim())throw new Error(label+" is missing");
 return value;
}
function uuid(value:unknown,label:string):string{
 const v=text(value,label);if(!UUID.test(v))throw new Error(label+" is not a UUID");return v;
}
export interface BuyerRefundRequestSnapshot {
 deal:Record<string,unknown>;
 buyerProfile:Record<string,unknown>;
 sellerProfile:Record<string,unknown>;
 dispute:Record<string,unknown>|null;
 decision:Record<string,unknown>|null;
 terms:Record<string,unknown>|null;
 acceptances:Record<string,unknown>[];
}
export async function readBuyerRefundRequestSnapshot(
 client:W3MRpcClient,input:{dealId:string;actorId:string},
):Promise<BuyerRefundRequestSnapshot>{
 if(!UUID.test(input.dealId)||!UUID.test(input.actorId))throw new Error("Buyer refund snapshot identifiers are malformed");
 const {data,error}=await client.rpc("w3m_read_buyer_refund_request_snapshot",{
  p_deal_id:input.dealId,p_actor_id:input.actorId,
 });
 if(error)throw new Error("Buyer refund fresh snapshot RPC failed");
 const root=object(data,"Buyer refund snapshot");
 const deal=object(root.deal,"Snapshot deal");
 const buyerProfile=object(root.buyer_profile,"Snapshot buyer profile");
 const sellerProfile=object(root.seller_profile,"Snapshot seller profile");
 if(uuid(deal.id,"Snapshot deal ID")!==input.dealId||
    uuid(buyerProfile.id,"Snapshot buyer ID")!==uuid(deal.buyer_id,"Deal buyer ID")||
    uuid(sellerProfile.id,"Snapshot seller ID")!==uuid(deal.seller_id,"Deal seller ID")){
  throw new Error("Buyer refund snapshot identity binding mismatch");
 }
 const dispute=root.dispute===null?null:object(root.dispute,"Snapshot dispute");
 const decision=root.decision===null?null:object(root.decision,"Snapshot decision");
 const terms=root.terms===null?null:object(root.terms,"Snapshot terms");
 if(dispute&&uuid(dispute.deal_id,"Dispute deal ID")!==input.dealId)throw new Error("Dispute belongs to another deal");
 if(decision&&(uuid(decision.deal_id,"Decision deal ID")!==input.dealId||
    !dispute||uuid(decision.dispute_id,"Decision dispute ID")!==uuid(dispute.id,"Dispute ID"))){
  throw new Error("Decision is not bound to the snapshot dispute");
 }
 if(terms&&(uuid(terms.deal_id,"Terms deal ID")!==input.dealId||
    !decision||uuid(terms.id,"Terms ID")!==uuid(decision.terms_version_id,"Decision terms ID"))){
  throw new Error("Terms are not bound to the immutable decision");
 }
 if(!Array.isArray(root.acceptances)||root.acceptances.some(x=>!x||typeof x!=="object"||Array.isArray(x))){
  throw new Error("Snapshot agreement acceptances are malformed");
 }
 return {deal,buyerProfile,sellerProfile,dispute,decision,terms,acceptances:root.acceptances as Record<string,unknown>[]};
}
