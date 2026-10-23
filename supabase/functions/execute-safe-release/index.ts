import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ethers } from "npm:ethers@6.15.0";

const RPC = Deno.env.get("BSC_RPC_URL") || "https://bsc-rpc.publicnode.com";
const CHAIN = 56;
const EXECUTOR = "0xCbd947146826aB5BBF9924105E69e9c6F5e9420C";
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

function packSignatures(rows:any[]){
  const sorted=rows.slice().sort((a,b)=>norm(a.wallet_address).localeCompare(norm(b.wallet_address)));
  return "0x"+sorted.map(x=>String(x.signature).replace(/^0x/,"")).join("");
}

Deno.serve(async req=>{
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
    const {data:activeDispute,error:disputeError}=await sb.from("deal_disputes").select("id,status").eq("deal_id",dealId).in("status",["open","under_review"]).maybeSingle();
    if(disputeError) return json(503,{ok:false,error:"Could not verify dispute status; release blocked"});
    if(activeDispute||["open","under_review"].includes(String(deal.dispute_status||"").toLowerCase())) return json(409,{ok:false,error:"Release blocked while a dispute is open"});
    if(deal.buyer_id!==userData.user.id&&deal.seller_id!==userData.user.id)
      return json(403,{ok:false,error:"Not a deal participant"});

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

    const {data:policy}=await sb.from("deal_release_policies").select("*").eq("deal_id",dealId).maybeSingle();
    if(!policy) return json(409,{ok:false,error:"Release policy not found"});

    const provider=new ethers.JsonRpcProvider(RPC,CHAIN,{staticNetwork:true});
    const safeAddress=ethers.getAddress(policy.safe_address);
    const safe=new ethers.Contract(safeAddress,SAFE_ABI,provider);

    const [owners,threshold,nonce,code]=await Promise.all([
      safe.getOwners(),safe.getThreshold(),safe.nonce(),provider.getCode(EXECUTOR)
    ]);
    if(Number(threshold)!==2) return json(409,{ok:false,error:"Safe threshold is not 2"});
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

    const sent=await safe.connect(wallet).execTransaction(...args,{gasLimit,maxFeePerGas:feeData.maxFeePerGas??undefined,maxPriorityFeePerGas:feeData.maxPriorityFeePerGas??undefined});
    const receipt=await sent.wait();
    if(!receipt || receipt.status!==1){
      return json(409,{...result,transaction_sent:true,tx_hash:receipt?.hash||sent.hash,receipt_status:receipt?.status??null,error:"Safe execution transaction was mined but did not succeed; finalization was not recorded"});
    }

    await sb.from("deal_multisig_transactions").update({
      tx_hash:receipt?.hash||sent.hash,status:"submitted",updated_at:new Date().toISOString()
    }).eq("id",tx.id);

    return json(200,{...result,transaction_sent:true,tx_hash:receipt?.hash||sent.hash,receipt_status:receipt?.status??null,gas_used:receipt?.gasUsed?.toString()??null});
  }catch(e){
    return json(500,{ok:false,transaction_sent:false,error:"Safe execution failed",detail:String(e?.message||e)});
  }
});