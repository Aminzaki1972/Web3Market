import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getW3MDealProtocolTrack } from "../_shared/w3m-deal-protocol-track.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ethers } from "npm:ethers@6.15.0";
import { assertW3MFinalizationReady, W3MFinalizationGateError } from "../_shared/w3m-v1-finalization-gate.ts";
import { getW3MCanonicalSettlement, assertW3MSettlementPolicyMatches } from "../_shared/w3m-v1-settlement-evidence.ts";
import { assertW3MV1SafeReleasePayloadMatchesPolicy } from "../_shared/w3m-v1-safe-payload.ts";

const RPC = Deno.env.get("BSC_RPC_URL") || "https://bsc-rpc.publicnode.com";
const CHAIN = 56;
const USDT = "0x55d398326f99059ff775485246999027b3197955";
const EXECUTOR = "0xCbd947146826aB5BBF9924105E69e9c6F5e9420C";
const PLATFORM = "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9";
const ZERO = ethers.ZeroAddress;
const SAFE_ABI = [
  "function getOwners() view returns(address[])",
  "function getThreshold() view returns(uint256)",
  "function nonce() view returns(uint256)",
  "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns(bytes32)",
  "function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) payable returns(bool)",
  "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)",
  "event ExecutionFailure(bytes32 indexed txHash,uint256 payment)"
];

const cors = {
  "Access-Control-Allow-Origin":"https://web3market.xyz",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(s:number,b:unknown)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"content-type":"application/json"}});
const norm=(a:string)=>ethers.getAddress(a).toLowerCase();
const TERMINAL_DISPUTE_STATES = new Set(["none", "resolved", "resolved_buyer", "resolved_seller", "closed", "dismissed", "rejected", "cancelled", "canceled", "withdrawn"]);
async function checkDisputeState(db: any, deal: any, dealId: string): Promise<"clear" | "open" | "unknown"> {
  const state = String(deal?.dispute_status ?? "").trim().toLowerCase();
  if (!state) return "unknown";
 if (!TERMINAL_DISPUTE_STATES.has(state)) return "open";
  const { data, error } = await db.from("deal_disputes").select("status").eq("deal_id", dealId);
  if (error) return "unknown";
  if ((data || []).some((row: any) => !TERMINAL_DISPUTE_STATES.has(String(row?.status || "open").trim().toLowerCase()))) return "open";
  return "clear";
}


function packSignatures(rows:any[]){
  const sorted=rows.slice().sort((a,b)=>norm(a.wallet_address).localeCompare(norm(b.wallet_address)));
  return "0x"+sorted.map(x=>String(x.signature).replace(/^0x/,"")).join("");
}

