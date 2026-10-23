import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ethers } from "npm:ethers@6.15.0";

const RPC_URL = "https://bsc-rpc.publicnode.com";
const CHAIN_ID = 56;
const ZERO = ethers.ZeroAddress;
const MULTISEND_CALL_ONLY = "0x9641d764fc13c8B624c04430C7356C1C7C8102e2";
const USDT = "0x55d398326f99059ff775485246999027b3197955";
const PLATFORM = "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9";
const ERC20 = new ethers.Interface(["function transfer(address to,uint256 amount) returns (bool)"]);
const MULTISEND = new ethers.Interface(["function multiSend(bytes transactions)"]);
const SAFE = new ethers.Interface(["function getOwners() view returns (address[])","function getThreshold() view returns (uint256)","function nonce() view returns (uint256)","function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)","function VERSION() view returns (string)"]);

const cors={"Access-Control-Allow-Origin":"https://web3market.xyz","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
function json(status:number, body:unknown){return new Response(JSON.stringify(body),{status,headers:{...cors,"content-type":"application/json"}})}
function norm(a:string){return ethers.getAddress(a).toLowerCase()}
function packCall(to:string,data:string,value=0n){
  const bytes = ethers.getBytes(data);
  const header = ethers.toBeHex(0, 1).slice(2) + ethers.getAddress(to).slice(2).toLowerCase() +
    ethers.zeroPadValue(ethers.toBeHex(value), 32).slice(2) +
    ethers.zeroPadValue(ethers.toBeHex(bytes.length), 32).slice(2);
  return "0x" + header + data.slice(2);
}
function packedLength(data:string){ return (data.length - 2) / 2; }
function isValidPackedMultiSend(data:string){
  try{
    const body = ethers.AbiCoder.defaultAbiCoder().decode(["bytes"], "0x" + data.slice(10))[0] as string;
    const hex=body.slice(2); let p=0;
    while(p<hex.length){
      if(p+170>hex.length) return false;
      const dl=Number(BigInt("0x"+hex.slice(p+106,p+170)));
      if(!Number.isSafeInteger(dl)) return false;
      const end=p+170+dl*2;
      if(end>hex.length) return false;
      p=end;
    }
    return p===hex.length;
  }catch{return false;}
}

Deno.serve(async (req)=>{
  let stage="request";
  try{
    if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
    if(req.method!=="POST") return json(405,{ok:false,error:"POST required"});
    stage="auth";
    const auth=req.headers.get("authorization")||"";
    const token=auth.replace(/^Bearer\s+/i,"").trim();
    if(!token) return json(401,{ok:false,error:"Missing authorization token"});
    const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const {data:userData,error:userError}=await supabase.auth.getUser(token);
    if(userError||!userData.user) return json(401,{ok:false,error:"Invalid session"});
    const body=await req.json();
    const dealId=String(body.deal_id||"").trim();
    if(!/^[0-9a-f-]{36}$/i.test(dealId)) return json(400,{ok:false,error:"Invalid deal_id"});

    stage="deal_lookup";
    const {data:deal,error:dealError}=await supabase.from("deals").select("*").eq("id",dealId).maybeSingle();
    if(dealError||!deal) return json(404,{ok:false,error:"Deal not found"});
    const {data:activeDispute,error:disputeError}=await supabase.from("deal_disputes").select("id,status").eq("deal_id",dealId).in("status",["open","under_review"]).maybeSingle();
    if(disputeError) return json(503,{ok:false,error:"Could not verify dispute status; release blocked"});
    if(activeDispute||["open","under_review"].includes(String(deal.dispute_status||"").toLowerCase())) return json(409,{ok:false,error:"Release blocked while a dispute is open"});
    const uid=userData.user.id;
    if(deal.buyer_id!==uid && deal.seller_id!==uid) return json(403,{ok:false,error:"Not a deal participant"});

    stage="policy_lookup";
    const {data:policy,error:policyError}=await supabase.from("deal_release_policies").select("*").eq("deal_id",dealId).maybeSingle();
    if(policyError||!policy) return json(409,{ok:false,error:"Release policy not found"});
    if(String(policy.status||"").toLowerCase()!=="locked") return json(409,{ok:false,error:"Release policy is not locked"});
    if(String(deal.delivery_status||"").toLowerCase()!=="accepted" || !deal.buyer_approved_at) return json(409,{ok:false,error:"Delivery is not accepted"});
    if(String(deal.payment_status||"").toLowerCase()!=="confirmed" || !deal.payment_tx_hash) return json(409,{ok:false,error:"Payment is not confirmed"});
    if(norm(policy.safe_address)!==norm(deal.safe_address)) return json(409,{ok:false,error:"Safe mismatch"});
    if(norm(policy.token_contract)!==norm(USDT)) return json(409,{ok:false,error:"Token mismatch"});
    if(Number(policy.chain_id)!==CHAIN_ID) return json(409,{ok:false,error:"Chain mismatch"});

    const {data:existing}=await supabase.from("deal_multisig_transactions").select("*").eq("deal_id",dealId).eq("action","release_to_seller").maybeSingle();
    if(!existing) return json(409,{ok:false,error:"Prepared release transaction is missing"});
    if(existing.safe_tx_hash && existing.data && isValidPackedMultiSend(existing.data) && norm(existing.to_address||"")===norm(MULTISEND_CALL_ONLY) && Number(existing.operation)===1)
      return json(200,{ok:true,already_prepared:true,transaction:existing});
    if(existing.safe_tx_hash && (["submitted","confirmed"].includes(String(existing.status)) || Boolean(existing.tx_hash))){
      return json(409,{ok:false,error:"This release transaction may already have been submitted or confirmed; automatic rebuilding is blocked to protect the existing transaction. Reconcile its on-chain status first."});
    }
    if(existing.safe_tx_hash){
      const oldHash=String(existing.safe_tx_hash);
      await supabase.from("deal_multisig_transactions").update({safe_tx_hash:null,signatures:[],confirmations_count:0,status:"rebuilding",updated_at:new Date().toISOString()}).eq("id",existing.id);
      await supabase.from("deal_multisig_signers").delete().eq("deal_id",dealId).eq("safe_tx_hash",oldHash);
    }

    stage="safe_rpc_init";
    const provider=new ethers.JsonRpcProvider(RPC_URL,CHAIN_ID,{staticNetwork:true});
    const safeAddress=ethers.getAddress(policy.safe_address);
    const safe=new ethers.Contract(safeAddress,SAFE,provider);
    stage="safe_read";
    const [owners,threshold,nonce,safeVersion]=await Promise.all([safe.getOwners(),safe.getThreshold(),safe.nonce(),safe.VERSION()]);

    stage="profile_lookup";
    const {data:profiles}=await supabase.from("profiles").select("id,wallet_address,wallet_verified").in("id",[deal.buyer_id,deal.seller_id]);
    const buyerProfile=profiles?.find((p:any)=>p.id===deal.buyer_id);
    const sellerProfile=profiles?.find((p:any)=>p.id===deal.seller_id);
    if(!buyerProfile?.wallet_verified||!sellerProfile?.wallet_verified) return json(409,{ok:false,error:"Buyer and seller wallets must be verified"});
    const expectedOwners=[norm(buyerProfile.wallet_address),norm(sellerProfile.wallet_address),norm(PLATFORM)];
    const actualOwners=(owners as string[]).map(norm);
    if(Number(threshold)!==2) return json(409,{ok:false,error:"Safe threshold is not 2"});
    if(String(safeVersion)!=="1.4.1") return json(409,{ok:false,error:"Safe version is not 1.4.1",safe_version:String(safeVersion)});
    if(expectedOwners.some(a=>!actualOwners.includes(a)) || actualOwners.length!==3) return json(409,{ok:false,error:"Safe owners do not match the configured buyer/seller/platform wallets"});

    const seller=ethers.getAddress(policy.seller_wallet);
    const platform=ethers.getAddress(policy.platform_wallet);
    if(norm(seller)!==norm(sellerProfile.wallet_address) || norm(platform)!==norm(PLATFORM)) return json(409,{ok:false,error:"Release recipients do not match verified policy"});
    const sellerAmount=ethers.parseUnits(String(policy.seller_net_amount),18);
    const feeAmount=ethers.parseUnits(String(policy.fee_amount),18);
    const total=sellerAmount + feeAmount;
    const expectedTotal=ethers.parseUnits(String(policy.deal_amount),18);
    if(total!==expectedTotal) return json(409,{ok:false,error:"Seller net plus platform fee does not equal deal amount"});

    stage="build_safe_tx";
    const sellerData=ERC20.encodeFunctionData("transfer",[seller,sellerAmount]);
    const feeData=ERC20.encodeFunctionData("transfer",[platform,feeAmount]);
    const packed=packCall(USDT,sellerData)+packCall(USDT,feeData).slice(2);
    if(packedLength(packed)!==306) return json(500,{ok:false,error:"Internal MultiSend packing length check failed"});
    const batchData=MULTISEND.encodeFunctionData("multiSend",[packed]);
    // MultiSendCallOnly must be invoked by the Safe with DELEGATECALL (1).
// Its inner CALLs then execute in the Safe storage/address context, so the USDT
// transfers use the Safe as msg.sender. A normal CALL (0) makes MultiSendCallOnly
// the token sender and the Safe's USDT balance cannot be spent.
const operation=1;
    const safeTxHash=await safe.getTransactionHash(MULTISEND_CALL_ONLY,0n,batchData,1,0n,0n,0n,ZERO,ZERO,nonce);

    const update={safe_tx_hash:safeTxHash,to_address:MULTISEND_CALL_ONLY,data:batchData,value_wei:0,operation,safe_tx_gas:0,base_gas:0,gas_price:0,gas_token:ZERO,refund_receiver:ZERO,safe_nonce:Number(nonce),signatures:[],confirmations_count:0,status:"awaiting_signatures",updated_at:new Date().toISOString()};
    stage="db_store";
    const {data:updated,error:updateError}=await supabase.from("deal_multisig_transactions").update(update).eq("id",existing.id).select("*").single();
    if(updateError) return json(500,{ok:false,error:"Failed to store Safe transaction",detail:updateError.message});
    const {error:policyNonceError}=await supabase.from("deal_release_policies").update({safe_nonce:Number(nonce)}).eq("id",policy.id);
    if(policyNonceError)return json(500,{ok:false,error:"Safe transaction was prepared but release-policy nonce could not be saved",detail:policyNonceError.message});

    return json(200,{ok:true,prepared:true,multisend_operation:"DELEGATECALL",safe_version:safeVersion,safe_address:safeAddress,owners,threshold:Number(threshold),nonce:Number(nonce),safe_tx_hash:safeTxHash,to:MULTISEND_CALL_ONLY,data:batchData,operation,seller_amount:String(policy.seller_net_amount),platform_fee:String(policy.fee_amount),seller_wallet:seller,platform_wallet:platform,token_contract:USDT,transaction:updated});
  }catch(e){ return json(500,{ok:false,error:"Safe preparation failed",stage,detail:String(e?.message||e)}); }
});