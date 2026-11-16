// W3M Protocol V1 — dedicated service-role persistence adapter for buyer refund Safe signatures.
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^0x[0-9a-f]{64}$/i;
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const SIGNATURE=/^0x[0-9a-f]{130}$/i;

export interface BuyerRefundSignaturePersistenceInput {
  actorId:string; dealId:string; requestId:string; decisionId:string;
  decisionHash:string; termsHash:string; safeTransactionHash:string;
  safeAddress:string; safeNonce:string; signature:string; verifiedWallet:string;
  signerRole:"buyer"|"seller"|"platform";
  buyerWallet:string;
  authorization:{authorized:true;phase:"SIGN";requestId:string;safeTransactionHash:string;issues:[]};
}
export interface BuyerRefundSignaturePersistenceResult {
  recorded:true; idempotentReplay:boolean; confirmationsCount:number;
  requiredSignatures:2; status:"awaiting_signatures"|"signed";
}
export async function persistBuyerRefundSignatureAtomically(
  client:W3MRpcClient,input:BuyerRefundSignaturePersistenceInput,
):Promise<BuyerRefundSignaturePersistenceResult>{
  if(!UUID.test(input.actorId)||!UUID.test(input.dealId)||!UUID.test(input.requestId)||
     !UUID.test(input.decisionId)||!HASH.test(input.decisionHash)||!HASH.test(input.safeTransactionHash)||
     !/^[0-9a-f]{64}$/i.test(input.termsHash)||!ADDRESS.test(input.safeAddress)||
     !ADDRESS.test(input.verifiedWallet)||!ADDRESS.test(input.buyerWallet)||
     !SIGNATURE.test(input.signature)||! /^(0|[1-9][0-9]*)$/.test(input.safeNonce)||
     !["buyer","seller","platform"].includes(input.signerRole)){
    throw new Error("W3M buyer refund SIGN persistence input is malformed.");
  }
  const a=input.authorization;
  if(!a||a.authorized!==true||a.phase!=="SIGN"||a.requestId!==input.requestId||
     a.safeTransactionHash.toLowerCase()!==input.safeTransactionHash.toLowerCase()||
     !Array.isArray(a.issues)||a.issues.length!==0){
    throw new Error("Fresh request-bound authorization is required for refund SIGN persistence.");
  }
  const {data,error}=await client.rpc("w3m_record_buyer_refund_signature",{
    p_request_id:input.requestId,p_actor_id:input.actorId,p_signer_role:input.signerRole,
    p_verified_wallet:input.verifiedWallet.toLowerCase(),
    p_safe_tx_hash:input.safeTransactionHash.toLowerCase(),
    p_signature:input.signature.toLowerCase(),
    p_server_authorization:{
      authorized:true,phase:"SIGN",request_id:input.requestId,
      safe_tx_hash:input.safeTransactionHash.toLowerCase(),buyer_wallet:input.buyerWallet.toLowerCase(),issues:[],
    },
  });
  if(error)throw new Error("W3M atomic buyer refund SIGN RPC failed.");
  if(!data||typeof data!=="object"||Array.isArray(data))throw new Error("Buyer refund SIGN RPC response is malformed.");
  const r=data as Record<string,unknown>;
  if(r.recorded!==true||typeof r.idempotent_replay!=="boolean"||
     !Number.isInteger(r.confirmations_count)||Number(r.confirmations_count)<1||
     Number(r.confirmations_count)>2||r.required_signatures!==2||
     (r.status!=="awaiting_signatures"&&r.status!=="signed")){
    throw new Error("Buyer refund SIGN RPC response failed strict validation.");
  }
  return {recorded:true,idempotentReplay:r.idempotent_replay,
    confirmationsCount:Number(r.confirmations_count),requiredSignatures:2,status:r.status};
}