Deno.serve(async req=>{
  let releaseBroadcastAttempted=false;
  try{
    if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
    if(req.method!=="POST") return json(405,{ok:false,error:"POST required"});

    const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
    if(!token) return json(401,{ok:false,error:"Missing authorization token"});
    const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const {data:userData,error:userError}=await sb.auth.getUser(token);
    if(userError||!userData.user) return json(401,{ok:false,error:"Invalid session"});

    let body:any={}; try{body=await req.json()}catch{}
    const dealId=String(body.deal_id||"").trim();
    const mode=String(body.mode||"check").toLowerCase();
    if(!/^[0-9a-f-]{36}$/i.test(dealId)) return json(400,{ok:false,error:"Invalid deal_id"});
    if(mode!=="check"&&mode!=="execute") return json(400,{ok:false,error:"mode must be check or execute"});

    const {data:deal}=await sb.from("deals").select("*").eq("id",dealId).maybeSingle();
    if(!deal) return json(404,{ok:false,error:"Deal not found"});
    if(deal.buyer_id!==userData.user.id&&deal.seller_id!==userData.user.id)
      return json(403,{ok:false,error:"Not a deal participant"});
    let protocolTrack: "legacy" | "v1";
    try {
      protocolTrack = await getW3MDealProtocolTrack(sb, dealId);
    } catch {
      return json(503,{ok:false,transaction_sent:false,error:"Deal protocol classification is unavailable"});
    }
    if(mode==="execute" && protocolTrack==="v1"){
      try {
        await assertW3MFinalizationReady(sb, dealId);
      } catch (error) {
        return json(409,{ok:false,transaction_sent:false,error:"W3M V1 buyer and seller agreement acceptance is required before Safe execution",code:error instanceof W3MFinalizationGateError?error.code:"W3M_FINALIZATION_EVIDENCE_UNAVAILABLE"});
      }
    }
    const disputeState=await checkDisputeState(sb,deal,dealId);
    if(disputeState!=="clear") return json(409,{ok:false,error:disputeState==="open"?"Release is blocked while a dispute is open":"Unable to verify dispute status; release blocked",code:disputeState==="open"?"DEAL_DISPUTE_OPEN":"DISPUTE_STATUS_UNAVAILABLE"});
    if(!["funded","in_progress"].includes(String(deal.status||""))) return json(409,{ok:false,transaction_sent:false,error:"Deal is not in a releasable funded state"});

    const {data:tx}=await sb.from("deal_multisig_transactions").select("*").eq("deal_id",dealId).eq("action","release_to_seller").maybeSingle();
    if(!tx) return json(409,{ok:false,error:"Release transaction not found"});
    if(String(tx.status)!=="signed"||Number(tx.confirmations_count)<2)
      return json(409,{ok:false,error:"Two valid Safe signatures are required"});
    // Safety guard: release must use MultiSendCallOnly via DELEGATECALL.
    // A stale CALL(0) transaction can trigger Safe GS013 because the token transfer
    // would be attempted by MultiSendCallOnly instead of the Safe.
    if(Number(tx.operation)!==1)
      return json(409,{ok:false,error:"Stale Safe release transaction: operation must be DELEGATECALL (1). Prepare a new release transaction first"});
    if(String(deal.release_tx_hash||"")) return json(409,{ok:false,error:"Release already finalized"});

    if(String(deal.delivery_status||"").toLowerCase()!=="accepted"||!deal.buyer_approved_at)return json(409,{ok:false,transaction_sent:false,error:"Delivery is not accepted"});
    if(String(deal.payment_status||"").toLowerCase()!=="confirmed"||!deal.payment_tx_hash)return json(409,{ok:false,transaction_sent:false,error:"Buyer payment is not confirmed"});
    const {data:policy}=await sb.from("deal_release_policies").select("*").eq("deal_id",dealId).maybeSingle();
    if(!policy) return json(409,{ok:false,error:"Release policy not found"});
 if (protocolTrack === "v1") {
  try { assertW3MV1SafeReleasePayloadMatchesPolicy(tx, policy); }
  catch (error) {
   return json(409,{ok:false,transaction_sent:false,error:"Prepared Safe transaction does not match the exact signed W3M V1 settlement",code:"W3M_SAFE_PAYLOAD_MISMATCH",detail:error instanceof Error?error.message:String(error)});
  }
 }
    if (protocolTrack === "v1") {
      try {
        const settlement = await getW3MCanonicalSettlement(sb, dealId);
        assertW3MSettlementPolicyMatches(settlement, policy);
      } catch (error) {
        return json(409,{ok:false,transaction_sent:false,error:"Locked release policy does not match the signed W3M V1 settlement",code:"W3M_SETTLEMENT_POLICY_MISMATCH",detail:error instanceof Error?error.message:String(error)});
      }
    }
    if(String(policy.status||"").toLowerCase()!=="locked")return json(409,{ok:false,transaction_sent:false,error:"Release policy is not locked"});
    if(!policy.safe_address||!deal.safe_address||norm(policy.safe_address)!==norm(deal.safe_address))return json(409,{ok:false,transaction_sent:false,error:"Release policy Safe does not match the deal Safe"});
    if(Number(policy.chain_id)!==CHAIN||!policy.token_contract||norm(policy.token_contract)!==norm(USDT))return json(409,{ok:false,transaction_sent:false,error:"Release policy chain or token is not the configured BNB USDT asset"});
    if(!tx.safe_address||norm(tx.safe_address)!==norm(policy.safe_address))return json(409,{ok:false,transaction_sent:false,error:"Prepared Safe transaction address does not match the locked release policy"});

    const provider=new ethers.JsonRpcProvider(RPC,CHAIN,{staticNetwork:true});
    const safeAddress=ethers.getAddress(policy.safe_address);
    const safe=new ethers.Contract(safeAddress,SAFE_ABI,provider);

    const [owners,threshold,nonce,code]=await Promise.all([
      safe.getOwners(),safe.getThreshold(),safe.nonce(),provider.getCode(EXECUTOR)
    ]);
    if(Number(threshold)!==2) return json(409,{ok:false,error:"Safe threshold is not 2"});
    if((owners as string[]).length!==3) return json(409,{ok:false,error:"Safe must have exactly three owners for the configured 2-of-3 V1 policy"});
    const {data:profiles,error:profileError}=await sb.from("profiles").select("id,wallet_address,wallet_verified").in("id",[deal.buyer_id,deal.seller_id]);
    if(profileError) return json(503,{ok:false,error:"Could not verify the buyer and seller wallet ownership"});
    const buyerProfile=profiles?.find((profile:any)=>profile.id===deal.buyer_id);
    const sellerProfile=profiles?.find((profile:any)=>profile.id===deal.seller_id);
    if(!buyerProfile?.wallet_verified||!sellerProfile?.wallet_verified||!buyerProfile.wallet_address||!sellerProfile.wallet_address)
      return json(409,{ok:false,error:"Buyer and seller verified wallets are required for Safe owner verification"});
    const expectedOwners=new Set([norm(buyerProfile.wallet_address),norm(sellerProfile.wallet_address),norm(PLATFORM)]);
    const actualOwners=new Set((owners as string[]).map(norm));
    if(expectedOwners.size!==3||actualOwners.size!==3||[...expectedOwners].some(owner=>!actualOwners.has(owner)))
      return json(409,{ok:false,error:"Safe owners no longer match the verified buyer, seller, and platform wallets"});
    if(Number(nonce)!==Number(tx.safe_nonce)) return json(409,{ok:false,error:"Safe nonce changed; do not execute this signed transaction"});
    if(code!=="0x") return json(409,{ok:false,error:"Configured executor is a contract, not an EOA"});
    
    const {data:signers}=await sb.from("deal_multisig_signers").select("wallet_address,signature,signature_status").eq("deal_id",dealId).eq("safe_tx_hash",tx.safe_tx_hash).eq("signature_status","signed");
    if(!signers||signers.length<2) return json(409,{ok:false,error:"Signed confirmations are missing"});
    const ownerSet=new Set((owners as string[]).map(norm));
    for(const s of signers){
      if(!ownerSet.has(norm(s.wallet_address))) return json(409,{ok:false,error:"Stored signer is not a current Safe owner"});
    }

    const signatures=packSignatures(signers);
    if((signatures.length-2)/2 !== 65*signers.length) return json(409,{ok:false,error:"Malformed packed signatures"});

    const recomputed=await safe.getTransactionHash(
      ethers.getAddress(tx.to_address),BigInt(tx.value_wei||0),String(tx.data||"0x"),Number(tx.operation),
      BigInt(tx.safe_tx_gas||0),BigInt(tx.base_gas||0),BigInt(tx.gas_price||0),
      ethers.getAddress(tx.gas_token||ZERO),ethers.getAddress(tx.refund_receiver||ZERO),BigInt(tx.safe_nonce)
    );
    if(String(recomputed).toLowerCase()!==String(tx.safe_tx_hash).toLowerCase())
      return json(409,{ok:false,error:"Safe transaction hash mismatch"});

    const executorBalance=await provider.getBalance(EXECUTOR);
    const result:any={
      ok:true,mode,transaction_sent:false,deal_id:dealId,safe:safeAddress,
      executor:EXECUTOR,executor_is_eoa:true,executor_bnb:ethers.formatEther(executorBalance),
      safe_tx_hash:String(tx.safe_tx_hash),nonce:Number(tx.safe_nonce),
      confirmations:Number(tx.confirmations_count),required_signatures:2
    };

    const privateKey=Deno.env.get("EXECUTOR_PRIVATE_KEY")||"";
    if(mode==="check"){
      result.executor_key_configured=Boolean(privateKey);
      if(!privateKey){
        result.key_status="missing";
        result.ready=false;
        result.next="configure EXECUTOR_PRIVATE_KEY";
        return json(200,result);
      }
      try{
        const probe=new ethers.Wallet(privateKey);
        const derived=await probe.getAddress();
        result.derived_executor=derived;
        result.key_status=norm(derived)===norm(EXECUTOR) ? "valid_and_matches_executor" : "valid_but_address_mismatch";
      }catch(e){
        result.key_status="invalid";
        result.key_error=String(e?.message||e);
      }
      result.ready=result.key_status==="valid_and_matches_executor" && executorBalance>0n;
      result.next=result.key_status!=="valid_and_matches_executor" ? "fix EXECUTOR_PRIVATE_KEY" : (executorBalance>0n ? "execute" : "fund executor with BNB for gas");
      return json(200,result);
    }

    if(!privateKey) return json(503,{ok:false,transaction_sent:false,error:"EXECUTOR_PRIVATE_KEY is not configured",executor:EXECUTOR,executor_is_eoa:true,executor_bnb:ethers.formatEther(executorBalance),safe_tx_hash:String(tx.safe_tx_hash)});
    let wallet:ethers.Wallet;
    try{ wallet=new ethers.Wallet(privateKey,provider); }catch(e){
      return json(500,{ok:false,transaction_sent:false,error:"EXECUTOR_PRIVATE_KEY is invalid",key_status:"invalid",key_error:String(e?.message||e)});
    }
    const derivedExecutor=await wallet.getAddress();
    if(norm(derivedExecutor)!==norm(EXECUTOR))
      return json(500,{ok:false,transaction_sent:false,error:"Executor private key does not match configured executor address",key_status:"valid_but_address_mismatch",derived_executor:derivedExecutor,executor:EXECUTOR});
    if(executorBalance===0n)
      return json(409,{ok:false,transaction_sent:false,error:"Executor has no BNB for gas",key_status:"valid_and_matches_executor",executor:EXECUTOR,executor_bnb:"0"});
    if(executorBalance===0n) return json(409,{ok:false,transaction_sent:false,error:"Executor has no BNB for gas",executor:EXECUTOR});

    const args=[
      ethers.getAddress(tx.to_address),BigInt(tx.value_wei||0),String(tx.data||"0x"),Number(tx.operation),
      BigInt(tx.safe_tx_gas||0),BigInt(tx.base_gas||0),BigInt(tx.gas_price||0),
      ethers.getAddress(tx.gas_token||ZERO),ethers.getAddress(tx.refund_receiver||ZERO),signatures
    ] as const;

    const gasEstimate=await safe.connect(wallet).execTransaction.estimateGas(...args);
    const gasLimit=(gasEstimate*130n)/100n;
    const feeData=await provider.getFeeData();
    const maxFee=feeData.maxFeePerGas??feeData.gasPrice;
    if(!maxFee) return json(503,{ok:false,transaction_sent:false,error:"Could not determine BSC gas price"});
    const required=gasLimit*maxFee;
    if(executorBalance<required) return json(409,{ok:false,transaction_sent:false,error:"Executor BNB balance is insufficient for estimated gas",executor_bnb:ethers.formatEther(executorBalance),estimated_gas:gasEstimate.toString(),required_bnb:ethers.formatEther(required)});

    const {data:claimRows,error:claimError}=await sb.rpc("w3m_claim_safe_release",{
      p_deal_id:dealId,p_safe_tx_hash:String(tx.safe_tx_hash),p_safe_nonce:Number(tx.safe_nonce)
    });
    const claim=Array.isArray(claimRows)?claimRows[0]:claimRows;
    if(claimError||!claim){
      return json(409,{...result,transaction_sent:false,error:"Could not acquire the durable W3M V1 Safe release claim; no new transaction was sent",code:"SAFE_RELEASE_CLAIM_UNAVAILABLE"});
    }
    if(claim.created!==true){
      return json(409,{...result,transaction_sent:false,previous_attempt_may_have_broadcast:claim.claim_status==="claimed",
        tx_hash:claim.transaction_hash||null,claim_status:claim.claim_status,
        error:"A release claim already exists. Web3Market will not broadcast the same Safe release again; reconcile the existing attempt first",
        code:"SAFE_RELEASE_CLAIM_ALREADY_EXISTS"});
    }

    releaseBroadcastAttempted=true;
    const sent=await safe.connect(wallet).execTransaction(...args,{gasLimit,maxFeePerGas:feeData.maxFeePerGas??undefined,maxPriorityFeePerGas:feeData.maxPriorityFeePerGas??undefined});
    const transactionHash=String(sent.hash);
    const {error:claimSubmitError}=await sb.rpc("w3m_mark_safe_release_submitted",{
      p_deal_id:dealId,p_safe_tx_hash:String(tx.safe_tx_hash),p_safe_nonce:Number(tx.safe_nonce),p_transaction_hash:transactionHash
    });
    if(claimSubmitError){
      return json(500,{...result,transaction_sent:true,tx_hash:transactionHash,error:"Safe transaction was broadcast but its durable claim could not be updated; do not retry",code:"SAFE_RELEASE_CLAIM_SUBMISSION_FAILED"});
    }

    const receipt=await sent.wait();
    if(!receipt){
      return json(409,{...result,transaction_sent:true,tx_hash:transactionHash,receipt_status:null,error:"Safe transaction was broadcast; its receipt is not available yet. The release claim remains active"});
    }
    if(receipt.status===0){
      const {error:claimFailError}=await sb.rpc("w3m_mark_safe_release_failed",{
        p_deal_id:dealId,p_safe_tx_hash:String(tx.safe_tx_hash),p_safe_nonce:Number(tx.safe_nonce),
        p_transaction_hash:transactionHash,p_failure_code:"evm_revert"
      });
      if(claimFailError){
        return json(500,{...result,transaction_sent:true,tx_hash:transactionHash,receipt_status:0,error:"EVM revert is confirmed but the claim could not be closed; dispute and release remain blocked"});
      }
      return json(409,{...result,transaction_sent:true,tx_hash:transactionHash,receipt_status:0,error:"Safe execution transaction reverted; the claim was closed after the confirmed chain receipt"});
    }
    if(receipt.status!==1){
      return json(409,{...result,transaction_sent:true,tx_hash:transactionHash,receipt_status:receipt.status??null,error:"Safe transaction outcome is not confirmed; the release claim remains active"});
    }

    const {error:txUpdateError}=await sb.from("deal_multisig_transactions").update({
      tx_hash:transactionHash,status:"submitted",updated_at:new Date().toISOString()
    }).eq("id",tx.id);
    if(txUpdateError){
      return json(500,{...result,transaction_sent:true,tx_hash:transactionHash,receipt_status:1,error:"Safe transaction is mined but the multisig record update failed; the release claim remains active"});
    }

    return json(200,{...result,transaction_sent:true,tx_hash:transactionHash,receipt_status:1,gas_used:receipt.gasUsed?.toString()??null});
  }catch(e){
    return json(500,{ok:false,transaction_sent:releaseBroadcastAttempted,
      error:releaseBroadcastAttempted?"Safe broadcast result is uncertain; the durable release claim remains active and must be reconciled before retry":"Safe execution failed",
      code:releaseBroadcastAttempted?"SAFE_RELEASE_RESULT_UNCERTAIN":"SAFE_EXECUTION_FAILED",detail:String(e?.message||e)});
  }
});