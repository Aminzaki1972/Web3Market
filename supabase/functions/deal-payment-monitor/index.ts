import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildFreshBnbDealPaymentContext } from "../w3m-acquisition-verification/fresh-bnb-deal-payment-context.ts";
import { verifyBnbDealPaymentReceipt } from "../w3m-acquisition-verification/bnb-deal-payment-receipt-verifier.ts";
import { finalizeVerifiedDealPayment } from "../w3m-acquisition-verification/deal-payment-finalization-rpc-adapter.ts";

const TRANSFER="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const DECIMALS="0x313ce567";
const OWNERS="0xa0e67e2b";
const THRESHOLD="0xe75235b8";
const PLATFORM="0x2B15cC63eE3b833F502C065767695Fa2B584f8c9";
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"Content-Type":"application/json"}});
const bi=(x:string)=>BigInt(x||"0x0");
const topic=(a:string)=>"0x"+a.toLowerCase().replace(/^0x/,"").padStart(64,"0");
const units=(v:string,d:number)=>{const [w,f=""]=String(v).trim().split(".");if(!/^\d+$/.test(w)||!/^\d*$/.test(f)||f.length>d)throw Error("Invalid expected amount");return BigInt(w)*(10n**BigInt(d))+BigInt((f+"0".repeat(d)).slice(0,d)||"0")};
async function rpc(u:string,m:string,p:unknown[]){const r=await fetch(u,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:m,params:p})});if(!r.ok)throw Error("RPC HTTP "+r.status);const j=await r.json();if(j.error)throw Error(j.error.message||"RPC error");return j.result}
function rpcCandidates(){const raw=[Deno.env.get("BSC_RPC_URLS"),Deno.env.get("BSC_RPC_URL"),"https://bsc-rpc.publicnode.com","https://bsc-dataseed.binance.org","https://bsc.publicnode.com"].filter(Boolean).join(",");return [...new Set(raw.split(",").map(x=>x.trim()).filter(Boolean))]}
async function providers(){const ok:string[]=[];for(const u of rpcCandidates()){try{const chain=bi(await rpc(u,"eth_chainId",[]));if(chain!==56n)continue;await rpc(u,"eth_blockNumber",[]);ok.push(u)}catch{}}if(!ok.length)throw Error("No BNB Chain (56) RPC provider available");return ok}
function ownerList(raw:string){const h=raw.replace(/^0x/,"");if(h.length<128)return[];const off=Number(bi("0x"+h.slice(0,64)))*2,n=Number(bi("0x"+h.slice(off,off+64)));return Array.from({length:n},(_,i)=>"0x"+h.slice(off+64+i*64+24,off+64+(i+1)*64)).filter(x=>x.length===42).map(x=>x.toLowerCase())}
async function safeCheck(p:string,safe:string,buyer:string,seller:string){const code=await rpc(p,"eth_getCode",[safe,"latest"]);if(!code||code==="0x")throw Error("Safe contract missing");const os=ownerList(String(await rpc(p,"eth_call",[{to:safe,data:OWNERS},"latest"])));const th=Number(bi(await rpc(p,"eth_call",[{to:safe,data:THRESHOLD},"latest"])));const set=new Set(os);if(os.length!==3||set.size!==3||th!==2||![buyer,seller,PLATFORM].every(x=>set.has(x.toLowerCase())))throw Error("Safe owner/threshold mismatch")}

