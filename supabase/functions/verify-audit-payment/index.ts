import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const allowedOrigins=new Set(["https://web3market.xyz","https://www.web3market.xyz"]);
const TRANSFER_TOPIC="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
function cors(req:Request){const origin=req.headers.get("Origin")||"";const h:Record<string,string>={"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin"};if(allowedOrigins.has(origin))h["Access-Control-Allow-Origin"]=origin;return h;}
function json(req:Request,data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...cors(req),"Content-Type":"application/json"}});}
async function rpc(url:string,method:string,params:unknown[]){const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});if(!r.ok)throw Error("BNB RPC request failed ("+r.status+").");const j=await r.json();if(j.error)throw Error("BNB RPC error: "+String(j.error.message||"unknown"));return j.result;}
function topicAddress(topic:string){return "0x"+String(topic||"").slice(-40).toLowerCase();}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
 if(req.method!=="POST")return json(req,{ok:false,error:"POST required"},405);
 const auth=req.headers.get("Authorization")||"";
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),rpcUrl=Deno.env.get("BSC_RPC_URL");
 if(!url||!anon||!service||!rpcUrl)return json(req,{ok:false,error:"Payment verifier is not configured."},503);
 const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
 const {data:{user},error:authError}=await userClient.auth.getUser();
 if(authError||!user)return json(req,{ok:false,error:"Sign in before verifying payment."},401);
 const sb=createClient(url,service);
 try{
  const body=await req.json(),orderId=String(body.order_id||""),txHash=String(body.tx_hash||"").toLowerCase();
  if(!/^[0-9a-f-]{36}$/i.test(orderId)||!/^0x[0-9a-f]{64}$/.test(txHash))return json(req,{ok:false,error:"A valid order ID and transaction hash are required."},400);
  const {data:order,error}=await sb.from("audit_payment_orders").select("*").eq("id",orderId).eq("user_id",user.id).maybeSingle();
  if(error||!order)return json(req,{ok:false,error:"Payment order not found."},404);
  if(order.status==="confirmed"&&String(order.tx_hash||"").toLowerCase()!==txHash)return json(req,{ok:false,error:"This order has already been confirmed with another transaction."},409);
  if(order.status!=="confirmed"&&order.status!=="pending")return json(req,{ok:false,error:"This payment order is no longer payable."},409);
  if(order.status!=="confirmed"&&new Date(order.expires_at).getTime()<Date.now())return json(req,{ok:false,error:"Payment order expired. Create a new order."},410);
  const chainId=await rpc(rpcUrl,"eth_chainId",[]);
  if(BigInt(chainId)!==56n)return json(req,{ok:false,error:"Payment verifier is not connected to BNB Smart Chain mainnet."},503);
  const receipt=await rpc(rpcUrl,"eth_getTransactionReceipt",[txHash]);
  if(!receipt)return json(req,{ok:false,pending:true,error:"Transaction not found yet. Wait for confirmation and try again."},202);
  if(String(receipt.transactionHash||"").toLowerCase()!==txHash||String(receipt.status)!=="0x1")return json(req,{ok:false,error:"Transaction failed or transaction hash does not match."},400);
  const latest=BigInt(await rpc(rpcUrl,"eth_blockNumber",[]));
  const block=BigInt(receipt.blockNumber);
  const confirmations=latest>=block?Number(latest-block+1n):0;
  if(confirmations<12)return json(req,{ok:false,pending:true,confirmations,required_confirmations:12,error:"Payment is included but is awaiting 12 block confirmations."},202);
  const wantedTo=String(order.recipient_address).toLowerCase(),wantedToken=String(order.token_contract).toLowerCase(),wantedAmount=BigInt(String(order.amount_atomic));
  const match=(receipt.logs||[]).find((log:any)=>String(log.address||"").toLowerCase()===wantedToken&&String(log.topics?.[0]||"").toLowerCase()===TRANSFER_TOPIC&&topicAddress(log.topics?.[2])===wantedTo&&BigInt(log.data||"0x0")===wantedAmount);
  if(!match)return json(req,{ok:false,error:"No exact USDT transfer to the platform receiving wallet was found in this transaction."},400);
  const payer=topicAddress(match.topics?.[1]);
  if(order.status!=="confirmed"){
   const {data:updated,error:updateError}=await sb.from("audit_payment_orders").update({status:"confirmed",tx_hash:txHash,payer_address:payer,confirmed_at:new Date().toISOString()}).eq("id",order.id).eq("status","pending").is("tx_hash",null).select("id").maybeSingle();
   if(updateError||!updated)return json(req,{ok:false,error:"Payment verification could not be safely finalized. Retry once; the transaction will not be charged twice."},409);
  }
  if(order.audit_id)return json(req,{ok:true,paid:true,audit_id:order.audit_id,confirmations,already_started:true});
  const engineResponse=await fetch(url+"/functions/v1/w3m-code-audit",{method:"POST",headers:{"Authorization":auth,"apikey":anon,"Content-Type":"application/json"},body:JSON.stringify({repo_url:order.repo_url,audit_type:order.audit_type,payment_order_id:order.id,project_id:order.project_id||undefined})});
  const engineBody=await engineResponse.json().catch(()=>({}));
  if(!engineResponse.ok||!engineBody.audit_id)return json(req,{ok:true,paid:true,audit_started:false,confirmations,error:engineBody.error||"Payment confirmed. Return to your audit page and retry starting the audit."},202);
  return json(req,{ok:true,paid:true,audit_started:true,audit_id:engineBody.audit_id,confirmations},200);
 }catch(e){console.error("verify-audit-payment",String((e as any)?.message||e));return json(req,{ok:false,error:String((e as any)?.message||"Unable to verify payment.")},400);}
});
