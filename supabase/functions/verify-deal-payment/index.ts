import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildFreshBnbDealPaymentContext } from "../w3m-acquisition-verification/fresh-bnb-deal-payment-context.ts";
import { verifyBnbDealPaymentReceipt } from "../w3m-acquisition-verification/bnb-deal-payment-receipt-verifier.ts";
import { finalizeVerifiedDealPayment } from "../w3m-acquisition-verification/deal-payment-finalization-rpc-adapter.ts";
const cors={"Access-Control-Allow-Origin":"https://web3market.xyz","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const TRANSFER_TOPIC="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";const DECIMALS_SELECTOR="0x313ce567";const GET_OWNERS="0xa0e67e2b";const GET_THRESHOLD="0xe75235b8";const NONCE="0xaffed0e0";const PLATFORM_WALLET="0x2B15cC63eE3b833F502C065767695Fa2B584f8c9";const clean=(v:string)=>v.toLowerCase().replace(/^0x/,"");const padAddress=(v:string)=>clean(v).padStart(64,"0");const hexToBigInt=(v:string)=>BigInt(v||"0x0");
function decimalToBaseUnits(value:string,decimals:number){const s=String(value).trim();if(!/^\d+(\.\d+)?$/.test(s))throw new Error("Invalid expected amount");const [whole,frac=""]=s.split(".");if(frac.length>decimals)throw new Error("Expected amount has more decimal places than token supports");return BigInt(whole)*(10n**BigInt(decimals))+BigInt((frac+"0".repeat(decimals)).slice(0,decimals)||"0");}
async function rpc(rpcUrl:string,method:string,params:unknown[]){const r=await fetch(rpcUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});if(!r.ok)throw new Error(`RPC HTTP ${r.status}`);const j=await r.json();if(j.error)throw new Error(j.error.message||"RPC error");return j.result;}
function decodeOwners(raw:string){const h=clean(raw);if(h.length<128)return [];const offset=Number(BigInt("0x"+h.slice(0,64)));const start=offset*2;const len=Number(BigInt("0x"+h.slice(start,start+64)));const owners:string[]=[];for(let i=0;i<len;i++){const x=h.slice(start+64+i*64,start+64+(i+1)*64);if(x.length<64)break;owners.push("0x"+x.slice(24).toLowerCase());}return owners;}

