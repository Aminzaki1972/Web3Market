import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ethers } from "npm:ethers@6.15.0";
const CHAIN_ID=56;
const cors={"Access-Control-Allow-Origin":"https://web3market.xyz","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const ZERO=ethers.ZeroAddress;
function json(status:number,body:unknown){return new Response(JSON.stringify(body),{status,headers:{...cors,"content-type":"application/json"}})}
function norm(a:string){return ethers.getAddress(a).toLowerCase()}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST") return json(405,{ok:false,error:"POST required"});
 const auth=req.headers.get("authorization")||"",token=auth.replace(/^Bearer\s+/i,"").trim();
 if(!token)return json(401,{ok:false,error:"Missing authorization token"});
 const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
 const {data:u,error:ue}=await sb.auth.getUser(token); if(ue||!u.user)return json(401,{ok:false,error:"Invalid session"});
 let b:any={};try{b=await req.json()}catch{}
 const dealId=String(b.deal_id||""),signature=String(b.signature||"");
 if(!/^[0-9a-f-]{36}$/i.test(dealId)||!/^0x[0-9a-fA-F]{130}$/.test(signature))return json(400,{ok:false,error:"Invalid request"});
 const {data:deal}=await sb.from("deals").select("*").eq("id",dealId).maybeSingle(); if(!deal)return json(404,{ok:false,error:"Deal not found"});
  const {data:activeDispute}=await sb.from("deal_disputes").select("id,status").eq("deal_id",dealId).in("status",["open","under_review"]).maybeSingle();
  if(activeDispute||["open","under_review"].includes(String(deal.dispute_status||"").toLowerCase()))return json(409,{ok:false,error:"Release signatures are blocked while a dispute is open"});
 if(deal.buyer_id!==u.user.id&&deal.seller_id!==u.user.id)return json(403,{ok:false,error:"Not a participant"});
 const {data:tx}=await sb.from("deal_multisig_transactions").select("*").eq("deal_id",dealId).eq("action","release_to_seller").maybeSingle();
 if(!tx?.safe_tx_hash)return json(409,{ok:false,error:"Safe transaction is not prepared"});
 const {data:profile}=await sb.from("profiles").select("wallet_address,wallet_verified,role").eq("id",u.user.id).maybeSingle();
 if(!profile?.wallet_verified||!profile.wallet_address)return json(409,{ok:false,error:"Wallet is not verified"});
 const safe=ethers.getAddress(tx.safe_address);
 const provider=new ethers.JsonRpcProvider("https://bsc-rpc.publicnode.com",CHAIN_ID,{staticNetwork:true});
 const safeContract=new ethers.Contract(safe,["function getOwners() view returns(address[])","function getThreshold() view returns(uint256)","function nonce() view returns(uint256)"],provider);
 const [owners,threshold,nonce]=await Promise.all([safeContract.getOwners(),safeContract.getThreshold(),safeContract.nonce()]);
 if(Number(threshold)!==2||Number(nonce)!==Number(tx.safe_nonce))return json(409,{ok:false,error:"Safe nonce or threshold changed"});
 const owner=norm(profile.wallet_address);
 if(!(owners as string[]).map(norm).includes(owner))return json(403,{ok:false,error:"Connected wallet is not a Safe owner"});
 const domain={chainId:CHAIN_ID,verifyingContract:safe};
 const types={SafeTx:[
  {name:"to",type:"address"},{name:"value",type:"uint256"},{name:"data",type:"bytes"},{name:"operation",type:"uint8"},
  {name:"safeTxGas",type:"uint256"},{name:"baseGas",type:"uint256"},{name:"gasPrice",type:"uint256"},
  {name:"gasToken",type:"address"},{name:"refundReceiver",type:"address"},{name:"nonce",type:"uint256"}]};
 const message={to:ethers.getAddress(tx.to_address),value:String(tx.value_wei),data:tx.data,operation:Number(tx.operation),safeTxGas:String(tx.safe_tx_gas),baseGas:String(tx.base_gas),gasPrice:String(tx.gas_price),gasToken:ethers.getAddress(tx.gas_token||ZERO),refundReceiver:ethers.getAddress(tx.refund_receiver||ZERO),nonce:Number(tx.safe_nonce)};
 const digest=ethers.TypedDataEncoder.hash(domain,types,message);
 if(digest.toLowerCase()!==String(tx.safe_tx_hash).toLowerCase())return json(409,{ok:false,error:"Safe transaction hash mismatch"});
 let recovered:string;try{recovered=norm(ethers.verifyTypedData(domain,types,message,signature))}catch{return json(400,{ok:false,error:"Invalid signature"});
 }
 if(recovered!==owner)return json(403,{ok:false,error:"Signature does not match the verified wallet"});
 const {data:existing}=await sb.from("deal_multisig_signers").select("*").eq("deal_id",dealId).eq("safe_tx_hash",tx.safe_tx_hash).eq("wallet_address",profile.wallet_address).maybeSingle();
 if(existing?.signature===signature)return json(200,{ok:true,already_recorded:true,confirmations_count:Number(tx.confirmations_count||0)});
 const role=deal.buyer_id===u.user.id?"buyer":"seller";
 const row={deal_id:dealId,signer_role:role,signer_id:u.user.id,wallet_address:profile.wallet_address,signature_status:"signed",signed_at:new Date().toISOString(),safe_tx_hash:tx.safe_tx_hash,signature};
 const {error:upsertError}=await sb.from("deal_multisig_signers").upsert(row,{onConflict:"deal_id,signer_role"});
 if(upsertError)return json(500,{ok:false,error:"Could not record signature",detail:upsertError.message});
 const {data:rawSigs}=await sb.from("deal_multisig_signers").select("wallet_address,signature").eq("deal_id",dealId).eq("safe_tx_hash",tx.safe_tx_hash).eq("signature_status","signed");
 const sigs=(rawSigs||[]).slice().sort((a:any,b:any)=>norm(a.wallet_address).localeCompare(norm(b.wallet_address)));
 const count=sigs?.length||0;
 const {data:updated}=await sb.from("deal_multisig_transactions").update({signatures:sigs||[],confirmations_count:count,status:count>=2?"signed":"awaiting_signatures",updated_at:new Date().toISOString()}).eq("id",tx.id).select("*").single();
 return json(200,{ok:true,recorded:true,confirmations_count:count,required_signatures:2,status:updated?.status||"awaiting_signatures"});
});