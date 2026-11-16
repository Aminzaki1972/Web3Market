import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { verifyBnbDealPaymentReceipt, BnbDealPaymentReceiptError } from "./bnb-deal-payment-receipt-verifier.ts";

const BUYER="0x"+"1".repeat(40), SAFE="0x"+"2".repeat(40), TOKEN="0x55d398326f99059ff775485246999027b3197955";
const TX="0x"+"4".repeat(64), BLOCK="0x"+"5".repeat(64);
const topic=(a:string)=>"0x"+a.slice(2).toLowerCase().padStart(64,"0");
const TRANSFER="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const log={address:TOKEN,topics:[TRANSFER,topic(BUYER),topic(SAFE)],data:"0x"+1000n.toString(16).padStart(64,"0"),logIndex:"0x0"};
const expected={transactionHash:TX,buyerWallet:BUYER,safeAddress:SAFE,tokenContract:TOKEN,expectedAmountBaseUnits:"1000",minConfirmations:3};
function mock(overrides:Record<string,unknown>={}) {
 const receipt={transactionHash:TX,status:"0x1",blockHash:BLOCK,blockNumber:"0x64",logs:[log],...(overrides.receipt as object??{})};
 const calls:string[]=[];
 const rpc={async request<T>(method:string):Promise<T>{
  calls.push(method);let v:unknown;
  if(method==="eth_chainId")v=overrides.chainId??"0x38";
  else if(method==="eth_getTransactionByHash")v=overrides.tx??{hash:TX,from:BUYER,to:TOKEN};
  else if(method==="eth_getTransactionReceipt")v=receipt;
  else if(method==="eth_blockNumber")v=overrides.head??"0x70";
  else if(method==="eth_getBlockByNumber")v={hash:overrides.canonicalHash??BLOCK};
  else throw Error("Unexpected RPC "+method);
  return v as T;
 }};
 return {rpc,calls};
}
Deno.test("accepts one exact transfer in a canonical BNB receipt",async()=>{
 const {rpc}=mock();const result=await verifyBnbDealPaymentReceipt(rpc,expected);
 assertEquals(result.chainId,56);assertEquals(result.amountBaseUnits,"1000");assertEquals(result.logIndex,"0");assertEquals(result.confirmations,13);
});
Deno.test("rejects a token other than the pinned BNB USDT contract",async()=>{
 await assertRejects(()=>verifyBnbDealPaymentReceipt(mock().rpc,{...expected,tokenContract:"0x"+"3".repeat(40)}),BnbDealPaymentReceiptError,"expectations are invalid");
});
Deno.test("rejects wrong chain before transaction lookup",async()=>{
 const {rpc,calls}=mock({chainId:"0x1"});
 await assertRejects(()=>verifyBnbDealPaymentReceipt(rpc,expected),BnbDealPaymentReceiptError,"not BNB Chain");
 assertEquals(calls,["eth_chainId"]);
});
Deno.test("rejects mismatched transaction sender and token target",async()=>{
 await assertRejects(()=>verifyBnbDealPaymentReceipt(mock({tx:{hash:TX,from:SAFE,to:TOKEN}}).rpc,expected),BnbDealPaymentReceiptError,"identity");
 await assertRejects(()=>verifyBnbDealPaymentReceipt(mock({tx:{hash:TX,from:BUYER,to:SAFE}}).rpc,expected),BnbDealPaymentReceiptError,"identity");
});
Deno.test("rejects a receipt on a noncanonical block and insufficient confirmations",async()=>{
 await assertRejects(()=>verifyBnbDealPaymentReceipt(mock({canonicalHash:"0x"+"9".repeat(64)}).rpc,expected),BnbDealPaymentReceiptError,"not canonical");
 await assertRejects(()=>verifyBnbDealPaymentReceipt(mock({head:"0x65"}).rpc,expected),BnbDealPaymentReceiptError,"insufficient confirmations");
});
Deno.test("rejects wrong amount, duplicate matching events and removed logs",async()=>{
 await assertRejects(()=>verifyBnbDealPaymentReceipt(mock({receipt:{logs:[{...log,data:"0x"+999n.toString(16).padStart(64,"0")}]}}).rpc,expected),BnbDealPaymentReceiptError,"amount does not match");
 await assertRejects(()=>verifyBnbDealPaymentReceipt(mock({receipt:{logs:[log,{...log,logIndex:"0x1"}]}}).rpc,expected),BnbDealPaymentReceiptError,"exactly one");
 await assertRejects(()=>verifyBnbDealPaymentReceipt(mock({receipt:{logs:[{...log,removed:true}]}}).rpc,expected),BnbDealPaymentReceiptError,"removed or malformed");
});
Deno.test("rejects malformed address topic padding and malformed amount",async()=>{
 const malformed={...log,topics:[TRANSFER,"0x"+"f".repeat(64),topic(SAFE)]};
 await assertRejects(()=>verifyBnbDealPaymentReceipt(mock({receipt:{logs:[malformed]}}).rpc,expected),BnbDealPaymentReceiptError,"sender topic");
 await assertRejects(()=>verifyBnbDealPaymentReceipt(mock({receipt:{logs:[{...log,data:"0x01"}]}}).rpc,expected),BnbDealPaymentReceiptError,"amount is malformed");
});