async function scanTransferLogs(rpcUrls:string[],token:string,buyer:string,safe:string,expected:bigint,start:number,end:number){
 const out:string[]=[]; let lastError="";
 const steps=[20,10,5,1];
 for(const u of rpcUrls){
  for(const step of steps){
   try{
    let cursor=start;
    while(cursor<=end){
     const to=Math.min(end,cursor+step-1);
     const logs=await rpc(u,"eth_getLogs",[{
      fromBlock:"0x"+cursor.toString(16),toBlock:"0x"+to.toString(16),
      address:token,topics:[TRANSFER_TOPIC,"0x"+padAddress(buyer),"0x"+padAddress(safe)]
     }]);
     for(const log of Array.isArray(logs)?logs:[]){
      if(hexToBigInt(log.data||"0x0")===expected&&/^0x[0-9a-fA-F]{64}$/.test(String(log.transactionHash||"")))out.push(String(log.transactionHash));
     }
     cursor=to+1;
    }
    return [...new Set(out)];
   }catch(e){
    lastError=e instanceof Error?e.message:String(e);
    if(!/limit|too many|range|timeout|rate|429|response size|result set/i.test(lastError))break;
   }
  }
 }
 throw new Error("BSC RPC unavailable for scan window: "+lastError);
}
async function verifySafe(rpcUrl:string,safe:string,buyer:string,seller:string){const code=await rpc(rpcUrl,"eth_getCode",[safe,"latest"]);if(!code||code==="0x")throw new Error("Configured Safe address has no contract code on BNB Smart Chain");const ownersRaw=await rpc(rpcUrl,"eth_call",[{to:safe,data:GET_OWNERS},"latest"]);const threshold=Number(hexToBigInt(await rpc(rpcUrl,"eth_call",[{to:safe,data:GET_THRESHOLD},"latest"])));const nonce=hexToBigInt(await rpc(rpcUrl,"eth_call",[{to:safe,data:NONCE},"latest"]));const owners=decodeOwners(String(ownersRaw));const expected=[buyer,seller,PLATFORM_WALLET].map(x=>x.toLowerCase());const unique=new Set(owners);if(owners.length!==3||unique.size!==3||threshold!==2)return {valid:false,owners,threshold,nonce:nonce.toString()};if(!expected.every(x=>unique.has(x)))return {valid:false,owners,threshold,nonce:nonce.toString()};return {valid:true,owners,threshold,nonce:nonce.toString()};}
Deno.serve(async(req)=>{if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return json({error:"Method not allowed"},405);try{const auth=req.headers.get("Authorization")||"";if(!auth.startsWith("Bearer "))return json({error:"Unauthorized"},401);const url=Deno.env.get("SUPABASE_URL")!;const anon=Deno.env.get("SUPABASE_ANON_KEY")!;const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;const userDb=createClient(url,anon,{global:{headers:{Authorization:auth}}});const {data:{user},error:authError}=await userDb.auth.getUser();if(authError||!user)return json({error:"Unauthorized"},401);const body=await req.json();const dealId=String(body.deal_id||"");let txHash=String(body.tx_hash||"").trim();if(!dealId)return json({error:"Invalid deal_id"},400);if(txHash&&!/^0x[0-9a-fA-F]{64}$/.test(txHash))return json({error:"Invalid tx_hash"},400);const admin=createClient(url,service);const {data:deal,error:dealError}=await admin.from("deals").select("id,buyer_id,seller_id,amount,currency,status,chain_id,safe_address,safe_deployment_tx_hash,token_contract,token_symbol,expected_amount,payment_tx_hash,payment_status,platform_fee_percent,payment_scan_from_block,payment_scan_last_block,payment_scan_updated_at").eq("id",dealId).maybeSingle();if(dealError)return json({error:dealError.message},400);if(!deal)return json({error:"Deal not found"},404);if(String(deal.buyer_id)!==String(user.id))return json({error:"Only the buyer can submit a payment transaction for verification"},403);if(!deal.safe_address||Number(deal.chain_id)!==56||!deal.token_contract)return json({error:"Deal payment configuration is incomplete"},409);if(deal.payment_tx_hash&&String(deal.payment_tx_hash).toLowerCase()!==txHash.toLowerCase())return json({error:"A different payment transaction is already recorded for this deal"},409);
const {data:existingTx,error:existingTxError}=await admin.from("blockchain_transactions").select("id,deal_id,status,transaction_type,chain_id").eq("tx_hash",txHash).maybeSingle();if(existingTxError)return json({error:existingTxError.message},400);if(existingTx?.deal_id&&String(existingTx.deal_id)!==String(deal.id))return json({error:"This transaction hash is already bound to another deal"},409);if(existingTx&&existingTx.transaction_type!=="payment")return json({error:"This transaction hash is already recorded for another transaction type"},409);const {data:otherDeal,error:otherDealError}=await admin.from("deals").select("id").neq("id",deal.id).eq("payment_tx_hash",txHash).maybeSingle();if(otherDealError)return json({error:otherDealError.message},400);if(otherDeal)return json({error:"This payment transaction is already recorded for another deal"},409);
const {data:buyer}=await admin.from("profiles").select("wallet_address,wallet_verified").eq("id",deal.buyer_id).maybeSingle();if(!buyer?.wallet_address||buyer.wallet_verified!==true)return json({error:"Buyer wallet must be connected and verified before payment verification"},409);const {data:seller}=await admin.from("profiles").select("wallet_address,wallet_verified").eq("id",deal.seller_id).maybeSingle();if(!seller?.wallet_address||seller.wallet_verified!==true)return json({error:"Seller wallet must be connected and verified before payment verification"},409);
const rpcCandidates=[Deno.env.get("BSC_RPC_URL"),"https://bsc-rpc.publicnode.com","https://bsc-dataseed.binance.org","https://bsc-dataseed1.defibit.io","https://bsc-dataseed1.ninicoin.io"].filter(Boolean) as string[];let rpcUrl="";let lastRpcError="";for(const candidate of rpcCandidates){try{await rpc(candidate,"eth_blockNumber",[]);rpcUrl=candidate;break}catch(e){lastRpcError=e instanceof Error?e.message:String(e)}}if(!rpcUrl)return json({error:"BSC RPC unavailable",detail:lastRpcError},503);const safeCheck=await verifySafe(rpcUrl,String(deal.safe_address),String(buyer.wallet_address),String(seller.wallet_address));if(!safeCheck.valid)return json({error:"Configured Safe does not currently match the required 2-of-3 buyer/seller/platform owner set",safe:safeCheck},409);
if(!txHash)return json({error:"Transaction hash is required. Paste the BSC transaction hash from the buyer payment into Deal Room."},400);
const context=buildFreshBnbDealPaymentContext({actorUserId:user.id,deal,buyer,seller,transactionHash:txHash,minConfirmations:3});
const receiptRpc={async request<T>(method:string,params:unknown[]=[]):Promise<T>{return await rpc(rpcUrl,method,params) as T}};
const verifiedReceipt=await verifyBnbDealPaymentReceipt(receiptRpc,context.expectation);
const finalizationClient={async rpc(functionName:string,args:{p_deal_id:string;p_actor_id:string;p_tx_hash:string;p_verified_receipt:typeof verifiedReceipt}){const {data,error}=await admin.rpc(functionName,args);return {data,error}}};
const finalized=await finalizeVerifiedDealPayment(finalizationClient,{dealId:context.dealId,actorId:user.id,receipt:verifiedReceipt});
return json({ok:true,verified:true,idempotent:finalized.idempotent,deal:{id:context.dealId,status:"funded",payment_tx_hash:verifiedReceipt.transactionHash,payment_status:"confirmed"},received_base_units:verifiedReceipt.amountBaseUnits,expected_base_units:context.expectation.expectedAmountBaseUnits,token_decimals:18,block_number:verifiedReceipt.blockNumber,confirmations:verifiedReceipt.confirmations});
}catch(e){return json({error:e instanceof Error?e.message:String(e)},400)}});