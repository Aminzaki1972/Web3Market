import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const allowedOrigins=new Set(["https://web3market.xyz","https://www.web3market.xyz"]);
function cors(req:Request){const origin=req.headers.get("Origin")||"";let trusted=allowedOrigins.has(origin);if(!trusted){try{const parsed=new URL(origin);trusted=parsed.protocol==="https:"&&/^(?:[a-z0-9-]+\.)*web3market\.pages\.dev$/i.test(parsed.hostname);}catch(_){trusted=false;}}const h:Record<string,string>={"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin"};if(trusted)h["Access-Control-Allow-Origin"]=origin;return h;}
function json(req:Request,data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...cors(req),"Content-Type":"application/json"}});}
function canonicalRepo(value:string){const u=new URL(value);if(u.protocol!=="https:"||u.hostname!=="github.com")throw Error("Only public GitHub repository URLs are supported.");const p=u.pathname.split("/").filter(Boolean);if(p.length!==2)throw Error("Enter a repository URL in https://github.com/owner/repository format.");const owner=p[0],name=p[1].replace(/\.git$/i,"");if(!/^[A-Za-z0-9-]+$/.test(owner)||! /^[A-Za-z0-9_.-]+$/.test(name))throw Error("Invalid GitHub repository path.");return "https://github.com/"+owner+"/"+name;}
async function rpc(url:string,method:string,params:unknown[]){const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});if(!r.ok)throw Error("BNB RPC request failed ("+r.status+").");const j=await r.json();if(j.error)throw Error("BNB RPC error: "+String(j.error.message||"unknown"));return j.result;}
function decodeAbiString(hex:string){if(!/^0x[0-9a-f]+$/i.test(hex)||hex.length<130)return "";const bytes=hex.slice(2);try{const offset=Number(BigInt("0x"+bytes.slice(0,64)))*2;const length=Number(BigInt("0x"+bytes.slice(offset,offset+64)));if(!Number.isSafeInteger(length)||length<1||length>64)return "";const data=bytes.slice(offset+64,offset+64+length*2);return new TextDecoder().decode(Uint8Array.from(data.match(/.{2}/g)||[],x=>parseInt(x,16)));}catch(_){return "";}}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
 if(req.method!=="POST")return json(req,{ok:false,error:"POST required"},405);
 const auth=req.headers.get("Authorization")||"";
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),rpcUrl=Deno.env.get("BSC_RPC_URL");
 if(!url||!anon||!service)return json(req,{ok:false,error:"Payment service is not configured."},503);
 if(!rpcUrl)return json(req,{ok:false,error:"Paid audits are temporarily unavailable until the BNB Chain payment verifier is configured."},503);
 const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
 const {data:{user},error:authError}=await userClient.auth.getUser();
 if(authError||!user)return json(req,{ok:false,error:"Sign in before creating a paid audit order."},401);
 const sb=createClient(url,service);
 try{
  const body=await req.json();
  const auditType=String(body.audit_type||"code");
  const prices:Record<string,number>={code:9,smart_contract:19,complete:29};
  if(!(auditType in prices))return json(req,{ok:false,error:"Unsupported audit type."},400);
  const repoUrl=canonicalRepo(String(body.repo_url||""));
  const chainId=await rpc(rpcUrl,"eth_chainId",[]);
  if(BigInt(chainId)!==56n)return json(req,{ok:false,error:"Configured RPC is not connected to BNB Smart Chain mainnet."},503);
  // Audit payments go to the platform fee recipient wallet, never to the separate Safe escrow address.
  const {data:config,error:configError}=await sb.from("platform_payment_configs").select("chain_id,recipient_address,token_contract,token_symbol,enabled").eq("chain_id",56).eq("enabled",true).eq("token_symbol","USDT").order("updated_at",{ascending:false}).limit(1).maybeSingle();
  if(configError)throw Error("Unable to read platform payment configuration.");
  if(!config||!/^0x[a-f0-9]{40}$/i.test(String(config.recipient_address||""))||!/^0x[a-f0-9]{40}$/i.test(String(config.token_contract||"")))return json(req,{ok:false,error:"Paid audits are not enabled yet: the platform USDT receiving wallet and token contract have not been configured by an administrator."},503);
  const decimalsHex=await rpc(rpcUrl,"eth_call",[{to:config.token_contract,data:"0x313ce567"},"latest"]);
  const decimals=Number(BigInt(decimalsHex));
  if(!Number.isInteger(decimals)||decimals<0||decimals>36)throw Error("The configured USDT contract returned invalid decimals.");
  const symbolHex=await rpc(rpcUrl,"eth_call",[{to:config.token_contract,data:"0x95d89b41"},"latest"]);
  const symbol=decodeAbiString(symbolHex);
  if(symbol&&symbol!=="USDT")return json(req,{ok:false,error:"Configured token contract does not identify itself as USDT."},503);
  const price=prices[auditType];
  const amountAtomic=(BigInt(price)*(10n**BigInt(decimals))).toString();
  const projectId=typeof body.project_id==="string"&&/^[0-9a-f-]{36}$/i.test(body.project_id)?body.project_id:null;
  const {data:order,error}=await sb.from("audit_payment_orders").insert({
   user_id:user.id,project_id:projectId,audit_type:auditType,repo_url:repoUrl,price_usd:price,chain_id:56,
   token_contract:String(config.token_contract).toLowerCase(),token_symbol:"USDT",token_decimals:decimals,
   recipient_address:String(config.recipient_address).toLowerCase(),amount_atomic:amountAtomic
  }).select("id,price_usd,chain_id,token_contract,token_symbol,token_decimals,recipient_address,amount_atomic,expires_at").single();
  if(error||!order)throw Error("Unable to create payment order.");
  return json(req,{ok:true,order:{...order,amount:"$"+Number(price).toFixed(2)+" USDT",network:"BNB Smart Chain",instructions:"Send the exact USDT amount to the receiving address, then submit the transaction hash for verification."}},201);
 }catch(e){console.error("create-audit-payment-order",String((e as any)?.message||e));return json(req,{ok:false,error:String((e as any)?.message||"Unable to create payment order.")},400);}
});
