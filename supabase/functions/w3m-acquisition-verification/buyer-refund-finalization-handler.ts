// W3M Protocol V1 — authenticated, fail-closed buyer-refund receipt finalization boundary.
// This handler verifies an already-broadcast Safe transaction; it never signs or broadcasts.
import type {
  BnbSafeRefundReceiptExpectation,
  VerifiedBnbSafeRefundReceipt,
} from "./bnb-safe-refund-receipt-verifier.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^0x[0-9a-f]{64}$/i;
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const json=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});

export interface BuyerRefundFinalizationContext {
  actorId:string;
  dealId:string;
  requestId:string;
  decisionId:string;
  decisionHash:string;
  termsHash:string;
  safeAddress:string;
  safeTransactionHash:string;
  safeNonce:string;
  chainId:56;
  signerCount:number;
  requiredSignatures:2;
  transactionStatus:"signed"|"submitted";
  expectation:BnbSafeRefundReceiptExpectation;
}
export interface BuyerRefundFinalizationResult {
  finalized:true;
  idempotentReplay:boolean;
  receiptId:string;
  status:"confirmed";
}
export interface BuyerRefundFinalizationDependencies {
  authenticate(token:string):Promise<string|null>;
  isAdmin(actorId:string):Promise<boolean>;
  loadFreshContext(input:{actorId:string;requestId:string;broadcastTxHash:string}):Promise<BuyerRefundFinalizationContext>;
  verifyReceipt(expectation:BnbSafeRefundReceiptExpectation):Promise<VerifiedBnbSafeRefundReceipt>;
  finalizeAtomically(input:{actorId:string;dealId:string;requestId:string;decisionId:string;decisionHash:string;termsHash:string;safeTransactionHash:string;broadcastTxHash:string;receipt:VerifiedBnbSafeRefundReceipt;serverAuthorization:{authorized:true;phase:"FINALIZE_BUYER_REFUND";requestId:string;decisionHash:string;termsHash:string;broadcastTxHash:string;receiptBlockHash:string;issues:[]}}):Promise<BuyerRefundFinalizationResult>;
}
export async function handleBuyerRefundFinalization(request:Request,deps:BuyerRefundFinalizationDependencies):Promise<Response>{
  if(request.method!=="POST")return json(405,{ok:false,error:"POST_REQUIRED"});
  const authorization=request.headers.get("authorization")??"";
  const match=/^Bearer\\s+(\\S+)$/i.exec(authorization);
  if(!match)return json(401,{ok:false,error:"AUTHENTICATION_REQUIRED"});
  let actorId:string|null;
  try{actorId=await deps.authenticate(match[1]);}catch{return json(401,{ok:false,error:"AUTHENTICATION_FAILED"});}
  if(!actorId||!UUID.test(actorId))return json(401,{ok:false,error:"AUTHENTICATION_FAILED"});
  try{if(await deps.isAdmin(actorId)!==true)return json(403,{ok:false,error:"ADMIN_REQUIRED"});}catch{return json(403,{ok:false,error:"ADMIN_AUTHORIZATION_FAILED"});}
  let body:unknown;
  try{body=await request.json();}catch{return json(400,{ok:false,error:"INVALID_JSON"});}
  if(!body||typeof body!=="object"||Array.isArray(body))return json(400,{ok:false,error:"INVALID_REQUEST"});
  const row=body as Record<string,unknown>;
  if(Object.keys(row).length!==2||typeof row.request_id!=="string"||!UUID.test(row.request_id)||typeof row.broadcast_tx_hash!=="string"||!HASH.test(row.broadcast_tx_hash))return json(400,{ok:false,error:"ONLY_REQUEST_ID_AND_BROADCAST_TX_HASH_ARE_ACCEPTED"});
  try{
    const c=await deps.loadFreshContext({actorId,requestId:row.request_id,broadcastTxHash:row.broadcast_tx_hash.toLowerCase()});
    if(c.actorId!==actorId||c.requestId!==row.request_id||!UUID.test(c.dealId)||!UUID.test(c.decisionId)||
       !HASH.test(c.decisionHash)||!/^([0-9a-f]{64})$/i.test(c.termsHash)||!ADDRESS.test(c.safeAddress)||
       !HASH.test(c.safeTransactionHash)||!/^([0-9]+)$/.test(c.safeNonce)||c.chainId!==56||
       c.transactionStatus!=="signed"&&c.transactionStatus!=="submitted"||c.signerCount!==2||c.requiredSignatures!==2){
      return json(409,{ok:false,error:"FRESH_SIGNED_REFUND_CONTEXT_INVALID"});
    }
    const e=c.expectation;
    if(!e||e.broadcastTxHash.toLowerCase()!==row.broadcast_tx_hash.toLowerCase()||
       e.safeTxHash.toLowerCase()!==c.safeTransactionHash.toLowerCase()||e.safeAddress.toLowerCase()!==c.safeAddress.toLowerCase()||
       e.decisionId!==c.decisionId||e.decisionHash.replace(/^0x/i,"").toLowerCase()!==c.decisionHash.replace(/^0x/i,"").toLowerCase()||
       e.termsHash.replace(/^0x/i,"").toLowerCase()!==c.termsHash.replace(/^0x/i,"").toLowerCase()){
      return json(409,{ok:false,error:"REFUND_RECEIPT_EXPECTATION_BINDING_MISMATCH"});
    }
    const receipt=await deps.verifyReceipt(e);
    if(receipt.chainId!==56||receipt.transactionHash.toLowerCase()!==row.broadcast_tx_hash.toLowerCase()||
       receipt.safeTxHash.toLowerCase()!==c.safeTransactionHash.toLowerCase()||receipt.safeAddress.toLowerCase()!==c.safeAddress.toLowerCase()||
       receipt.decisionId!==c.decisionId||receipt.decisionHash.replace(/^0x/i,"").toLowerCase()!==c.decisionHash.replace(/^0x/i,"").toLowerCase()||
       receipt.termsHash.replace(/^0x/i,"").toLowerCase()!==c.termsHash.replace(/^0x/i,"").toLowerCase()||receipt.executionSuccess!==true){
      return json(409,{ok:false,error:"VERIFIED_RECEIPT_BINDING_MISMATCH"});
    }
    const result=await deps.finalizeAtomically({actorId,dealId:c.dealId,requestId:c.requestId,decisionId:c.decisionId,
      decisionHash:c.decisionHash,termsHash:c.termsHash,safeTransactionHash:c.safeTransactionHash,
      broadcastTxHash:row.broadcast_tx_hash.toLowerCase(),receipt,
      serverAuthorization:{authorized:true,phase:"FINALIZE_BUYER_REFUND",requestId:c.requestId,decisionHash:c.decisionHash,
        termsHash:c.termsHash,broadcastTxHash:row.broadcast_tx_hash.toLowerCase(),receiptBlockHash:receipt.blockHash,issues:[]}});
    if(!result||result.finalized!==true||typeof result.idempotentReplay!=="boolean"||!UUID.test(result.receiptId)||result.status!=="confirmed")return json(502,{ok:false,error:"ATOMIC_REFUND_FINALIZATION_RESPONSE_INVALID"});
    return json(200,{ok:true,finalized:true,idempotent_replay:result.idempotentReplay,receipt_id:result.receiptId,status:"confirmed"});
  }catch{return json(409,{ok:false,error:"BUYER_REFUND_FINALIZATION_BLOCKED"});}
}
