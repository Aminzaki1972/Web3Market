import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ethers } from "npm:ethers@6.15.0";
import { assertW3MFinalizationReady, W3MFinalizationGateError } from "../_shared/w3m-v1-finalization-gate.ts";
const RPC=Deno.env.get("BSC_RPC_URL")||"https://bsc-rpc.publicnode.com",CHAIN=56,USDT="0x55d398326f99059ff775485246999027b3197955",EXECUTOR="0xCbd947146826aB5BBF9924105E69e9c6F5e9420C";
const ERC20=new ethers.Interface(["event Transfer(address indexed from,address indexed to,uint256 amount)"]);
const SAFE=new ethers.Interface(["function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns(bytes32)","function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool)","event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)","event ExecutionFailure(bytes32 indexed txHash,uint256 payment)"]);
const cors={"Access-Control-Allow-Origin":"https://web3market.xyz","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(s:number,b:unknown)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"content-type":"application/json"}});
const norm=(a:string)=>ethers.getAddress(a).toLowerCase();
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
 if(deal.buyer_id!==u.user.id&&deal.seller_id!==u.user.id)return json(403,{ok:false,error:"Not a participant"});
 try {
  await assertW3MFinalizationReady(sb, dealId);
 } catch (error) {
  return json(409,{ok:false,error:"W3M V1 buyer and seller agreement acceptance is required before release finalization",code:error instanceof W3MFinalizationGateError?error.code:"W3M_FINALIZATION_EVIDENCE_UNAVAILABLE"});
 }
 const disputeState=await checkDisputeState(sb,deal,dealId);
 if(disputeState!=="clear")return json(409,{ok:false,error:disputeState==="open"?"Release is blocked while a dispute is open":"Unable to verify dispute status; release finalization blocked",code:disputeState==="open"?"DEAL_DISPUTE_OPEN":"DISPUTE_STATUS_UNAVAILABLE"});
 const {data:tx}=await sb.from("deal_multisig_transactions").select("*").eq("deal_id",dealId).eq("action","release_to_seller").maybeSingle();
 const {data:policy}=await sb.from("deal_release_policies").select("*").eq("deal_id",dealId).maybeSingle();
 if(!tx||!policy)return json(409,{ok:false,error:"Release records missing"});
 if(!policy.safe_address||!deal.safe_address||norm(policy.safe_address)!==norm(deal.safe_address)||Number(policy.chain_id)!==CHAIN)return json(409,{ok:false,error:"Release policy Safe or chain does not match the deal"});
 if(!policy.token_contract||norm(policy.token_contract)!==norm(USDT))return json(409,{ok:false,error:"Release policy token is not the configured BNB USDT asset"});
 if(!tx.safe_address||norm(tx.safe_address)!==norm(policy.safe_address))return json(409,{ok:false,error:"Prepared Safe transaction address does not match the release policy"});
 if(!["signed","submitted","confirmed"].includes(String(tx.status))||Number(tx.confirmations_count)<2)return json(409,{ok:false,error:"Two Safe signatures are required and the transaction must be signed or submitted"});
 if(String(deal.release_tx_hash||"") && String(deal.release_tx_hash).toLowerCase()!==txHash.toLowerCase())return json(409,{ok:false,error:"A different release transaction is already finalized"});
 if(String(tx.tx_hash||"") && String(tx.tx_hash).toLowerCase()!==txHash.toLowerCase())return json(409,{ok:false,error:"Submitted transaction hash does not match the stored release transaction"});
 const provider=new ethers.JsonRpcProvider(RPC,CHAIN,{staticNetwork:true}),safeAddress=ethers.getAddress(policy.safe_address);
 const safe=new ethers.Contract(safeAddress,SAFE,provider);
 const [onchainTx,receipt]=await Promise.all([provider.getTransaction(txHash),provider.getTransactionReceipt(txHash)]);
 if(!onchainTx||!receipt)return json(409,{ok:false,error:"Transaction is not mined yet"});
 if(!onchainTx.to||norm(onchainTx.to)!==norm(safeAddress))return json(409,{ok:false,error:"Execution transaction was not sent to the configured Safe"});
 if(!onchainTx.from||norm(onchainTx.from)!==norm(EXECUTOR))return json(409,{ok:false,error:"Execution transaction sender does not match the configured Web3Market executor"});
 let decodedExecution;
 try { decodedExecution=SAFE.parseTransaction({data:onchainTx.data,value:onchainTx.value}); }
 catch { return json(409,{ok:false,error:"Outer transaction calldata is not a valid Safe execTransaction"}); }
 if(!decodedExecution||decodedExecution.name!=="execTransaction")return json(409,{ok:false,error:"Outer transaction did not call Safe execTransaction"});
 const executionArgs=decodedExecution.args;
 const sameExecutionPayload=
  norm(String(executionArgs[0]))===norm(tx.to_address) &&
  BigInt(executionArgs[1].toString())===BigInt(tx.value_wei||0) &&
  String(executionArgs[2]).toLowerCase()===String(tx.data||"0x").toLowerCase() &&
  Number(executionArgs[3])===Number(tx.operation) &&
  BigInt(executionArgs[4].toString())===BigInt(tx.safe_tx_gas||0) &&
  BigInt(executionArgs[5].toString())===BigInt(tx.base_gas||0) &&
  BigInt(executionArgs[6].toString())===BigInt(tx.gas_price||0) &&
  norm(String(executionArgs[7]))===norm(tx.gas_token||ethers.ZeroAddress) &&
  norm(String(executionArgs[8]))===norm(tx.refund_receiver||ethers.ZeroAddress);
 if(!sameExecutionPayload)return json(409,{ok:false,error:"Outer Safe execTransaction payload does not match the signed database transaction"});
 const recomputed=await safe.getTransactionHash(ethers.getAddress(tx.to_address),BigInt(tx.value_wei||0),String(tx.data||"0x"),Number(tx.operation),BigInt(tx.safe_tx_gas||0),BigInt(tx.base_gas||0),BigInt(tx.gas_price||0),ethers.getAddress(tx.gas_token||ethers.ZeroAddress),ethers.getAddress(tx.refund_receiver||ethers.ZeroAddress),BigInt(tx.safe_nonce));
 if(String(recomputed).toLowerCase()!==String(tx.safe_tx_hash).toLowerCase())return json(409,{ok:false,error:"Stored Safe transaction payload does not match its signed Safe transaction hash"});
 if(receipt.status===0){
  const {error:claimFailError}=await sb.rpc("w3m_mark_safe_release_failed",{
   p_deal_id:dealId,p_safe_tx_hash:String(tx.safe_tx_hash),p_safe_nonce:Number(tx.safe_nonce),
   p_transaction_hash:txHash,p_failure_code:"evm_revert"
  });
  if(claimFailError)return json(500,{ok:false,error:"EVM revert is confirmed but the durable release claim could not be closed; dispute remains blocked"});
  return json(409,{ok:false,error:"Safe execution transaction reverted; the claim was closed after the confirmed chain receipt"});
 }
 if(receipt.status!==1)return json(409,{ok:false,error:"Safe execution receipt status is not confirmed"});
 const {error:claimSubmitError}=await sb.rpc("w3m_mark_safe_release_submitted",{
  p_deal_id:dealId,p_safe_tx_hash:String(tx.safe_tx_hash),p_safe_nonce:Number(tx.safe_nonce),p_transaction_hash:txHash
 });
 if(claimSubmitError)return json(500,{ok:false,error:"Could not persist the mined Safe transaction against its active release claim"});
 let executionMatched=false,executionFailure=false;
 for(const log of receipt.logs){if(norm(log.address)!==norm(safeAddress))continue;try{const p=SAFE.parseLog({topics:[...log.topics],data:log.data});if(!p)continue;const h=String(p.args[0]).toLowerCase();if(p.name==="ExecutionSuccess"&&h===String(tx.safe_tx_hash).toLowerCase())executionMatched=true;if(p.name==="ExecutionFailure"&&h===String(tx.safe_tx_hash).toLowerCase())executionFailure=true}catch{}}
 if(executionFailure){
  const {error:claimFailError}=await sb.rpc("w3m_mark_safe_release_failed",{
   p_deal_id:dealId,p_safe_tx_hash:String(tx.safe_tx_hash),p_safe_nonce:Number(tx.safe_nonce),
   p_transaction_hash:txHash,p_failure_code:"safe_execution_failure"
  });
  if(claimFailError)return json(500,{ok:false,error:"Safe ExecutionFailure is confirmed but the durable release claim could not be closed"});
  return json(409,{ok:false,error:"Safe emitted ExecutionFailure for the signed transaction; the claim was closed after on-chain confirmation"});
 }
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
 const {error:claimFinalizedError}=await sb.rpc("w3m_mark_safe_release_finalized",{
  p_deal_id:dealId,p_safe_tx_hash:String(tx.safe_tx_hash),p_safe_nonce:Number(tx.safe_nonce),p_transaction_hash:txHash
 });
 if(claimFinalizedError)return json(500,{ok:false,error:"Deal settlement is recorded but the durable Safe release claim could not be finalized; keep the dispute hold active"});
 await sb.from("deal_audit_logs").insert({deal_id:dealId,actor_id:u.user.id,action:"safe_release_confirmed",metadata:{tx_hash:txHash,safe_tx_hash:String(tx.safe_tx_hash),safe_nonce:Number(tx.safe_nonce),seller_amount:String(policy.seller_net_amount),platform_fee:String(policy.fee_amount)}});
 return json(200,{ok:true,completed:true,release_tx_hash:txHash,safe_tx_hash:String(tx.safe_tx_hash),safe_nonce:Number(tx.safe_nonce),seller_amount:String(policy.seller_net_amount),platform_fee:String(policy.fee_amount),deal:finalDeal,transaction:updated});
});