async function sleep(ms:number){await new Promise(r=>setTimeout(r,ms))}
async function scanTransferLogs(rpcUrls:string[],token:string,buyer:string,safe:string,expected:bigint,start:number,end:number){
 const out:string[]=[];
 let lastError="";
 for(const u of rpcUrls){
  // Keep requests small and paced. The previous implementation restarted the
  // entire window at 20/10/5/1 blocks after a limit error, causing a burst of
  // duplicate RPC calls and making rate limiting worse.
  let cursor=start;
  while(cursor<=end){
   const to=Math.min(end,cursor+4);
   let ok=false;
   for(let attempt=0;attempt<4;attempt++){
    try{
     const logs=await rpc(u,"eth_getLogs",[{
      fromBlock:"0x"+cursor.toString(16),toBlock:"0x"+to.toString(16),
      address:token,topics:[TRANSFER,topic(buyer),topic(safe)]
     }]);
     for(const l of Array.isArray(logs)?logs:[]){
      if(bi(l.data||"0x0")===expected&&/^0x[0-9a-fA-F]{64}$/.test(String(l.transactionHash||"")))out.push(String(l.transactionHash));
     }
     ok=true;
     break;
    }catch(e){
     lastError=e instanceof Error?e.message:String(e);
     if(!/limit|too many|range|timeout|rate|429|response size|result set/i.test(lastError))break;
     await sleep(500*(2**attempt));
    }
   }
   if(!ok){
    // Abandon only this provider and continue with the next provider.
    break;
   }
   cursor=to+1;
   await sleep(120);
  }
  if(cursor>end)return [...new Set(out)];
 }
 throw Error("BSC RPC unavailable for scan window: "+lastError+"; tried "+rpcUrls.length+" RPC endpoints");
}
Deno.serve(async req=>{
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  const url=Deno.env.get("SUPABASE_URL")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,db=createClient(url,service);
  const secret=req.headers.get("x-monitor-secret")||"";const {data:authorized}=await db.rpc("deal_payment_monitor_authorized",{candidate:secret});if(authorized!==true)return json({error:"Unauthorized"},401);
  const rpcUrls=await providers();let p=rpcUrls[0];const latest=Number(bi(await rpc(p,"eth_blockNumber",[])));
  const {data:deals,error}=await db.from("deals").select("id,buyer_id,seller_id,amount,currency,status,chain_id,safe_address,safe_deployment_tx_hash,token_contract,token_symbol,expected_amount,payment_status,payment_tx_hash,platform_fee_percent,payment_scan_last_block").in("status",["accepted","pending","in_progress"]).eq("payment_status","pending").is("payment_tx_hash",null).eq("chain_id",56).not("safe_address","is",null).not("token_contract","is",null).limit(10);
  if(error)throw error; const results=[];
  for(const d of deals||[])try{
   const {data:b}=await db.from("profiles").select("wallet_address,wallet_verified").eq("id",d.buyer_id).maybeSingle();
   const {data:s}=await db.from("profiles").select("wallet_address,wallet_verified").eq("id",d.seller_id).maybeSingle();
   if(!b?.wallet_address||b.wallet_verified!==true||!s?.wallet_address||s.wallet_verified!==true){results.push({deal_id:d.id,skipped:"wallet_not_verified"});continue}
   await safeCheck(p,d.safe_address,b.wallet_address,s.wallet_address);
   if(String(d.token_contract||"").toLowerCase()!=="0x55d398326f99059ff775485246999027b3197955")throw Error("Deal token is not the approved BNB USDT contract");\n   const dec=18,expected=units(String(d.expected_amount??d.amount),dec);
   const dep=String(d.safe_deployment_tx_hash||"");const dr=await rpc(p,"eth_getTransactionReceipt",[dep]);const depBlock=dr?.blockNumber?Number(bi(dr.blockNumber)):latest-10000;
   const cursor=d.payment_scan_last_block==null?depBlock:Number(d.payment_scan_last_block);
   const from=Math.max(depBlock,cursor+1),to=Math.min(latest,from+199);
   const found=await scanTransferLogs(rpcUrls,d.token_contract,b.wallet_address,d.safe_address,expected,from,to);
   if(!found.length){await db.from("deals").update({payment_scan_from_block:depBlock,payment_scan_last_block:to,payment_scan_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",d.id);results.push({deal_id:d.id,found:false,scanned_from:from,scanned_to:to});continue}
   let confirmed=false;
   for(const h of found){
    try{
     const context=buildFreshBnbDealPaymentContext({actorUserId:d.buyer_id,deal:d,buyer:b,seller:s,transactionHash:h,minConfirmations:3});
     const receiptRpc={async request<T>(method:string,params:unknown[]=[]):Promise<T>{return await rpc(p,method,params) as T}};
     const verifiedReceipt=await verifyBnbDealPaymentReceipt(receiptRpc,context.expectation);
     const finalized=await finalizeVerifiedDealPayment({async rpc(functionName,args){const {data,error}=await db.rpc(functionName,args);return {data,error}}},{dealId:context.dealId,actorId:d.buyer_id,receipt:verifiedReceipt});
     confirmed=true;results.push({deal_id:d.id,verified:true,tx_hash:h,confirmations:verifiedReceipt.confirmations,idempotent:finalized.idempotent});break;
    }catch(candidateError){
     results.push({deal_id:d.id,candidate_tx_hash:h,candidate_rejected:candidateError instanceof Error?candidateError.message:String(candidateError)});
    }
   }
   if(!confirmed)results.push({deal_id:d.id,found:true,verified:false,candidates:found.length});
  }catch(e){results.push({deal_id:d.id,error:e instanceof Error?e.message:String(e)})}
  return json({ok:true,latest_block:latest,monitored:(deals||[]).length,results});
 }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});