import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ethers } from "npm:ethers@6.15.0";
const RPC=Deno.env.get("BSC_RPC_URL")||"https://bsc-rpc.publicnode.com",CHAIN=56,USDT="0x55d398326f99059ff775485246999027b3197955";
const ERC20=new ethers.Interface(["event Transfer(address indexed from,address indexed to,uint256 amount)"]);
const SAFE=new ethers.Interface(["function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns(bytes32)","event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)","event ExecutionFailure(bytes32 indexed txHash,uint256 payment)"]);
const cors={"Access-Control-Allow-Origin":"https://web3market.xyz","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(s:number,b:unknown)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"content-type":"application/json"}});
const norm=(a:string)=>ethers.getAddress(a).toLowerCase();
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return json(405,{ok:false,error:"POST required"});
 const tok=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
 if(!tok)return json(401,{ok:false,error:"Missing authorization token"});
 const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
 const {data:u,error:ue}=await sb.auth.getUser(tok); if(ue||!u.user)return json(401,{ok:false,error:"Invalid session"});
 let b:any={};try{b=await req.json()}catch{}
 const dealId=String(b.deal_id||""),txHash=String(b.tx_hash||"");
 if(!/^[0-9a-f-]{36}$/i.test(dealId)||!/^0x[0-9a-fA-F]{64}$/.test(txHash))return json(400,{ok:false,error:"Invalid request"});
 const {data:deal}=await sb.from("deals").select("*").eq("id",dealId).maybeSingle();
 if(!deal)return json(404,{ok:false,error:"Deal not found"});
  const {data:activeDispute}=await sb.from("deal_disputes").select("id,status").eq("deal_id",dealId).in("status",["open","under_review"]).maybeSingle();
  if(activeDispute||["open","under_review"].includes(String(deal.dispute_status||"").toLowerCase()))return json(409,{ok:false,error:"Release finalization is blocked while a dispute is open"});
 if(deal.buyer_id!==u.user.id&&deal.seller_id!==u.user.id)return json(403,{ok:false,error:"Not a participant"});
 const {data:tx}=await sb.from("deal_multisig_transactions").select("*").eq("deal_id",dealId).eq("action","release_to_seller").maybeSingle();
 const {data:policy}=await sb.from("deal_release_policies").select("*").eq("deal_id",dealId).maybeSingle();
 if(!tx||!policy)return json(409,{ok:false,error:"Release records missing"});
 if(!["signed","submitted","confirmed"].includes(String(tx.status))||Number(tx.confirmations_count)<2)return json(409,{ok:false,error:"Two Safe signatures are required and the transaction must be signed or submitted"});
 if(String(deal.release_tx_hash||"") && String(deal.release_tx_hash).toLowerCase()!==txHash.toLowerCase())return json(409,{ok:false,error:"A different release transaction is already finalized"});
 if(String(tx.tx_hash||"") && String(tx.tx_hash).toLowerCase()!==txHash.toLowerCase())return json(409,{ok:false,error:"Submitted transaction hash does not match the stored release transaction"});
 const provider=new ethers.JsonRpcProvider(RPC,CHAIN,{staticNetwork:true}),safeAddress=ethers.getAddress(policy.safe_address);
 const safe=new ethers.Contract(safeAddress,SAFE,provider);
 const [onchainTx,receipt]=await Promise.all([provider.getTransaction(txHash),provider.getTransactionReceipt(txHash)]);
 if(!onchainTx||!receipt)return json(409,{ok:false,error:"Transaction is not mined yet"});
 if(receipt.status!==1)return json(409,{ok:false,error:"Safe execution reverted"});
 if(!onchainTx.to||norm(onchainTx.to)!==norm(safeAddress))return json(409,{ok:false,error:"Execution transaction was not sent to the configured Safe"});
 const recomputed=await safe.getTransactionHash(ethers.getAddress(tx.to_address),BigInt(tx.value_wei||0),String(tx.data||"0x"),Number(tx.operation),BigInt(tx.safe_tx_gas||0),BigInt(tx.base_gas||0),BigInt(tx.gas_price||0),ethers.getAddress(tx.gas_token||ethers.ZeroAddress),ethers.getAddress(tx.refund_receiver||ethers.ZeroAddress),BigInt(tx.safe_nonce));
 if(String(recomputed).toLowerCase()!==String(tx.safe_tx_hash).toLowerCase())return json(409,{ok:false,error:"Stored Safe transaction payload does not match its signed Safe transaction hash"});
 let executionMatched=false,executionFailure=false;
 for(const log of receipt.logs){if(norm(log.address)!==norm(safeAddress))continue;try{const p=SAFE.parseLog({topics:[...log.topics],data:log.data});if(!p)continue;const h=String(p.args[0]).toLowerCase();if(p.name==="ExecutionSuccess"&&h===String(tx.safe_tx_hash).toLowerCase())executionMatched=true;if(p.name==="ExecutionFailure"&&h===String(tx.safe_tx_hash).toLowerCase())executionFailure=true}catch{}}
 if(executionFailure)return json(409,{ok:false,error:"Safe emitted ExecutionFailure for the signed transaction"});
 if(!executionMatched)return json(409,{ok:false,error:"Receipt does not contain Safe ExecutionSuccess for the signed transaction hash"});
 const seller=norm(policy.seller_wallet),platform=norm(policy.platform_wallet),safeAddr=norm(policy.safe_address);
 let sellerOk=false,feeOk=false;
 for(const log of receipt.logs){if(norm(log.address)!==norm(USDT))continue;try{const p=ERC20.parseLog({topics:[...log.topics],data:log.data});if(!p||p.name!=="Transfer")continue;const from=norm(String(p.args[0])),to=norm(String(p.args[1])),amt=BigInt(p.args[2].toString());if(from===safeAddr&&to===seller&&amt===ethers.parseUnits(String(policy.seller_net_amount),18))sellerOk=true;if(from===safeAddr&&to===platform&&amt===ethers.parseUnits(String(policy.fee_amount),18))feeOk=true}catch{}}
 if(!sellerOk||!feeOk)return json(409,{ok:false,error:"On-chain receipt does not contain the exact Safe→seller and Safe→platform USDT transfers"});
 const now=new Date().toISOString();
 const {data:updated,error:up}=await sb.from("deal_multisig_transactions").update({tx_hash:txHash,status:"confirmed",updated_at:now}).eq("id",tx.id).select("*").single();if(up)return json(500,{ok:false,error:"Could not finalize multisig record"});
 const {error:dp}=await sb.from("deal_release_policies").update({status:"released",released_at:now,release_tx_hash:txHash}).eq("id",policy.id);if(dp)return json(500,{ok:false,error:"Release policy update failed"});
 const {data:finalDeal,error:de}=await sb.from("deals").update({release_tx_hash:txHash,status:"completed",completed_at:now,updated_at:now}).eq("id",dealId).select("*").single();if(de)return json(500,{ok:false,error:"Deal finalization failed"});
  // A successfully settled project is no longer available for another purchase.
  // Keep the listing visible as a permanent sold record.
  if(deal.project_id){
    const {error:projectUpdateError}=await sb.from("projects").update({status:"sold",updated_at:now}).eq("id",deal.project_id);
    if(projectUpdateError)return json(500,{ok:false,error:"Deal completed but project sold-status update failed"});
  }
 await sb.from("deal_audit_logs").insert({deal_id:dealId,actor_id:u.user.id,action:"safe_release_confirmed",metadata:{tx_hash:txHash,safe_tx_hash:String(tx.safe_tx_hash),safe_nonce:Number(tx.safe_nonce),seller_amount:String(policy.seller_net_amount),platform_fee:String(policy.fee_amount)}});
 return json(200,{ok:true,completed:true,release_tx_hash:txHash,safe_tx_hash:String(tx.safe_tx_hash),safe_nonce:Number(tx.safe_nonce),seller_amount:String(policy.seller_net_amount),platform_fee:String(policy.fee_amount),deal:finalDeal,transaction:updated});
});