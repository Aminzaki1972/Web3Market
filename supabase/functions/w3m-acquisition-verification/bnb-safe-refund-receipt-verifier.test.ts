import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";
import {
  BnbSafeRefundReceiptVerificationError,
  verifyBnbSafeBuyerRefundReceipt,
  type BnbSafeRefundReceiptExpectation,
} from "./bnb-safe-refund-receipt-verifier.ts";

const topic=(s:string)=>"0x"+Array.from(keccak_256(new TextEncoder().encode(s)),b=>b.toString(16).padStart(2,"0")).join("");
const wordAddress=(a:string)=>"0x"+a.slice(2).toLowerCase().padStart(64,"0");
const wordUint=(n:bigint)=>"0x"+n.toString(16).padStart(64,"0");
const SAFE="0x"+"1".repeat(40), TOKEN="0x"+"2".repeat(40), BUYER="0x"+"3".repeat(40), PLATFORM="0x"+"4".repeat(40);
const expected:BnbSafeRefundReceiptExpectation={
  broadcastTxHash:"0x"+"5".repeat(64),safeTxHash:"0x"+"6".repeat(64),safeAddress:SAFE,
  tokenContract:TOKEN,buyerWallet:BUYER,buyerRefundAmount:"92.5",originalDealAmount:"100",platformWallet:PLATFORM,
  platformFeeAmount:"7.5",minConfirmations:6,decisionId:"decision-1",
  decisionHash:"a".repeat(64),termsHash:"b".repeat(64),
};
const success=topic("ExecutionSuccess(bytes32,uint256)"),failure=topic("ExecutionFailure(bytes32,uint256)");
const transfer="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const blockHash="0x"+"c".repeat(64);
const logs=[
 {address:SAFE,topics:[success,expected.safeTxHash],data:wordUint(0n),logIndex:"0x0"},
 {address:TOKEN,topics:[transfer,wordAddress(SAFE),wordAddress(BUYER)],data:wordUint(925n*10n**17n),logIndex:"0x1"},
 {address:TOKEN,topics:[transfer,wordAddress(SAFE),wordAddress(PLATFORM)],data:wordUint(75n*10n**17n),logIndex:"0x2"},
];
function mock(overrides:Record<string,unknown>={}) {
 const receipt={transactionHash:expected.broadcastTxHash,to:SAFE,blockHash,blockNumber:"0x64",status:"0x1",logs,...((overrides.receipt as Record<string,unknown>|undefined)??{})};
 const calls:string[]=[];
 const rpc={async request<T>(method:string):Promise<T>{
   calls.push(method); let value:unknown;
   if(method==="eth_chainId") value=overrides.chainId??"0x38";
   else if(method==="eth_getTransactionReceipt") value=receipt;
   else if(method==="eth_blockNumber") value=overrides.head??"0x70";
   else if(method==="eth_getBlockByNumber") value={hash:overrides.canonicalHash??blockHash,timestamp:"0x6aedc17c"};
   else if(method==="eth_call") value=wordUint(18n);
   else throw new Error("Unexpected RPC "+method);
   return value as T;
 }};
 return {rpc,calls};
}
Deno.test("verifies canonical buyer refund and fixed original-value platform fee",async()=>{
 const {rpc}=mock(); const result=await verifyBnbSafeBuyerRefundReceipt(rpc,expected);
 assertEquals(result.chainId,56);assertEquals(result.executionSuccess,true);
 assertEquals(result.buyerRefundAmount,"92.5");assertEquals(result.platformFeeAmount,"7.5");
 assertEquals(result.decisionId,"decision-1");assertEquals(result.confirmations,13);
});
Deno.test("rejects a successful receipt whose outer transaction did not target the expected Safe",async()=>{
 const wrongTarget=mock({receipt:{to:"0x"+"9".repeat(40)}});
 await assertRejects(()=>verifyBnbSafeBuyerRefundReceipt(wrongTarget.rpc,expected),BnbSafeRefundReceiptVerificationError,"unsuccessful or malformed");
});
Deno.test("rejects wrong chain before reading receipt",async()=>{
 const {rpc,calls}=mock({chainId:"0x1"});
 await assertRejects(()=>verifyBnbSafeBuyerRefundReceipt(rpc,expected),BnbSafeRefundReceiptVerificationError,"not BNB Chain");
 assertEquals(calls,["eth_chainId"]);
});
Deno.test("rejects noncanonical or underconfirmed receipt",async()=>{
 const reorg=mock({canonicalHash:"0x"+"d".repeat(64)});
 await assertRejects(()=>verifyBnbSafeBuyerRefundReceipt(reorg.rpc,expected),BnbSafeRefundReceiptVerificationError,"not canonical");
 const pending=mock({head:"0x65"});
 await assertRejects(()=>verifyBnbSafeBuyerRefundReceipt(pending.rpc,expected),BnbSafeRefundReceiptVerificationError,"insufficient confirmations");
});
Deno.test("rejects wrong buyer refund amount, extra transfer, and wrong token",async()=>{
 const wrongAmount=mock({receipt:{logs:[logs[0],{...logs[1],data:wordUint(24n*10n**18n)},logs[2]]}});
 await assertRejects(()=>verifyBnbSafeBuyerRefundReceipt(wrongAmount.rpc,expected),BnbSafeRefundReceiptVerificationError,"unexpected recipient or amount");
 const extra={...logs[2],logIndex:"0x3",topics:[transfer,wordAddress(SAFE),wordAddress("0x"+"7".repeat(40))]};
 const extraTransfer=mock({receipt:{logs:[...logs,extra]}});
 await assertRejects(()=>verifyBnbSafeBuyerRefundReceipt(extraTransfer.rpc,expected),BnbSafeRefundReceiptVerificationError,"unexpected recipient or amount");
 const wrongToken=mock({receipt:{logs:[logs[0],{...logs[1],address:"0x"+"8".repeat(40)},logs[2]]}});
 await assertRejects(()=>verifyBnbSafeBuyerRefundReceipt(wrongToken.rpc,expected),BnbSafeRefundReceiptVerificationError,"unapproved token");
});
Deno.test("rejects Safe failure, missing or duplicate execution success",async()=>{
 const failed=mock({receipt:{logs:[{...logs[0],topics:[failure,expected.safeTxHash]},...logs.slice(1)]}});
 await assertRejects(()=>verifyBnbSafeBuyerRefundReceipt(failed.rpc,expected),BnbSafeRefundReceiptVerificationError,"ExecutionSuccess");
 const missing=mock({receipt:{logs:logs.slice(1)}});
 await assertRejects(()=>verifyBnbSafeBuyerRefundReceipt(missing.rpc,expected),BnbSafeRefundReceiptVerificationError,"ExecutionSuccess");
 const duplicate=mock({receipt:{logs:[...logs,logs[0]]}});
 await assertRejects(()=>verifyBnbSafeBuyerRefundReceipt(duplicate.rpc,expected),BnbSafeRefundReceiptVerificationError,"ExecutionSuccess");
});
Deno.test("rejects platform fee not equal to 7.5% of original signed deal value",async()=>{
 const wrongFee=mock({receipt:{logs:[logs[0],logs[1],{...logs[2],data:wordUint(7n*10n**18n)}]}});
 await assertRejects(()=>verifyBnbSafeBuyerRefundReceipt(wrongFee.rpc,{...expected,platformFeeAmount:"7"}),BnbSafeRefundReceiptVerificationError,"not exactly 7.5%");
});

Deno.test("rejects duplicate transfer log index and malformed expectations",async()=>{
 const dup=mock({receipt:{logs:[logs[0],logs[1],{...logs[2],logIndex:"0x1"}]}});
 await assertRejects(()=>verifyBnbSafeBuyerRefundReceipt(dup.rpc,expected),BnbSafeRefundReceiptVerificationError,"duplicate Transfer log");
 await assertRejects(()=>verifyBnbSafeBuyerRefundReceipt(mock().rpc,{...expected,buyerWallet:PLATFORM}),BnbSafeRefundReceiptVerificationError,"expectations are invalid");
});
