import { assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { secp256k1 } from "jsr:@noble/curves@1.8.2/secp256k1";
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";
import {
  acceptDealAgreement,
  acceptDealAgreementWithAuditSnapshot,
  prepareDealAgreementAcceptance,
  prepareDealAgreementAcceptanceWithAuditSnapshot,
} from "./deal-agreement-service.ts";
import type { AuditManifestSource } from "./audit-manifest-loader.ts";
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
  code_audit: {
    auditId: "75000000-0000-4000-8000-000000000005",
    repositoryOwner: "Aminzaki1972",
    repositoryName: "Web3Market",
    repositoryUrl: "https://github.com/Aminzaki1972/Web3Market",
    commitSha: "a".repeat(40),
    auditType: "code",
    completedAt: "2026-11-01T10:00:00.000Z",
    auditEvidenceHash: "c".repeat(64),
  },
  buyer_profile: { id: buyerId, wallet_address: buyerSigner.wallet, wallet_verified: true, wallet_verified_at: "2026-11-06T10:00:00Z" },
  seller_profile: { id: sellerId, wallet_address: sellerSigner.wallet, wallet_verified: true, wallet_verified_at: "2026-11-06T10:00:00Z" },
};

const sourceAudit = {
  id: rawSnapshot.code_audit.auditId,
  project_id: projectId,
  status: "completed", audit_type:"code",
  overall_score:90, risk_level:"low", analysis_method:"gemini",
  repo_owner: "Aminzaki1972",
  repo_name: "Web3Market",
  repo_url: "https://github.com/Aminzaki1972/Web3Market",
  commit_sha: "a".repeat(40),
  completed_at: "2026-11-01T10:00:00.000Z",
  engine_version: "w3m-code-audit-1.0",
  files_scanned: 1,
  critical_count: 0, high_count: 0, medium_count: 0, low_count: 0, info_count: 0,
  analysis_progress: {
    evidence_version: "w3m-audit-evidence-v1",
    tree_truncated: false,
    persisted_file_count: 1,
  },
};
const auditSource: AuditManifestSource = {
  async loadAudit(id) { return {data: id === sourceAudit.id ? sourceAudit : null}; },
  async loadFilesPage(id, from) {
    return {data: from === 0 ? [{id:"file-1",audit_id:sourceAudit.id,path:"README.md"}] : []};
  },
  async loadFindingsPage() { return {data:[]}; },
};
function snapshotAwareClient(calls: Array<{name:string,args:Record<string,unknown>}> = []): W3MRpcClient {
  let manifestHash = "";
  return { async rpc(name,args) {
    calls.push({name,args});
    if (name === "w3m_read_deal_audit_snapshot_context") {
      const actorId = args.p_actor_id;
      if (actorId !== buyerId && actorId !== sellerId) throw new Error("Not a deal party");
      return {data:{
        deal_id:dealId,project_id:projectId,buyer_id:buyerId,seller_id:sellerId,
        audit_id:sourceAudit.id,project_github_url:"https://github.com/Aminzaki1972/Web3Market",
      },error:null};
    }
    if (name === "w3m_create_deal_code_audit_snapshot") {
      manifestHash = String(args.p_manifest_hash);
      return {data:{
        id:"77000000-0000-4000-8000-000000000007",
        deal_id:dealId,project_id:projectId,snapshot_version:1,audit_id:sourceAudit.id,
        repository_owner:"Aminzaki1972",repository_name:"Web3Market",
        repository_url:"https://github.com/Aminzaki1972/Web3Market",
        commit_sha:"a".repeat(40),audit_type:"code",
        completed_at:"2026-11-01T10:00:00.000Z",
        manifest_version:args.p_manifest_version,manifest_hash:manifestHash,
        file_count:1,finding_count:0,idempotent_replay:false,
      },error:null};
    }
    if (name === "w3m_read_deal_agreement_signing_snapshot") {
      return {data:{
        ...rawSnapshot,
        code_audit:{...rawSnapshot.code_audit,auditEvidenceHash:manifestHash},
      },error:null};
    }
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

function mockClient(calls: Array<{name:string,args:Record<string,unknown>}> = [], snapshotData = rawSnapshot): W3MRpcClient {
  return { async rpc(name,args) {
    calls.push({name,args});
    if (name === "w3m_read_deal_agreement_signing_snapshot") return {data:snapshotData,error:null};
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
  assertEquals(prepared.canonicalTerms.dealId,dealId);
  assertEquals(prepared.canonicalTerms.projectId,projectId);
  assertEquals(prepared.canonicalTerms.amount,"100");
  assertEquals((prepared.canonicalTerms.releasePolicy as Record<string, unknown>).feePercent,"7.5");
  assertEquals((prepared.canonicalTerms.releasePolicy as Record<string, unknown>).sellerNetAmount,"92.5");
  assertEquals(calls.map(x=>x.name),[
    "w3m_read_deal_agreement_signing_snapshot","w3m_register_deal_terms_version",
  ]);
});
Deno.test("buyer/seller agreement terms hash changes when the Audit Manifest changes", async () => {
  const original = await prepareDealAgreementAcceptance(mockClient(), { dealId, actorId: buyerId });
  const changedSnapshot = {
    ...rawSnapshot,
    code_audit: { ...rawSnapshot.code_audit, auditEvidenceHash: "d".repeat(64) },
  };
  const changed = await prepareDealAgreementAcceptance(
    mockClient([], changedSnapshot),
    { dealId, actorId: buyerId },
  );
  assertNotEquals(original.termsHash, changed.termsHash);
  assertNotEquals(original.typedData.message.termsHash, changed.typedData.message.termsHash);
});

Deno.test("prepare derives the seller role only from the authenticated seller identity", async () => {
  const prepared = await prepareDealAgreementAcceptance(mockClient(), {dealId,actorId:sellerId});
  assertEquals(prepared.partyRole,"seller");
  assertEquals(prepared.walletAddress,sellerSigner.wallet);
  assertEquals(prepared.typedData.message.partyRole,2);
});
Deno.test("accept verifies the current verified wallet and persists only the recovered signature", async () => {
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

Deno.test("public agreement preparation persists the independent audit snapshot before building signed terms", async () => {
  const calls: Array<{name:string,args:Record<string,unknown>}> = [];
  const prepared = await prepareDealAgreementAcceptanceWithAuditSnapshot(
    snapshotAwareClient(calls),auditSource,{dealId,actorId:buyerId},
  );
  assertEquals(prepared.partyRole,"buyer");
  assertEquals(calls.map(x=>x.name),[
    "w3m_read_deal_audit_snapshot_context",
    "w3m_create_deal_code_audit_snapshot",
    "w3m_read_deal_agreement_signing_snapshot",
    "w3m_register_deal_terms_version",
  ]);
});

Deno.test("public agreement acceptance revalidates and persists the audit snapshot before storing a signature", async () => {
  const preparation = await prepareDealAgreementAcceptanceWithAuditSnapshot(
    snapshotAwareClient(),auditSource,{dealId,actorId:buyerId},
  );
  const digest = computeDealTermsAcceptanceDigest({
    dealId,projectId,buyerId,sellerId,safeAddress,
    termsHash:preparation.termsHash,termsVersion:preparation.termsVersion,partyRole:"buyer",
  });
  const signature = buyerSigner.sign(digest.slice(2));
  const calls: Array<{name:string,args:Record<string,unknown>}> = [];
  const accepted = await acceptDealAgreementWithAuditSnapshot(
    snapshotAwareClient(calls),auditSource,{dealId,actorId:buyerId,signature},
  );
  assertEquals(accepted.partyRole,"buyer");
  assertEquals(calls.map(x=>x.name),[
    "w3m_read_deal_audit_snapshot_context",
    "w3m_create_deal_code_audit_snapshot",
    "w3m_read_deal_agreement_signing_snapshot",
    "w3m_register_deal_terms_version",
    "w3m_insert_deal_agreement_acceptance",
  ]);
});
