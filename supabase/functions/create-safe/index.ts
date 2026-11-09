import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getW3MDealProtocolTrack } from "../_shared/w3m-deal-protocol-track.ts";
import Safe from "npm:@safe-global/protocol-kit@8.0.7";
import { createPublicClient, createWalletClient, http, getAddress, keccak256, toBytes } from "npm:viem@2.37.6";
import { bsc } from "npm:viem@2.37.6/chains";
import { privateKeyToAccount } from "npm:viem@2.37.6/accounts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { assertW3MAgreementReady, W3MFinalizationGateError } from "../_shared/w3m-v1-finalization-gate.ts";

import { buildW3MSafeConfiguration } from "../_shared/w3m-safe-policy.ts";

const PLATFORM_WALLET="0x2B15cC63eE3b833F502C065767695Fa2B584f8c9";
const BSC_CHAIN_ID=56;
const USDT_BSC="0x55d398326f99059ff775485246999027b3197955";
const cors={"Access-Control-Allow-Origin":"https://web3market.xyz","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Max-Age":"86400","Vary":"Origin"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
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
const norm=(a:string)=>getAddress(a);
const isPrivateKeyFormat=(value:string)=>/^0x[0-9a-fA-F]{64}$/.test(value);

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return json({ok:false,error:"Method not allowed"},405);
 try{
  const authHeader=req.headers.get("Authorization")||"";
  if(!authHeader.startsWith("Bearer "))return json({ok:false,error:"Authorization required"},401);
  const supabaseUrl=Deno.env.get("SUPABASE_URL"),anonKey=Deno.env.get("SUPABASE_ANON_KEY"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!supabaseUrl||!anonKey||!serviceKey)return json({ok:false,error:"Supabase configuration missing"},500);
  const authClient=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:authHeader}}});
  const {data:{user},error:userError}=await authClient.auth.getUser();
  if(userError||!user)return json({ok:false,error:"Invalid session"},401);
  const body=await req.json().catch(()=>({})),dealId=String(body?.deal_id||"");
  if(!dealId)return json({ok:false,error:"deal_id is required"},400);
  const db=createClient(supabaseUrl,serviceKey);
  const {data:deal,error:dealError}=await db.from("deals").select("*").eq("id",dealId).maybeSingle();
  if(dealError)return json({ok:false,error:"Deal lookup failed"},500);
  if(!deal)return json({ok:false,error:"Deal not found"},404);
  const {data:buyer}=await db.from("profiles").select("id,wallet_address,wallet_verified").eq("id",deal.buyer_id).maybeSingle();
  const {data:seller}=await db.from("profiles").select("id,wallet_address,wallet_verified").eq("id",deal.seller_id).maybeSingle();
  const {data:caller}=await db.from("profiles").select("id,role").eq("id",user.id).maybeSingle();
  if(!(caller&&(caller.id===deal.buyer_id||caller.id===deal.seller_id||String(caller.role||"").toLowerCase()==="admin")))return json({ok:false,error:"Not authorized for this deal"},403);
  let protocolTrack: "legacy" | "v1";
  try {
    protocolTrack = await getW3MDealProtocolTrack(db, dealId);
  } catch {
    return json({ok:false,error:"Deal protocol classification is unavailable",usdt_moved:false},503);
  }
  if (protocolTrack === "v1") {
    try {
      await assertW3MAgreementReady(db, dealId);
    } catch (error) {
      return json({ok:false,error:"W3M V1 buyer and seller agreement acceptance is required before Safe deployment",code:error instanceof W3MFinalizationGateError?error.code:"W3M_FINALIZATION_EVIDENCE_UNAVAILABLE",usdt_moved:false},409);
    }
  }
  const disputeState=await checkDisputeState(db,deal,dealId);
  if(disputeState!=="clear")return json({ok:false,error:disputeState==="open"?"Safe deployment is blocked while a dispute is open":"Unable to verify dispute status; Safe deployment blocked",code:disputeState==="open"?"DEAL_DISPUTE_OPEN":"DISPUTE_STATUS_UNAVAILABLE"},409);
  if(String(deal.status)!=="accepted")return json({ok:false,error:"Deal must be accepted before Safe deployment",status:deal.status},409);
  if(Number(deal.chain_id)!==BSC_CHAIN_ID)return json({ok:false,error:"Deal chain must be BNB Smart Chain (56)"},409);
  if(!buyer?.wallet_address||!seller?.wallet_address||buyer.wallet_verified!==true||seller.wallet_verified!==true)return json({ok:false,error:"Buyer and seller wallets must be verified"},409);
  const buyerWallet=norm(buyer.wallet_address),sellerWallet=norm(seller.wallet_address),platformWallet=norm(PLATFORM_WALLET);
  let safeConfig: ReturnType<typeof buildW3MSafeConfiguration>;
  try {
    safeConfig = buildW3MSafeConfiguration({ buyerWallet, sellerWallet, platformWallet });
  } catch (error) {
    return json({ok:false,error:error instanceof Error ? error.message : "Safe owner policy validation failed"},409);
  }
  const pk=Deno.env.get("SAFE_DEPLOYER_PRIVATE_KEY"),rpc=Deno.env.get("BSC_RPC_URL")||Deno.env.get("SAFE_BSC_RPC_URL");
  if(!pk)return json({ok:false,error:"SAFE_DEPLOYER_PRIVATE_KEY is not configured"},500);
  if(!isPrivateKeyFormat(pk))return json({ok:false,error:"SAFE_DEPLOYER_PRIVATE_KEY format invalid",detail:"Expected 0x followed by exactly 64 hexadecimal characters. No transaction was created."},500);
  if(!rpc)return json({ok:false,error:"BSC RPC is not configured"},500);
  const deployer=privateKeyToAccount(pk as `0x${string}`);
  if([buyerWallet,sellerWallet,platformWallet].some(x=>x.toLowerCase()===deployer.address.toLowerCase()))return json({ok:false,error:"Deployer must be separate from all Safe owners"},409);
  const publicClient=createPublicClient({chain:bsc,transport:http(rpc)});
  const walletClient=createWalletClient({account:deployer,chain:bsc,transport:http(rpc)});
  const chainId=await publicClient.getChainId();
  if(chainId!==BSC_CHAIN_ID)return json({ok:false,error:"RPC chain mismatch",expected_chain_id:BSC_CHAIN_ID,actual_chain_id:chainId},502);
  const balance=await publicClient.getBalance({address:deployer.address});
  if(balance===0n)return json({ok:false,error:"Deployer has no BNB for Safe deployment",deployer_wallet:deployer.address,bnb_balance_wei:"0"},409);
  const saltHash=keccak256(toBytes(dealId));
  const saltNonce=(BigInt(saltHash)%1000000000000000000000000000000000000n).toString();
  const predicted=await Safe.init({provider:rpc,signer:pk,predictedSafe:{safeAccountConfig:{owners:safeConfig.owners,threshold:safeConfig.threshold},safeDeploymentConfig:{saltNonce}}});
  const safeAddress=norm(await predicted.getAddress());
  const existingCode=await publicClient.getCode({address:safeAddress});
  let deploymentTxHash:string|null=null;
  const verify=async(kit:any)=>{
   if(!(await kit.isSafeDeployed()))throw new Error("Safe verification failed");
   const owners=(await kit.getOwners()).map(norm).map(a=>a.toLowerCase()).sort();
   const expected=[buyerWallet,sellerWallet,platformWallet].map(a=>a.toLowerCase()).sort();
   const threshold=await kit.getThreshold();
   if(String(threshold)!==String(safeConfig.threshold)||JSON.stringify(owners)!==JSON.stringify(expected))throw new Error("Safe owners/threshold verification failed");
  };
  if(existingCode&&existingCode!=="0x"){
   const connected=await predicted.connect({safeAddress});await verify(connected);
  }else{
   const deploymentTx=await predicted.createSafeDeploymentTransaction();
   const txHash=await walletClient.sendTransaction({to:deploymentTx.to as `0x${string}`,value:BigInt(deploymentTx.value),data:deploymentTx.data as `0x${string}`});
   deploymentTxHash=txHash;
   const receipt=await publicClient.waitForTransactionReceipt({hash:txHash});
   if(receipt.status!=="success")return json({ok:false,error:"Safe deployment transaction failed",deployment_tx_hash:txHash,safe_address:safeAddress},502);
   const connected=await predicted.connect({safeAddress});await verify(connected);
  }
  const now=new Date().toISOString();
  const {error:updateError}=await db.from("deals").update({safe_address:safeAddress,safe_deployment_tx_hash:deploymentTxHash??deal.safe_deployment_tx_hash??null,safe_deployer_wallet:deployer.address,safe_deployed_at:deal.safe_deployed_at??now,safe_deployment_status:"deployed",payment_status:"pending"}).eq("id",dealId);
  if(updateError)return json({ok:false,error:"Safe deployed but deal update failed",safe_address:safeAddress,deployment_tx_hash:deploymentTxHash,detail:updateError.message},500);
  const feePercent=Number(deal.platform_fee_percent??7.5),amount=Number(deal.expected_amount??deal.amount??0),fee=Number(deal.platform_fee_amount??deal.platform_fee??amount*feePercent/100),sellerNet=Number(deal.seller_net_amount??amount-fee);
  const {error:policyError}=await db.from("deal_release_policies").upsert({deal_id:dealId,deal_amount:amount,fee_percent:feePercent,fee_amount:fee,seller_net_amount:sellerNet,seller_wallet:sellerWallet,platform_wallet:platformWallet,safe_address:safeAddress,token_contract:deal.token_contract||USDT_BSC,token_symbol:deal.token_symbol||"USDT",chain_id:BSC_CHAIN_ID,status:"pending"},{onConflict:"deal_id"});
  if(policyError)return json({ok:false,error:"Safe deployed but release policy update failed",safe_address:safeAddress,deployment_tx_hash:deploymentTxHash,detail:policyError.message},500);
  return json({ok:true,stage:"safe_deployed_and_verified",deal_id:dealId,safe_address:safeAddress,salt_nonce:saltNonce,owners:safeConfig.owners,threshold:safeConfig.threshold,owner_roles:safeConfig.ownerRoles,deployer_wallet:deployer.address,deployment_tx_hash:deploymentTxHash,bnb_balance_wei:balance.toString(),payment_status:"pending",usdt_moved:false});
 }catch(e){return json({ok:false,error:"Safe deployment failed",stage:"exception",detail:e instanceof Error?e.message:String(e),error_name:e instanceof Error?e.name:"UnknownError",stack:e instanceof Error?e.stack?.slice(0,1200):undefined,usdt_moved:false},500);}
});