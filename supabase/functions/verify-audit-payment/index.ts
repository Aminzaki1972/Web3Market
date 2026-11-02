import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertSupportedPaymentAsset, findExactTransferLog } from "./payment-verification.ts";
const allowedOrigins=new Set(["https://web3market.xyz","https://www.web3market.xyz"]);
function cors(req:Request){const origin=req.headers.get("Origin")||"";let trusted=allowedOrigins.has(origin);if(!trusted){try{const parsed=new URL(origin);trusted=parsed.protocol==="https:"&&/^(?:[a-z0-9-]+\.)*web3market\.pages\.dev$/i.test(parsed.hostname);}catch(_){trusted=false;}}const h:Record<string,string>={"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin"};if(trusted)h["Access-Control-Allow-Origin"]=origin;return h;}
function json(req:Request,data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...cors(req),"Content-Type":"application/json"}});}
function randomToken(){const b=new Uint8Array(32);crypto.getRandomValues(b);return Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");}
async function sha256(v:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(d),x=>x.toString(16).padStart(2,"0")).join("");}
async function rpc(url:string,method:string,params:unknown[]){const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});if(!r.ok)throw Error("BNB RPC request failed ("+r.status+").");const j=await r.json();if(j.error)throw Error("BNB RPC error: "+String(j.error.message||"unknown"));return j.result;}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
 if(req.method!=="POST")return json(req,{ok:false,error:"POST required"},405);
 const auth=req.headers.get("Authorization")||"";
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),rpcUrl=Deno.env.get("BSC_RPC_URL");
 if(!url||!anon||!service||!rpcUrl)return json(req,{ok:false,error:"Payment verifier is not configured."},503);
 const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
 const authResult=auth&&auth!=="Bearer "+anon?await userClient.auth.getUser():{data:{user:null},error:null};
 if(authResult.error)return json(req,{ok:false,error:"Invalid sign-in session."},401);
 const user=authResult.data.user;
 const sb=createClient(url,service);
 try{
  const body=await req.json(),orderId=String(body.order_id||""),txHash=String(body.tx_hash||"").toLowerCase();
  if(!/^[0-9a-f-]{36}$/i.test(orderId)||!/^0x[0-9a-f]{64}$/.test(txHash))return json(req,{ok:false,error:"A valid order ID and transaction hash are required."},400);
  let guestAccess:any=null;
  if(!user){
   const guestToken=String(body.guest_order_token||"");
   if(!/^[0-9a-f]{64}$/i.test(guestToken))return json(req,{ok:false,error:"The guest order access token is missing or invalid."},401);
   const {data:access,error:accessError}=await sb.from("guest_audit_access").select("id,email,order_token_hash,revoked_at,report_token_hash,report_token_expires_at,session_token_hash,session_expires_at,email_sent_at").eq("payment_order_id",orderId).maybeSingle();
   if(accessError||!access||access.revoked_at||access.order_token_hash!==await sha256(guestToken))return json(req,{ok:false,error:"Guest payment order not found."},404);
   guestAccess=access;
  }
  let orderQuery=sb.from("audit_payment_orders").select("*").eq("id",orderId);
  orderQuery=user?orderQuery.eq("user_id",user.id):orderQuery.is("user_id",null);
  const {data:order,error}=await orderQuery.maybeSingle();
  if(error||!order)return json(req,{ok:false,error:"Payment order not found."},404);
  try{assertSupportedPaymentAsset(Number(order.chain_id),String(order.token_contract||""),String(order.token_symbol||""),Number(order.token_decimals));}catch(e){return json(req,{ok:false,error:String((e as any)?.message||"Unsupported payment asset.")},503);}
  if(order.status==="confirmed"&&String(order.tx_hash||"").toLowerCase()!==txHash)return json(req,{ok:false,error:"This order has already been confirmed with another transaction."},409);
  if(order.status!=="confirmed"&&order.status!=="pending")return json(req,{ok:false,error:"This payment order is no longer payable."},409);
  if(order.status!=="confirmed"&&new Date(order.expires_at).getTime()<Date.now())return json(req,{ok:false,error:"Payment order expired. Create a new order."},410);
  const chainId=await rpc(rpcUrl,"eth_chainId",[]);
  if(BigInt(chainId)!==56n)return json(req,{ok:false,error:"Payment verifier is not connected to BNB Smart Chain mainnet."},503);
  const receipt=await rpc(rpcUrl,"eth_getTransactionReceipt",[txHash]);
  if(!receipt)return json(req,{ok:false,pending:true,error:"Transaction not found yet. Wait for confirmation and try again."},202);
  if(String(receipt.transactionHash||"").toLowerCase()!==txHash||String(receipt.status)!=="0x1")return json(req,{ok:false,error:"Transaction failed or transaction hash does not match."},400);
  const transferBlockHash=String(receipt.blockHash||"").toLowerCase();
  if(!/^0x[0-9a-f]{64}$/.test(transferBlockHash)||!/^0x[0-9a-f]+$/i.test(String(receipt.blockNumber||"")))return json(req,{ok:false,error:"Transaction receipt is missing valid block evidence."},400);
  const latest=BigInt(await rpc(rpcUrl,"eth_blockNumber",[]));
  const block=BigInt(receipt.blockNumber);
  const confirmations=latest>=block?Number(latest-block+1n):0;
  if(confirmations<12)return json(req,{ok:false,pending:true,confirmations,required_confirmations:12,error:"Payment is included but is awaiting 12 block confirmations."},202);
  const wantedTo=String(order.recipient_address).toLowerCase(),wantedToken=String(order.token_contract).toLowerCase(),wantedAmount=BigInt(String(order.amount_atomic));
  let transfer:{payerAddress:string;logIndex:number};
  try{transfer=findExactTransferLog(receipt.logs||[],wantedToken,wantedTo,wantedAmount);}catch(e){return json(req,{ok:false,error:String((e as any)?.message||"Exact token transfer verification failed.")},400);}
  const payer=transfer.payerAddress;
  if(order.status!=="confirmed"){
   const {data:updated,error:updateError}=await sb.from("audit_payment_orders").update({status:"confirmed",tx_hash:txHash,payer_address:payer,transfer_log_index:transfer.logIndex,transfer_block_number:BigInt(receipt.blockNumber).toString(),transfer_block_hash:transferBlockHash,confirmed_at:new Date().toISOString()}).eq("id",order.id).eq("status","pending").is("tx_hash",null).select("id").maybeSingle();
   if(updateError||!updated){const {data:latestOrder}=await sb.from("audit_payment_orders").select("status,tx_hash").eq("id",order.id).maybeSingle();if(latestOrder?.status!=="confirmed"||String(latestOrder.tx_hash||"").toLowerCase()!==txHash)return json(req,{ok:false,error:"Payment verification could not be safely finalized. Retry once; the transaction will not be charged twice."},409);}
  }
  if(order.audit_id&&!guestAccess)return json(req,{ok:true,paid:true,audit_id:order.audit_id,confirmations,already_started:true});
  if(guestAccess){
   const activeReportLink=!!guestAccess.report_token_hash&&!!guestAccess.report_token_expires_at&&new Date(guestAccess.report_token_expires_at).getTime()>Date.now();
   const activeSession=!!guestAccess.session_token_hash&&!!guestAccess.session_expires_at&&new Date(guestAccess.session_expires_at).getTime()>Date.now();
   if(!guestAccess.email_sent_at||(!activeReportLink&&!activeSession)){
    const reportToken=randomToken();
    const reportExpiry=new Date(Date.now()+7*24*60*60*1000).toISOString();
    const {error:tokenError}=await sb.from("guest_audit_access").update({report_token_hash:await sha256(reportToken),report_token_expires_at:reportExpiry,report_token_used_at:null,session_token_hash:null,session_expires_at:null,email_sent_at:null,email_last_error:null}).eq("id",guestAccess.id).is("revoked_at",null);
    if(tokenError)return json(req,{ok:false,paid:true,error:"Payment is confirmed, but secure report-link preparation failed. Retry verification with the same order token."},503);
    const resendKey=Deno.env.get("RESEND_API_KEY"),fromEmail=Deno.env.get("RESEND_FROM_EMAIL");
    if(!resendKey||!fromEmail)return json(req,{ok:false,paid:true,error:"Payment is confirmed. Report email is not configured yet; the platform administrator must configure RESEND_API_KEY and RESEND_FROM_EMAIL before delivery."},503);
    const reportUrl="https://web3market.xyz/code-audit.html?guest_report="+encodeURIComponent(reportToken);
    const mail=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+resendKey,"Content-Type":"application/json","Idempotency-Key":"w3m-guest-audit:"+order.id+":"+await sha256(reportToken)},body:JSON.stringify({from:fromEmail,to:[guestAccess.email],subject:"Your private Web3Market AI Code Audit report",html:"<div style='font-family:Arial,sans-serif;line-height:1.6;color:#172033'><h2>Your paid W3M AI Code Audit is underway</h2><p>Your payment has been verified on BNB Smart Chain. Use the private link below to view progress and access the report when complete.</p><p><a href='"+reportUrl+"'>Open your private audit report</a></p><p>This link can be exchanged once and expires in 7 days. The report session expires after 12 hours. Do not forward this email or share the link.</p><p>Repository: "+String(order.repo_url).replace(/[&<>"]/g,"")+"</p><p>Payment asset: Binance-Peg BSC-USD.</p></div>"})});
    const mailResult=await mail.json().catch(()=>({}));
    if(!mail.ok){await sb.from("guest_audit_access").update({email_last_error:String(mailResult?.message||"Resend delivery failed").slice(0,500)}).eq("id",guestAccess.id);return json(req,{ok:false,paid:true,error:"Payment is confirmed, but the report email could not be sent. Retry verification with the same order token."},502);}
    await sb.from("guest_audit_access").update({email_sent_at:new Date().toISOString(),email_last_error:null}).eq("id",guestAccess.id);
   }
  }
  const engineAuth=guestAccess?"Bearer "+service:auth;
  const engineResponse=await fetch(url+"/functions/v1/w3m-code-audit",{method:"POST",headers:{"Authorization":engineAuth,"apikey":anon,"Content-Type":"application/json"},body:JSON.stringify({repo_url:order.repo_url,audit_type:order.audit_type,payment_order_id:order.id,project_id:order.project_id||undefined})});
  const engineBody=await engineResponse.json().catch(()=>({}));
  if(!engineResponse.ok||!engineBody.audit_id)return json(req,{ok:false,paid:true,audit_started:false,email:guestAccess?.email,guest:!!guestAccess,confirmations,error:engineBody.error||"Payment confirmed. Audit start can be retried."},202);
  return json(req,{ok:true,paid:true,audit_started:true,audit_id:engineBody.audit_id,guest:!!guestAccess,email:guestAccess?.email,confirmations},200);
 }catch(e){console.error("verify-audit-payment",String((e as any)?.message||e));return json(req,{ok:false,error:String((e as any)?.message||"Unable to verify payment.")},400);}
});
