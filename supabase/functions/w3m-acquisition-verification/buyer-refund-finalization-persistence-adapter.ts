// W3M Protocol V1 — strict service-role adapter for atomic buyer-refund receipt finalization.
// The RPC must revalidate immutable decision/terms, request, signatures and transaction state in one DB transaction.
import type {W3MRpcClient} from "./supabase-rpc-adapter.ts";
import type {VerifiedBnbSafeRefundReceipt} from "./bnb-safe-refund-receipt-verifier.ts";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^0x[0-9a-f]{64}$/i;
export interface BuyerRefundFinalizationPersistenceInput {
 actorId:string;dealId:string;requestId:string;decisionId:string;decisionHash:string;termsHash:string;
 safeTransactionHash:string;broadcastTxHash:string;receipt:VerifiedBnbSafeRefundReceipt;
 serverAuthorization:{authorized:true;phase:"FINALIZE_BUYER_REFUND";requestId:string;decisionHash:string;termsHash:string;broadcastTxHash:string;receiptBlockHash:string;issues:[]};
}
export interface BuyerRefundFinalizationPersistenceResult {finalized:true;idempotentReplay:boolean;receiptId:string;status:"confirmed";}
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("Buyer refund finalization RPC response is malformed.");return v as Record<string,unknown>;}
export async function finalizeBuyerRefundAtomically(client:W3MRpcClient,input:BuyerRefundFinalizationPersistenceInput):Promise<BuyerRefundFinalizationPersistenceResult>{
 if(!UUID.test(input.actorId)||!UUID.test(input.dealId)||!UUID.test(input.requestId)||!UUID.test(input.decisionId)||
    !/^[0-9a-f]{64}$/i.test(input.decisionHash.replace(/^0x/i,""))||! /^[0-9a-f]{64}$/i.test(input.termsHash.replace(/^0x/i,""))||
    !HASH.test(input.safeTransactionHash)||!HASH.test(input.broadcastTxHash))throw new Error("Buyer refund finalization identity or hash is malformed.");
 const r=input.receipt,a=input.serverAuthorization;
 if(r.chainId!==56||r.executionSuccess!==true||r.transactionHash.toLowerCase()!==input.broadcastTxHash.toLowerCase()||
    r.safeTxHash.toLowerCase()!==input.safeTransactionHash.toLowerCase()||r.decisionId!==input.decisionId||
    r.decisionHash.replace(/^0x/i,"").toLowerCase()!==input.decisionHash.replace(/^0x/i,"").toLowerCase()||
    r.termsHash.replace(/^0x/i,"").toLowerCase()!==input.termsHash.replace(/^0x/i,"").toLowerCase()||
    r.safeAddress.toLowerCase()!==input.receipt.safeAddress.toLowerCase()||r.tokenContract.toLowerCase()!==input.receipt.tokenContract.toLowerCase()||
    r.buyerWallet.toLowerCase()!==input.receipt.buyerWallet.toLowerCase()||r.buyerRefundAmount!==input.receipt.buyerRefundAmount||
    r.platformWallet.toLowerCase()!==input.receipt.platformWallet.toLowerCase()||r.platformFeeAmount!==input.receipt.platformFeeAmount||
    r.confirmations<1||!HASH.test(r.blockHash)||!HASH.test(r.transactionHash))throw new Error("Verified buyer refund receipt is not bound to the immutable request.");
 if(a.authorized!==true||a.phase!=="FINALIZE_BUYER_REFUND"||a.requestId!==input.requestId||
    a.decisionHash!==input.decisionHash||a.termsHash!==input.termsHash||a.broadcastTxHash.toLowerCase()!==input.broadcastTxHash.toLowerCase()||
    a.receiptBlockHash.toLowerCase()!==r.blockHash.toLowerCase()||a.issues.length!==0)throw new Error("Fresh server finalization authorization is missing or misbound.");
 const {data,error}=await client.rpc("w3m_finalize_buyer_refund",{
  p_actor_id:input.actorId,p_deal_id:input.dealId,p_request_id:input.requestId,p_decision_id:input.decisionId,
  p_decision_hash:input.decisionHash.replace(/^0x/i,"").toLowerCase(),p_terms_hash:input.termsHash.replace(/^0x/i,"").toLowerCase(),
  p_safe_tx_hash:input.safeTransactionHash.toLowerCase(),p_broadcast_tx_hash:input.broadcastTxHash.toLowerCase(),
  p_verified_receipt:r,p_server_authorization:a,
 });
 if(error)throw new Error("Atomic W3M buyer refund finalization RPC failed.");
 const out=object(data);
 if(out.finalized!==true||out.request_id!==input.requestId||out.deal_id!==input.dealId||out.status!=="confirmed"||
    typeof out.idempotent_replay!=="boolean"||typeof out.receipt_id!=="string"||!UUID.test(out.receipt_id)||
    typeof out.broadcast_tx_hash!=="string"||out.broadcast_tx_hash.toLowerCase()!==input.broadcastTxHash.toLowerCase())
  throw new Error("Atomic W3M buyer refund finalization response failed strict binding validation.");
 return {finalized:true,idempotentReplay:out.idempotent_replay,receiptId:out.receipt_id,status:"confirmed"};
}
