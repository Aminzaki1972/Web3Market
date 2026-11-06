import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { secp256k1 } from "jsr:@noble/curves@1.8.2/secp256k1";
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";
import {
  acceptDealAgreement,
  prepareDealAgreementAcceptance,
} from "./deal-agreement-service.ts";
import { computeDealTermsAcceptanceDigest } from "./deal-agreement-eip712.ts";
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";

const dealId = "71000000-0000-4000-8000-000000000001";
const projectId = "72000000-0000-4000-8000-000000000002";
const buyerId = "73000000-0000-4000-8000-000000000003";
const sellerId = "74000000-0000-4000-8000-000000000004";
const safeAddress = "0x2222222222222222222222222222222222222222";
const token = "0x3333333333333333333333333333333333333333";
function toHex(bytes: Uint8Array) { return Array.from(bytes, b => b.toString(16).padStart(2,"0")).join(""); }
function signer(keyByte: number) {
  const privateKey = new Uint8Array(32); privateKey[31] = keyByte;
  const wallet = "0x" + toHex(keccak_256(secp256k1.getPublicKey(privateKey,false).slice(1)).slice(12));
  return { wallet, sign(digestHex: string) {
    const digest = Uint8Array.from(digestHex.match(/.{2}/g)!, x => Number.parseInt(x,16));
    const sig = secp256k1.sign(digest,privateKey,{prehash:false});
    return "0x" + toHex(new Uint8Array([...sig.toCompactRawBytes(),sig.recovery!+27]));
  }};
}
const buyerSigner = signer(1);
const sellerSigner = signer(2);
const rawSnapshot = {
  deal: { id: dealId, project_id: projectId, buyer_id: buyerId, seller_id: sellerId,
    amount: "100.000000", currency: "USDT", expected_amount: "100.000000",
    chain_id: "56", safe_address: safeAddress, token_contract: token, updated_at: "2026-11-06T10:00:00Z" },
  policy: { deal_id: dealId, deal_amount: "100.000000", fee_percent: "7.500",
    fee_amount: "7.500000", seller_net_amount: "92.500000", chain_id: "56",
    safe_address: safeAddress, token_contract: token, seller_wallet: sellerSigner.wallet,
    platform_wallet: "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9",
    safe_nonce: "7", status: "locked", updated_at: "2026-11-06T10:00:00Z" },
  project: { id: projectId, owner_id: sellerId, status: "active" },
  buyer_profile: { id: buyerId, wallet_address: buyerSigner.wallet, wallet_verified: true, wallet_verified_at: "2026-11-06T10:00:00Z" },
  seller_profile: { id: sellerId, wallet_address: sellerSigner.wallet, wallet_verified: true, wallet_verified_at: "2026-11-06T10:00:00Z" },
};
function mockClient(calls: Array<{name:string,args:Record<string,unknown>}> = []): W3MRpcClient {
  return { async rpc(name,args) {
    calls.push({name,args});
    if (name === "w3m_read_deal_agreement_signing_snapshot") return {data:rawSnapshot,error:null};
    if (name === "w3m_register_deal_terms_version") return {data:{
      deal_id:dealId,terms_version:1,terms_version_id:"75000000-0000-4000-8000-000000000005",
      terms_hash:args.p_terms_hash,idempotent_replay:false,
    },error:null};
    if (name === "w3m_insert_deal_agreement_acceptance") return {data:{
      accepted:true,acceptance_id:"76000000-0000-4000-8000-000000000006",
      terms_version:1,party_role:args.p_party_role,idempotent_replay:false,
    },error:null};
    throw new Error("Unexpected RPC " + name);
  }};
}
Deno.test("prepare derives the buyer role and returns the exact server-built EIP-712 typed data", async () => {
  const calls: Array<{name:string,args:Record<string,unknown>}> = [];
  const prepared = await prepareDealAgreementAcceptance(mockClient(calls), {dealId,actorId:buyerId});
  assertEquals(prepared.partyRole,"buyer");
  assertEquals(prepared.partyId,buyerId);
  assertEquals(prepared.walletAddress,buyerSigner.wallet);
  assertEquals(prepared.typedData.domain.chainId,56);
  assertEquals(prepared.typedData.message.partyRole,1);
  assertEquals(calls.map(x=>x.name),[
    "w3m_read_deal_agreement_signing_snapshot","w3m_register_deal_terms_version",
  ]);
});
Deno.test("prepare derives the seller role only from the authenticated seller identity", async () => {
  const prepared = await prepareDealAgreementAcceptance(mockClient(), {dealId,actorId:sellerId});
  assertEquals(prepared.partyRole,"seller");
  assertEquals(prepared.walletAddress,sellerSigner.wallet);
  assertEquals(prepared.typedData.message.partyRole,2);
});
Deno.test("accept verifies the current verified wallet and persists only the recovered signature", async () => {
  const acceptance = {
    dealId,projectId,buyerId,sellerId,safeAddress,
    termsHash: (await import("./deal-terms-hash.ts")).computeDealTermsHash,
  };
  const prepared = await prepareDealAgreementAcceptance(mockClient(), {dealId,actorId:buyerId});
  const digest = computeDealTermsAcceptanceDigest({
    dealId,projectId,buyerId,sellerId,safeAddress,
    termsHash:prepared.termsHash,termsVersion:prepared.termsVersion,partyRole:"buyer",
  });
  const signature = buyerSigner.sign(digest.slice(2));
  const calls: Array<{name:string,args:Record<string,unknown>}> = [];
  const result = await acceptDealAgreement(mockClient(calls), {dealId,actorId:buyerId,signature});
  assertEquals(result.partyRole,"buyer");
  assertEquals(result.termsVersion,"1");
  const insert = calls.find(x=>x.name==="w3m_insert_deal_agreement_acceptance");
  assertEquals(insert?.args.p_party_id,buyerId);
  assertEquals(insert?.args.p_wallet_address,buyerSigner.wallet);
  assertEquals(insert?.args.p_signature,signature);
});
Deno.test("wrong actor and invalid signatures never reach the persistence RPC", async () => {
  const calls: Array<{name:string,args:Record<string,unknown>}> = [];
  await assertRejects(() => prepareDealAgreementAcceptance(mockClient(calls), {
    dealId,actorId:"75000000-0000-4000-8000-000000000005",
  }));
  await assertRejects(() => acceptDealAgreement(mockClient(calls), {
    dealId,actorId:buyerId,signature:"0x" + "0".repeat(130),
  }));
  assertEquals(calls.some(x=>x.name==="w3m_insert_deal_agreement_acceptance"),false);
});
