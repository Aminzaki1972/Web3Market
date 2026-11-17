// W3M Protocol V1 — service-role persistence adapter for buyer refund request creation.
// It accepts only independently verified server-side intent, canonical BNB facts,
// exact unsigned Safe transaction fields, and a fresh request-bound attestation.
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^0x[0-9a-f]{64}$/i;
const ADDRESS=/^0x[0-9a-f]{40}$/i;

export interface BuyerRefundRequestPersistenceInput {
  dealId:string;
  actorId:string;
  intent:Record<string,unknown>;
  safeTransaction:Record<string,unknown>;
  safeFacts:Record<string,unknown>;
  fundingFacts:Record<string,unknown>;
  serverAuthorization:Record<string,unknown>;
}
export interface BuyerRefundRequestPersistenceResult {
  created:true;
  idempotentReplay:boolean;
  requestId:string;
  safeTransactionId:string;
  safeTransactionHash:string;
  status:"awaiting_signatures"|"signed"|"submitted"|"confirmed"|"cancelled";
}
function object(value:unknown,label:string):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(label+" must be an object.");
  return value as Record<string,unknown>;
}
function requiredText(value:unknown,label:string):asserts value is string{
  if(typeof value!=="string"||!value.trim())throw new Error(label+" is required.");
}
export async function persistBuyerRefundRequestAtomically(
 client:W3MRpcClient,input:BuyerRefundRequestPersistenceInput,
):Promise<BuyerRefundRequestPersistenceResult>{
 if(!UUID.test(input.dealId)||!UUID.test(input.actorId))throw new Error("Buyer refund request actor/deal IDs are malformed.");
 const intent=object(input.intent,"Buyer refund intent");
 const safeTransaction=object(input.safeTransaction,"Safe refund transaction");
 const safeFacts=object(input.safeFacts,"Canonical Safe facts");
 const fundingFacts=object(input.fundingFacts,"Canonical funding facts");
 const authorization=object(input.serverAuthorization,"Buyer refund server authorization");
 requiredText(intent.decisionId,"Decision ID");
 requiredText(intent.disputeId,"Dispute ID");
 requiredText(intent.decisionHash,"Decision hash");
 requiredText(intent.termsHash,"Terms hash");
 requiredText(intent.safeAddress,"Safe address");
 requiredText(intent.buyerRecipient,"Buyer refund recipient");
 requiredText(safeTransaction.data,"Safe transaction calldata");
 requiredText(safeTransaction.to,"Safe transaction target");
 requiredText(safeFacts.safe_tx_hash,"Live Safe transaction hash");
 requiredText(safeFacts.block_hash,"Canonical Safe block hash");
 requiredText(fundingFacts.tx_hash,"Confirmed funding transaction hash");
 requiredText(fundingFacts.block_hash,"Canonical funding block hash");
 if(intent.action!=="refund_to_buyer"||intent.chainId!==56||
    !UUID.test(intent.decisionId)||!UUID.test(intent.disputeId)||
    !/^[0-9a-f]{64}$/i.test(intent.decisionHash.replace(/^0x/i,""))||
    !/^[0-9a-f]{64}$/i.test(intent.termsHash)||
    !ADDRESS.test(intent.safeAddress)||!ADDRESS.test(intent.buyerRecipient)||
    !HASH.test(safeFacts.safe_tx_hash as string)||!HASH.test(safeFacts.block_hash as string)||
    !HASH.test(fundingFacts.tx_hash as string)||!HASH.test(fundingFacts.block_hash as string)||
    safeFacts.chain_id!==56||safeFacts.threshold!==2||!ADDRESS.test(String(safeFacts.safe_address??""))||
    !/^(0|[1-9][0-9]*)$/.test(String(safeFacts.nonce??""))||
    !/^(0|[1-9][0-9]*)$/.test(String(safeFacts.block_number??""))||
    !/^(0|[1-9][0-9]*)([.][0-9]{1,18})?$/.test(String(safeFacts.balance??""))||
    !Array.isArray(safeFacts.owners)||safeFacts.owners.length!==3||
    fundingFacts.chain_id!==56||fundingFacts.confirmed!==true||
    !/^[1-9][0-9]*$/.test(String(fundingFacts.confirmations??""))||
    !/^(0|[1-9][0-9]*)([.][0-9]{1,18})?$/.test(String(fundingFacts.amount??""))||
    !ADDRESS.test(String(fundingFacts.token_address??""))||
    !ADDRESS.test(String(fundingFacts.safe_address??""))||
    !/^0x([0-9a-f]{2})+$/i.test(safeTransaction.data as string)){
  throw new Error("Buyer refund request persistence bindings are malformed.");
 }
 if(authorization.agreement_acceptances_verified!==true||
    typeof authorization.buyer_acceptance_digest!=="string"||!/^0x[0-9a-f]{64}$/i.test(authorization.buyer_acceptance_digest)||
    typeof authorization.seller_acceptance_digest!=="string"||!/^0x[0-9a-f]{64}$/i.test(authorization.seller_acceptance_digest)||
    authorization.authorized!==true||authorization.phase!=="CREATE_REFUND_REQUEST"||
    authorization.deal_id!==input.dealId||authorization.safe_hash_verified!==true||
    authorization.safe_block_canonical!==true||authorization.funding_receipt_verified!==true||
    authorization.funding_block_canonical!==true||authorization.payload_verified!==true||
    typeof authorization.safe_tx_hash!=="string"||authorization.safe_tx_hash.toLowerCase()!==(safeFacts.safe_tx_hash as string).toLowerCase()||
    typeof authorization.safe_block_hash!=="string"||authorization.safe_block_hash.toLowerCase()!==(safeFacts.block_hash as string).toLowerCase()||
    !Array.isArray(authorization.issues)||authorization.issues.length!==0){
  throw new Error("Fresh canonical Safe/funding/payload authorization is required.");
 }
 const {data,error}=await client.rpc("w3m_create_buyer_refund_request",{
  p_deal_id:input.dealId,
  p_actor_id:input.actorId,
  p_intent:intent,
  p_safe_transaction:safeTransaction,
  p_safe_facts:safeFacts,
  p_funding_facts:fundingFacts,
  p_server_authorization:authorization,
 });
 if(error)throw new Error("W3M atomic buyer refund request RPC failed.");
 const result=object(data,"Buyer refund request persistence");
 if(result.created!==true||typeof result.idempotent_replay!=="boolean"||
    typeof result.request_id!=="string"||!UUID.test(result.request_id)||
    typeof result.safe_transaction_id!=="string"||!UUID.test(result.safe_transaction_id)||
    typeof result.safe_tx_hash!=="string"||
    result.safe_tx_hash.toLowerCase()!==(safeFacts.safe_tx_hash as string).toLowerCase()||
    !["awaiting_signatures","signed","submitted","confirmed","cancelled"].includes(String(result.status))){
  throw new Error("W3M buyer refund request RPC response failed strict binding validation.");
 }
 return {
  created:true,
  idempotentReplay:result.idempotent_replay,
  requestId:result.request_id,
  safeTransactionId:result.safe_transaction_id,
  safeTransactionHash:result.safe_tx_hash.toLowerCase(),
  status:result.status as BuyerRefundRequestPersistenceResult["status"],
 };
}
