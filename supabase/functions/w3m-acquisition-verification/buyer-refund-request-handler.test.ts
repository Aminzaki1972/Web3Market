import { handleW3MBuyerRefundRequest } from "./buyer-refund-request-handler.ts";
import type { BuyerRefundRequestPersistenceInput } from "./buyer-refund-request-persistence-adapter.ts";
const ACTOR="82000000-0000-4000-8000-000000000002";
const DEAL="81000000-0000-4000-8000-000000000001";
const REQUEST="85000000-0000-4000-8000-000000000005";
const TX="86000000-0000-4000-8000-000000000006";
const HASH="0x"+"a".repeat(64);
function request(body:unknown,token="Bearer valid-session",method="POST"){
 return new Request("https://w3m.test/buyer-refund-request",{method,headers:{authorization:token,"content-type":"application/json"},
  ...(method==="GET"?{}:{body:JSON.stringify(body)})});
}
function input():BuyerRefundRequestPersistenceInput{
 return {dealId:DEAL,actorId:ACTOR,intent:{},safeTransaction:{},safeFacts:{},fundingFacts:{},serverAuthorization:{}};
}
Deno.test("buyer refund HTTP boundary accepts only deal ID and derives admin actor from session",async()=>{
 let prepared=false,persisted=false;
 const response=await handleW3MBuyerRefundRequest(request({deal_id:DEAL}),{
  authenticate:async()=>ACTOR,isAdmin:async id=>id===ACTOR,
  prepare:async args=>{prepared=true;if(args.dealId!==DEAL||args.actorId!==ACTOR)throw new Error("wrong prepare binding");return input();},
  persist:async value=>{persisted=true;if(value.actorId!==ACTOR)throw new Error("wrong actor");return {created:true,idempotentReplay:false,requestId:REQUEST,safeTransactionId:TX,safeTransactionHash:HASH,status:"awaiting_signatures"};},
 });
 if(response.status!==200||!prepared||!persisted)throw new Error("Admin buyer refund request did not complete");
});
Deno.test("buyer refund HTTP boundary rejects unauthenticated and non-admin actors",async()=>{
 const noAuth=await handleW3MBuyerRefundRequest(request({deal_id:DEAL},""),{
  authenticate:async()=>null,isAdmin:async()=>true,prepare:async()=>input(),persist:async()=>{throw new Error("must not run");},
 });
 const noAdmin=await handleW3MBuyerRefundRequest(request({deal_id:DEAL}),{
  authenticate:async()=>ACTOR,isAdmin:async()=>false,prepare:async()=>input(),persist:async()=>{throw new Error("must not run");},
 });
 if(noAuth.status!==401||noAdmin.status!==403)throw new Error("Authorization boundary did not fail closed");
});
Deno.test("buyer refund HTTP boundary rejects browser-supplied authority and chain facts",async()=>{
 let called=false;
 const response=await handleW3MBuyerRefundRequest(request({deal_id:DEAL,decision_id:"attacker",buyer_wallet:"0x1111111111111111111111111111111111111111",safe_tx_hash:HASH}),{
  authenticate:async()=>ACTOR,isAdmin:async()=>true,prepare:async()=>{called=true;return input();},persist:async()=>{throw new Error("must not run");},
 });
 if(response.status!==400||called)throw new Error("Browser-supplied refund authority reached preparation");
});
Deno.test("buyer refund HTTP boundary fails closed on preparation and persistence errors",async()=>{
 const response=await handleW3MBuyerRefundRequest(request({deal_id:DEAL}),{
  authenticate:async()=>ACTOR,isAdmin:async()=>true,prepare:async()=>input(),persist:async()=>{throw new Error("private details");},
 });
 if(response.status!==409||(await response.json()).error!=="W3M_BUYER_REFUND_REQUEST_BLOCKED")throw new Error("Internal persistence error leaked");
});
