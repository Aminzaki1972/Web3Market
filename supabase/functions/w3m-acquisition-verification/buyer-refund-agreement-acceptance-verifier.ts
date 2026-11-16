// W3M Protocol V1 — cryptographic verification of both immutable deal-term acceptances.
// Inputs must come from the fresh service-role snapshot, never from browser fields.
import {
  computeDealTermsAcceptanceDigest,
  verifyDealTermsAcceptanceSignature,
  type DealTermsAcceptanceInput,
} from "./deal-agreement-eip712.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const HASH=/^[0-9a-f]{64}$/i;

export interface BuyerRefundAgreementAcceptanceRow {
  id:unknown; terms_version_id:unknown; deal_id:unknown; terms_version:unknown;
  party_role:unknown; party_id:unknown; wallet_address:unknown; chain_id:unknown;
  safe_address:unknown; terms_hash:unknown; typed_data_digest:unknown; signature:unknown;
}
export interface BuyerRefundAgreementContext {
  dealId:string; projectId:string; buyerId:string; sellerId:string;
  termsVersionId:string; termsVersion:string; termsHash:string; safeAddress:string;
  agreementDocumentVersion:string; agreementDocumentHash:string;
  buyerWallet:string; sellerWallet:string;
  buyerAcceptance:BuyerRefundAgreementAcceptanceRow;
  sellerAcceptance:BuyerRefundAgreementAcceptanceRow;
}
function same(a:unknown,b:string):boolean {
 return typeof a==="string" && a.toLowerCase()===b.toLowerCase();
}
function verifyOne(
 row:BuyerRefundAgreementAcceptanceRow,
 context:BuyerRefundAgreementContext,
 role:"buyer"|"seller",
 expectedPartyId:string,
 expectedWallet:string,
):boolean {
 if(!UUID.test(String(row.id??"")) ||
    !same(row.terms_version_id,context.termsVersionId) ||
    !same(row.deal_id,context.dealId) ||
    String(row.terms_version)!==context.termsVersion ||
    row.party_role!==role || !same(row.party_id,expectedPartyId) ||
    !same(row.wallet_address,expectedWallet) ||
    Number(row.chain_id)!==56 || !same(row.safe_address,context.safeAddress) ||
    !same(row.terms_hash,context.termsHash) ||
    typeof row.signature!=="string" || !/^0x[0-9a-f]{130}$/i.test(row.signature) ||
    typeof row.typed_data_digest!=="string" || !/^0x[0-9a-f]{64}$/i.test(row.typed_data_digest)) return false;
 const acceptance:DealTermsAcceptanceInput={
  dealId:context.dealId,projectId:context.projectId,buyerId:context.buyerId,
  sellerId:context.sellerId,safeAddress:context.safeAddress,termsHash:context.termsHash,
  agreementDocumentVersion:context.agreementDocumentVersion,
  agreementDocumentHash:context.agreementDocumentHash,
  termsVersion:context.termsVersion,partyRole:role,
 };
 const digest=computeDealTermsAcceptanceDigest(acceptance);
 if(!same(row.typed_data_digest,digest)) return false;
 return verifyDealTermsAcceptanceSignature({
  acceptance,signature:row.signature,expectedWallet,
 }).valid;
}

/** Returns true only when both persisted signatures recover the current verified party wallets. */
export function verifyBuyerRefundAgreementAcceptances(
 context:BuyerRefundAgreementContext,
):{valid:true;buyerDigest:string;sellerDigest:string} {
 if(!UUID.test(context.dealId)||!UUID.test(context.projectId)||
    !UUID.test(context.buyerId)||!UUID.test(context.sellerId)||
    !UUID.test(context.termsVersionId)||context.buyerId.toLowerCase()===context.sellerId.toLowerCase()||
    !/^[1-9][0-9]*$/.test(context.termsVersion)||
    !HASH.test(context.termsHash)||!HASH.test(context.agreementDocumentHash)||
    !ADDRESS.test(context.safeAddress)||!ADDRESS.test(context.buyerWallet)||
    !ADDRESS.test(context.sellerWallet)||
    context.buyerWallet.toLowerCase()===context.sellerWallet.toLowerCase()||
    !context.agreementDocumentVersion) throw new Error("REFUND_AGREEMENT_CONTEXT_INVALID");
 const buyer:DealTermsAcceptanceInput={
  dealId:context.dealId,projectId:context.projectId,buyerId:context.buyerId,
  sellerId:context.sellerId,safeAddress:context.safeAddress,termsHash:context.termsHash,
  agreementDocumentVersion:context.agreementDocumentVersion,
  agreementDocumentHash:context.agreementDocumentHash,termsVersion:context.termsVersion,partyRole:"buyer",
 };
 const seller={...buyer,partyRole:"seller" as const};
 if(!verifyOne(context.buyerAcceptance,context,"buyer",context.buyerId,context.buyerWallet)||
    !verifyOne(context.sellerAcceptance,context,"seller",context.sellerId,context.sellerWallet)) {
  throw new Error("REFUND_BOTH_CURRENT_EIP712_ACCEPTANCES_REQUIRED");
 }
 return {valid:true,buyerDigest:computeDealTermsAcceptanceDigest(buyer),sellerDigest:computeDealTermsAcceptanceDigest(seller)};
}
