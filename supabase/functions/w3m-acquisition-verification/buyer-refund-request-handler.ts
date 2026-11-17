// W3M Protocol V1 — authenticated admin-only buyer refund request boundary.
// Browser supplies only deal_id. Decision, wallets, funding, Safe facts, payload,
// Safe hash and persistence arguments are freshly derived by trusted dependencies.
import { extractW3MBearerToken } from "./bearer-token.ts";
import type {
  BuyerRefundRequestPersistenceInput,
  BuyerRefundRequestPersistenceResult,
} from "./buyer-refund-request-persistence-adapter.ts";

export interface BuyerRefundRequestHandlerDependencies {
  authenticate(token:string):Promise<string|null>;
  isAdmin(actorId:string):Promise<boolean>;
  /** Reload immutable decision/terms, verify funding and canonical Safe state,
   * build and decode the exact MultiSend payload, and return a server-only RPC input. */
  prepare(input:{dealId:string;actorId:string}):Promise<BuyerRefundRequestPersistenceInput>;
  persist(input:BuyerRefundRequestPersistenceInput):Promise<BuyerRefundRequestPersistenceResult>;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function json(status:number,body:Record<string,unknown>):Response{
 return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}
export async function handleW3MBuyerRefundRequest(
 request:Request,deps:BuyerRefundRequestHandlerDependencies,
):Promise<Response>{
 if(request.method!=="POST")return json(405,{ok:false,error:"POST_REQUIRED"});
 const token=extractW3MBearerToken(request.headers.get("authorization"));
 if(!token)return json(401,{ok:false,error:"AUTHENTICATION_REQUIRED"});
 let actorId:string|null;
 try{actorId=await deps.authenticate(token);}catch{return json(401,{ok:false,error:"AUTHENTICATION_FAILED"});}
 if(typeof actorId!=="string"||!UUID.test(actorId))return json(401,{ok:false,error:"AUTHENTICATION_FAILED"});
 let authorized=false;
 try{authorized=await deps.isAdmin(actorId);}catch{return json(403,{ok:false,error:"ADMIN_AUTHORIZATION_FAILED"});}
 if(authorized!==true)return json(403,{ok:false,error:"ADMIN_REQUIRED"});
 let body:unknown;
 try{body=await request.json();}catch{return json(400,{ok:false,error:"INVALID_JSON"});}
 if(!body||typeof body!=="object"||Array.isArray(body))return json(400,{ok:false,error:"INVALID_REQUEST"});
 const row=body as Record<string,unknown>;
 if(Object.keys(row).length!==1||typeof row.deal_id!=="string"||!UUID.test(row.deal_id)){
  return json(400,{ok:false,error:"ONLY_A_VALID_DEAL_ID_IS_ACCEPTED"});
 }
 try{
  const input=await deps.prepare({dealId:row.deal_id,actorId});
  if(input.dealId!==row.deal_id||input.actorId!==actorId)return json(409,{ok:false,error:"FRESH_REFUND_CONTEXT_BINDING_MISMATCH"});
  const result=await deps.persist(input);
  return json(200,{ok:true,result});
 }catch{
  return json(409,{ok:false,error:"W3M_BUYER_REFUND_REQUEST_BLOCKED"});
 }
}
