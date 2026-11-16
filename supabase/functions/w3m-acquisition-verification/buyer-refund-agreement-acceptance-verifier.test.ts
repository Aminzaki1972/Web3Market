import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { secp256k1 } from "jsr:@noble/curves@1.8.2/secp256k1";
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";
import { computeDealTermsAcceptanceDigest } from "./deal-agreement-eip712.ts";
import { verifyBuyerRefundAgreementAcceptances, type BuyerRefundAgreementContext, type BuyerRefundAgreementAcceptanceRow } from "./buyer-refund-agreement-acceptance-verifier.ts";
const base={
 dealId:"71000000-0000-4000-8000-000000000001",projectId:"72000000-0000-4000-8000-000000000002",
 buyerId:"73000000-0000-4000-8000-000000000003",sellerId:"74000000-0000-4000-8000-000000000004",
 termsVersionId:"75000000-0000-4000-8000-000000000005",termsVersion:"1",termsHash:"ab".repeat(32),
 safeAddress:"0x2222222222222222222222222222222222222222",
 agreementDocumentVersion:"1.0",agreementDocumentHash:"721aaabcef891b8cdd43cdc34e1980f2166ce32282162d927da942ef8ec10531",
 buyerWallet:"0x"+ "00".repeat(19)+"01",sellerWallet:"0x"+"00".repeat(19)+"02",
};
function hex(v:Uint8Array){return Array.from(v,b=>b.toString(16).padStart(2,"0")).join("");}
function sign(digest:string,keyByte:number){
 const key=new Uint8Array(32);key[31]=keyByte;
 const bytes=Uint8Array.from(digest.slice(2).match(/.{2}/g)!,x=>parseInt(x,16));
 const sig=secp256k1.sign(bytes,key,{prehash:false});
 const wallet="0x"+hex(keccak_256(secp256k1.getPublicKey(key,false).slice(1)).slice(12));
 return {wallet,signature:"0x"+hex(new Uint8Array([...sig.toCompactRawBytes(),sig.recovery!+27]))};
}
function row(context:typeof base,role:"buyer"|"seller",keyByte:number):BuyerRefundAgreementAcceptanceRow{
 const partyId=role==="buyer"?context.buyerId:context.sellerId;
 const signed=sign(computeDealTermsAcceptanceDigest({...context,partyRole:role}),keyByte);
 return {id:role==="buyer"?"76000000-0000-4000-8000-000000000006":"77000000-0000-4000-8000-000000000007",
  terms_version_id:context.termsVersionId,deal_id:context.dealId,terms_version:context.termsVersion,
  party_role:role,party_id:partyId,wallet_address:signed.wallet,chain_id:56,safe_address:context.safeAddress,
  terms_hash:context.termsHash,typed_data_digest:computeDealTermsAcceptanceDigest({...context,partyRole:role}),signature:signed.signature};
}
function fixture():BuyerRefundAgreementContext{
 const buyer=row(base,"buyer",1),seller=row(base,"seller",2);
 return {...base,buyerWallet:String(buyer.wallet_address),sellerWallet:String(seller.wallet_address),buyerAcceptance:buyer,sellerAcceptance:seller};
}
Deno.test("verifies both persisted EIP-712 acceptances against current buyer and seller wallets",()=>{
 const result=verifyBuyerRefundAgreementAcceptances(fixture());
 assertEquals(result.valid,true);assertEquals(result.buyerDigest.length,66);assertEquals(result.sellerDigest.length,66);
});
Deno.test("rejects missing, swapped-role, wrong-wallet, stale-terms and digest-tampered acceptances",()=>{
 const good=fixture();
 assertThrows(()=>verifyBuyerRefundAgreementAcceptances({...good,buyerAcceptance:{...good.buyerAcceptance,signature:good.sellerAcceptance.signature}}));
 assertThrows(()=>verifyBuyerRefundAgreementAcceptances({...good,sellerAcceptance:{...good.sellerAcceptance,party_role:"buyer"}}));
 assertThrows(()=>verifyBuyerRefundAgreementAcceptances({...good,buyerWallet:"0x"+"00".repeat(19)+"09"}));
 assertThrows(()=>verifyBuyerRefundAgreementAcceptances({...good,sellerAcceptance:{...good.sellerAcceptance,terms_hash:"cd".repeat(32)}}));
 assertThrows(()=>verifyBuyerRefundAgreementAcceptances({...good,buyerAcceptance:{...good.buyerAcceptance,typed_data_digest:"0x"+"ff".repeat(32)}}));
});
Deno.test("rejects malformed or non-distinct agreement parties and Safe context",()=>{
 const good=fixture();
 assertThrows(()=>verifyBuyerRefundAgreementAcceptances({...good,buyerId:"bad"}));
 assertThrows(()=>verifyBuyerRefundAgreementAcceptances({...good,sellerWallet:good.buyerWallet}));
 assertThrows(()=>verifyBuyerRefundAgreementAcceptances({...good,safeAddress:"0x1234"}));
});
