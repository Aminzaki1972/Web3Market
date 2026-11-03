import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertSupportedPaymentAsset } from "../verify-audit-payment/payment-verification.ts";
const allowedOrigins=new Set(["https://web3market.xyz","https://www.web3market.xyz"]);
function cors(req:Request){const origin=req.headers.get("Origin")||"";let trusted=allowedOrigins.has(origin);if(!trusted){try{const parsed=new URL(origin);trusted=parsed.protocol==="https:"&&/^(?:[a-z0-9-]+\.)*web3market\.pages\.dev$/i.test(parsed.hostname);}catch(_){trusted=false;}}const h:Record<string,string>={"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin"};if(trusted)h["Access-Control-Allow-Origin"]=origin;return h;}
function json(req:Request,data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...cors(req),"Content-Type":"application/json"}});}
function canonicalRepo(value:string){const u=new URL(value);if(u.protocol!=="https:"||u.hostname!=="github.com")throw Error("Only public GitHub repository URLs are supported.");const p=u.pathname.split("/").filter(Boolean);if(p.length!==2)throw Error("Enter a repository URL in https://github.com/owner/repository format.");const owner=p[0],name=p[1].replace(/\.git$/i,"");if(!/^[A-Za-z0-9-]+$/.test(owner)||! /^[A-Za-z0-9_.-]+$/.test(name))throw Error("Invalid GitHub repository path.");return "https://github.com/"+owner+"/"+name;}
async function rpc(url:string,method:string,params:unknown[]){const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});if(!r.ok)throw Error("BNB RPC request failed ("+r.status+").");const j=await r.json();if(j.error)throw Error("BNB RPC error: "+String(j.error.message||"unknown"));return j.result;}
function randomToken(){const b=new Uint8Array(32);crypto.getRandomValues(b);return Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");}
async function sha256(v:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(d),x=>x.toString(16).padStart(2,"0")).join("");}
function decodeAbiString(hex:string){if(!/^0x[0-9a-f]+$/i.test(hex)||hex.length<130)return "";const bytes=hex.slice(2);try{const offset=Number(BigInt("0x"+bytes.slice(0,64)))*2;const length=Number(BigInt("0x"+bytes.slice(offset,offset+64)));if(!Number.isSafeInteger(length)||length<1||length>64)return "";const data=bytes.slice(offset+64,offset+64+length*2);return new TextDecoder().decode(Uint8Array.from(data.match(/.{2}/g)||[],x=>parseInt(x,16)));}catch(_){return "";}}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
 if(req.method!=="POST")return json(req,{ok:false,error:"POST required"},405);
 const auth=req.headers.get("Authorization")||"";
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),rpcUrl=Deno.env.get("BSC_RPC_URL");
 if(!url||!anon||!service)return json(req,{ok:false,error:"Payment service is not configured."},503);
 if(!rpcUrl)return json(req,{ok:false,error:"Paid audits are temporarily unavailable until the BNB Chain payment verifier is configured."},503);
 const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
 const authResult=auth&&auth!=="Bearer "+anon?await userClient.auth.getUser():{data:{user:null},error:null};
 if(authResult.error)return json(req,{ok:false,error:"Invalid sign-in session."},401);
 const user=authResult.data.user;
 const sb=createClient(url,service);
 try{
  const body=await req.json();
  const guestEmail=String(body.email||"").trim().toLowerCase();
  if(!user&&!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(guestEmail))return json(req,{ok:false,error:"Enter a valid email address to receive your private audit report."},400);
  let guestOrderToken:string|null=null;
  const auditType=String(body.audit_type||"code");
  const prices:Record<string,number>={code:9,smart_contract:29,complete:79};
  if(!(auditType in prices))return json(req,{ok:false,error:"Unsupported audit type."},400);
  const repoUrl=canonicalRepo(String(body.repo_url||""));
  // Check the administrator-controlled payment switch before consuming guest quota.
  // Disabled checkout attempts must not exhaust the guest's hourly allowance.
  // Keep the rate limit immediately before outbound RPC calls once checkout is enabled.
  // Audit payments go to the platform fee recipient wallet, never to the separate Safe escrow address.
  const {data:config,error:configError}=await sb.from("platform_payment_configs").select("chain_id,recipient_address,token_contract,token_symbol,enabled").eq("chain_id",56).eq("enabled",true).eq("token_symbol","BSC-USD").order("updated_at",{ascending:false}).limit(1).maybeSingle();
  if(configError)throw Error("Unable to read platform payment configuration.");
  if(!config||!/^0x[a-f0-9]{40}$/i.test(String(config.recipient_address||"")))return json(req,{ok:false,error:"Paid audits are not enabled yet: the platform receiving wallet and approved BSC-USD asset have not been configured by an administrator."},503);
  try{assertSupportedPaymentAsset(56,String(config.token_contract||""),String(config.token_symbol||""),18);}catch(e){return json(req,{ok:false,error:String((e as any)?.message||"Unsupported payment asset.")},503);}
  if(!user){
   const ip=(req.headers.get("cf-connecting-ip")||req.headers.get("x-forwarded-for")||"unknown").split(",")[0].trim();
   const fingerprint=await sha256(ip+"|w3m-guest-audit-order");
   const {data:allowed,error:rateError}=await sb.rpc("consume_guest_audit_order_rate_limit",{p_fingerprint:fingerprint});
   if(rateError||allowed!==true)return json(req,{ok:false,error:"Guest checkout limit reached. Try again in an hour or sign in to continue."},429);
   guestOrderToken=randomToken();
  }
  const chainId=await rpc(rpcUrl,"eth_chainId",[]);
  if(BigInt(chainId)!==56n)return json(req,{ok:false,error:"Configured RPC is not connected to BNB Smart Chain mainnet."},503);
  const decimalsHex=await rpc(rpcUrl,"eth_call",[{to:config.token_contract,data:"0x313ce567"},"latest"]);
  const decimals=Number(BigInt(decimalsHex));
  if(decimals!==18)throw Error("The approved Binance-Peg BSC-USD contract must return exactly 18 decimals.");
  // BscScan labels this contract Binance-Peg BSC-USD, while the BEP-20 symbol() call returns "USDT".
  // Keep the customer-facing asset identity pinned to the exact contract + chain, not the on-chain ticker alone.
  const symbolHex=await rpc(rpcUrl,"eth_call",[{to:config.token_contract,data:"0x95d89b41"},"latest"]);
  const symbol=decodeAbiString(symbolHex);
  if(symbol!=="USDT")return json(req,{ok:false,error:"The approved Binance-Peg contract metadata check failed. Paid audits remain disabled."},503);
  const price=prices[auditType];
  const amountAtomic=(BigInt(price)*(10n**BigInt(decimals))).toString();
  let projectId:string|null=null;
  const requestedProjectId=typeof body.project_id==="string"&&/^[0-9a-f-]{36}$/i.test(body.project_id)?body.project_id:null;
  // Never attach a paid audit to an unrelated listing. A project association is
  // optional metadata and is accepted only for the caller's active listing
  // whose canonical GitHub repository exactly matches the paid audit target.
  if(user&&requestedProjectId){
   const {data:listedProject,error:projectError}=await sb.from("projects").select("id,github_url,owner_id,status").eq("id",requestedProjectId).maybeSingle();
   if(projectError)return json(req,{ok:false,error:"Unable to validate the selected marketplace project."},503);
   if(listedProject&&listedProject.owner_id===user.id&&listedProject.status==="active"){
    try{if(canonicalRepo(String(listedProject.github_url||"")).toLowerCase()===repoUrl.toLowerCase())projectId=listedProject.id;}catch(_){/* Unmatched or malformed listing remains unlinked. */}
   }
  }
  const {data:order,error}=await sb.from("audit_payment_orders").insert({
   user_id:user?.id||null,project_id:projectId,audit_type:auditType,repo_url:repoUrl,price_usd:price,chain_id:56,
   token_contract:String(config.token_contract).toLowerCase(),token_symbol:"BSC-USD",token_decimals:decimals,
   recipient_address:String(config.recipient_address).toLowerCase(),amount_atomic:amountAtomic
  }).select("id,price_usd,chain_id,token_contract,token_symbol,token_decimals,recipient_address,amount_atomic,expires_at").single();
  if(error||!order)throw Error("Unable to create payment order.");
  if(!user&&guestOrderToken){const {error:guestError}=await sb.from("guest_audit_access").insert({payment_order_id:order.id,email:guestEmail,order_token_hash:await sha256(guestOrderToken)});if(guestError){await sb.from("audit_payment_orders").delete().eq("id",order.id).is("user_id",null);throw Error("Unable to secure guest checkout. Please retry.");}}
  return json(req,{ok:true,guest:!user,guest_order_token:guestOrderToken,email:!user?guestEmail:undefined,order:{...order,amount:"$"+Number(price).toFixed(2)+" BSC-USD",asset_label:"Binance-Peg BSC-USD",network:"BNB Smart Chain",instructions:"Send the exact Binance-Peg BSC-USD amount to the receiving address, then submit the transaction hash for verification."}},201);
 }catch(e){console.error("create-audit-payment-order",String((e as any)?.message||e));return json(req,{ok:false,error:String((e as any)?.message||"Unable to create payment order.")},400);}
});
