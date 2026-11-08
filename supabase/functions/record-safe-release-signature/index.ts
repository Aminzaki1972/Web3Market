import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getW3MDealProtocolTrack } from "../_shared/w3m-deal-protocol-track.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ethers } from "npm:ethers@6.15.0";
import { assertW3MFinalizationReady, W3MFinalizationGateError } from "../_shared/w3m-v1-finalization-gate.ts";
import { getW3MCanonicalSettlement, assertW3MSettlementPolicyMatches } from "../_shared/w3m-v1-settlement-evidence.ts";
const CHAIN_ID=56;
const USDT="0x55d398326f99059ff775485246999027b3197955";
const cors={"Access-Control-Allow-Origin":"https://web3market.xyz","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const ZERO=ethers.ZeroAddress;
function json(status:number,body:unknown){return new Response(JSON.stringify(body),{status,headers:{...cors,"content-type":"application/json"}})}
function norm(a:string){return ethers.getAddress(a).toLowerCase()}
const TERMINAL_DISPUTE_STATES = new Set(["none", "resolved", "resolved_buyer", "resolved_seller", "closed", "dismissed", "rejected", "cancelled", "canceled", "withdrawn"]);
async function checkDisputeState(db: any, deal: any, dealId: string): Promise<"clear" | "open" | "unknown"> {
 const state=String(deal?.dispute_status??"").trim().toLowerCase();
 if (!state) return "unknown";
 if (!TERMINAL_DISPUTE_STATES.has(state)) return "open";
 const {data,error}=await db.from("deal_disputes").select("status").eq("deal_id",dealId);
 if(error)return "unknown";
 if((data||[]).some((row:any)=>!TERMINAL_DISPUTE_STATES.has(String(row?.status||"open").trim().toLowerCase())))return "open";
 return "clear";
}
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
 if(deal.buyer_id!==u.user.id&&deal.seller_id!==u.user.id)return json(403,{ok:false,error:"Not a participant"});
 let protocolTrack: "legacy" | "v1";
 try {
  protocolTrack = await getW3MDealProtocolTrack(sb, dealId);
 } catch {
  return json(503,{ok:false,error:"Deal protocol classification is unavailable"});
 }
 if (protocolTrack === "v1") {
  try {
   await assertW3MFinalizationReady(sb, dealId);
  } catch (error) {
   return json(409,{ok:false,error:"W3M V1 buyer and seller agreement acceptance is required before recording Safe signatures",code:error instanceof W3MFinalizationGateError?error.code:"W3M_FINALIZATION_EVIDENCE_UNAVAILABLE"});
  }
 }
 const disputeState=await checkDisputeState(sb,deal,dealId);
 if(disputeState!=="clear")return json(409,{ok:false,error:disputeState==="open"?"Release signatures are blocked while a dispute is open":"Unable to verify dispute status; signature recording blocked",code:disputeState==="open"?"DEAL_DISPUTE_OPEN":"DISPUTE_STATUS_UNAVAILABLE"});
 if(!["funded","in_progress"].includes(String(deal.status||"")))return json(409,{ok:false,error:"Deal is not in a releasable funded state"});
 if(String(deal.delivery_status||"").toLowerCase()!=="accepted"||!deal.buyer_approved_at)return json(409,{ok:false,error:"Delivery is not accepted"});
 if(String(deal.payment_status||"").toLowerCase()!=="confirmed"||!deal.payment_tx_hash)return json(409,{ok:false,error:"Buyer payment is not confirmed"});
 const {data:policy,error:policyError}=await sb.from("deal_release_policies").select("*").eq("deal_id",dealId).maybeSingle();
 if (protocolTrack === "v1") {
  try {
   const {data:fullPolicy,error:fullPolicyError}=await sb.from("deal_release_policies").select("*").eq("deal_id",dealId).maybeSingle();
   if (fullPolicyError || !fullPolicy) throw new Error("Locked release policy could not be loaded.");
   const settlement = await getW3MCanonicalSettlement(sb, dealId);
   assertW3MSettlementPolicyMatches(settlement, fullPolicy);
  } catch (error) {
   return json(409,{ok:false,error:"Locked release policy does not match the signed W3M V1 settlement",code:"W3M_SETTLEMENT_POLICY_MISMATCH",detail:error instanceof Error?error.message:String(error)});
  }
 }
 if(policyError||!policy)return json(409,{ok:false,error:"Locked release policy is unavailable"});
 if(String(policy.status||"").toLowerCase()!=="locked"||Number(policy.chain_id)!==CHAIN_ID)return json(409,{ok:false,error:"Release policy is not locked for BNB Smart Chain"});
 if(!policy.safe_address||!deal.safe_address||ethers.getAddress(policy.safe_address).toLowerCase()!==ethers.getAddress(deal.safe_address).toLowerCase())return json(409,{ok:false,error:"Release policy Safe does not match the deal Safe"});
 if(!policy.token_contract||ethers.getAddress(policy.token_contract).toLowerCase()!==ethers.getAddress(USDT).toLowerCase())return json(409,{ok:false,error:"Release policy token is not the configured BNB USDT asset"});
 if(String(deal.release_tx_hash||""))return json(409,{ok:false,error:"Release already finalized"});
 const {data:tx}=await sb.from("deal_multisig_transactions").select("*").eq("deal_id",dealId).eq("action","release_to_seller").maybeSingle();
 if(!tx?.safe_tx_hash)return json(409,{ok:false,error:"Safe transaction is not prepared"});
 if(!tx.safe_address||ethers.getAddress(tx.safe_address).toLowerCase()!==ethers.getAddress(policy.safe_address).toLowerCase())return json(409,{ok:false,error:"Prepared Safe transaction address does not match the locked release policy"});
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