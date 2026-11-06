import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  loadSafeExecutionDatabaseSnapshot,
  loadReadySafeExecutionDatabaseSnapshot,
  type SafeExecutionDatabaseSnapshot,
} from "./safe-execution-snapshot-adapter.ts";
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";

const dealId = "71000000-0000-4000-8000-000000000001";
const buyerId = "73000000-0000-4000-8000-000000000003";
const sellerId = "74000000-0000-4000-8000-000000000004";
const safeHash = "0x" + "b".repeat(64);

const snapshot = {
  deal: {
    id: dealId, project_id: "72000000-0000-4000-8000-000000000002",
    buyer_id: buyerId, seller_id: sellerId, amount: "100.000000000000000001",
    currency: "USDT", status: "funded", payment_status: "confirmed",
    payment_tx_hash: "0x" + "a".repeat(64), chain_id: "56",
    safe_address: "0x2222222222222222222222222222222222222222",
    token_contract: "0x3333333333333333333333333333333333333333",
    token_symbol: "USDT", expected_amount: "100.000000000000000001",
    platform_fee: "7.500000000000000000", platform_fee_percent: "7.5",
    seller_net_amount: "92.500000000000000001", platform_fee_amount: "7.5",
    delivery_status: "accepted", buyer_approved_at: "2026-11-06T19:00:00Z",
    delivery_accepted_at: "2026-11-06T19:00:00Z", dispute_status: "none",
    release_tx_hash: null, buyer_agreed_at: "2026-11-06T18:00:00Z",
    seller_agreed_at: "2026-11-06T18:00:00Z",
  },
  policy: {
    id: "76000000-0000-4000-8000-000000000006", deal_id: dealId,
    deal_amount: "100.000000000000000001", fee_percent: "7.5",
    fee_amount: "7.500000000000000000", seller_net_amount: "92.500000000000000001",
    seller_wallet: "0x4444444444444444444444444444444444444444",
    platform_wallet: "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9",
    safe_address: "0x2222222222222222222222222222222222222222",
    token_contract: "0x3333333333333333333333333333333333333333",
    token_symbol: "USDT", chain_id: "56", safe_nonce: "7", status: "locked",
    locked_at: "2026-11-06T18:00:00Z", released_at: null, release_tx_hash: null,
  },
  project: { id: "72000000-0000-4000-8000-000000000002", owner_id: sellerId, status: "active", github_url: "https://github.com/Aminzaki1972/Web3Market", updated_at: "2026-11-06T18:00:00Z" },
  code_audit: {
    auditId: "87000000-0000-4000-8000-000000000007",
    repositoryOwner: "Aminzaki1972",
    repositoryName: "Web3Market",
    repositoryUrl: "https://github.com/Aminzaki1972/Web3Market",
    commitSha: "a".repeat(40),
    auditType: "code",
    completedAt: "2026-11-01T10:00:00.000Z",
    auditEvidenceHash: "c".repeat(64),
  },
  buyer_profile: { id: buyerId, wallet_address: "0x5555555555555555555555555555555555555555", wallet_verified: true, wallet_verified_at: "2026-11-06T18:00:00Z" },
  seller_profile: { id: sellerId, wallet_address: "0x4444444444444444444444444444444444444444", wallet_verified: true, wallet_verified_at: "2026-11-06T18:00:00Z" },
  release_transactions: [{
    id: "75000000-0000-4000-8000-000000000005", deal_id: dealId,
    action: "release_to_seller", safe_tx_hash: safeHash, tx_hash: null,
    status: "signed", confirmations_count: 2, required_signatures: 2,
    safe_nonce: "7", to_address: "0x9641d764fc13c8B624c04430C7356C1C7C8102e2",
    data: "0x1234", value_wei: "0", operation: 1, safe_tx_gas: "0",
    base_gas: "0", gas_price: "0",
    gas_token: "0x0000000000000000000000000000000000000000",
    refund_receiver: "0x0000000000000000000000000000000000000000",
    signatures: [], amount: "100", token_symbol: "USDT", chain_id: "56",
    safe_address: "0x2222222222222222222222222222222222222222",
    updated_at: "2026-11-06T18:00:00Z",
  }],
  signers: [
    { deal_id: dealId, signer_role: "buyer", signer_id: buyerId,
      wallet_address: "0x5555555555555555555555555555555555555555",
      signature_status: "signed", signed_at: "2026-11-06T18:00:00Z",
      safe_tx_hash: safeHash, signature: "0x" + "c".repeat(130) },
    { deal_id: dealId, signer_role: "seller", signer_id: sellerId,
      wallet_address: "0x4444444444444444444444444444444444444444",
      signature_status: "signed", signed_at: "2026-11-06T18:00:00Z",
      safe_tx_hash: safeHash, signature: "0x" + "d".repeat(130) },
    { deal_id: dealId, signer_role: "platform", signer_id: null,
      wallet_address: "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9",
      signature_status: "pending", signed_at: null, safe_tx_hash: safeHash, signature: null },
  ],
  party_agreements: [
    { party_role: "buyer", party_id: buyerId, agreed_at: "2026-11-06T18:00:00Z" },
    { party_role: "seller", party_id: sellerId, agreed_at: "2026-11-06T18:00:00Z" },
  ],
  dispute: null,
  agreement_binding_supported: false,
};

function client(data: unknown, error: unknown = null): W3MRpcClient {
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      assertEquals(name, "w3m_read_safe_execution_snapshot");
      assertEquals(args.p_deal_id, dealId);
      return { data, error };
    },
  };
}

Deno.test("strict Safe execution snapshot preserves exact text and blocks timestamp-only agreements", async () => {
  const result: SafeExecutionDatabaseSnapshot = await loadSafeExecutionDatabaseSnapshot(client(snapshot), dealId);
  assertEquals(result.deal.amount, "100.000000000000000001");
  assertEquals(result.policy.seller_net_amount, "92.500000000000000001");
  assertEquals(result.releaseTransaction.safe_nonce, "7");
  assertEquals(result.signers.length, 2);
  assertEquals(result.partyAgreements[0].termsHash, null);
  assertEquals(result.blockers.includes("IMMUTABLE_AGREEMENT_TERMS_BINDING_UNSUPPORTED"), true);
  assertEquals(result.blockers.includes("PAYMENT_STATE_NOT_CONFIRMED"), false);
  assertEquals(result.blockers.includes("BUYER_DELIVERY_ACCEPTANCE_MISSING"), false);
});

Deno.test("snapshot rejects missing, ambiguous, or duplicate legacy release transactions", async () => {
  await assertRejects(() => loadSafeExecutionDatabaseSnapshot(client({ ...snapshot, release_transactions: [] }), dealId));
  await assertRejects(() => loadSafeExecutionDatabaseSnapshot(client({
    ...snapshot, release_transactions: [...snapshot.release_transactions, snapshot.release_transactions[0]],
  }), dealId));
});

Deno.test("snapshot rejects numeric coercion for financial fields", async () => {
  await assertRejects(() => loadSafeExecutionDatabaseSnapshot(client({
    ...snapshot, deal: { ...snapshot.deal, amount: 100 },
  }), dealId));
});

Deno.test("snapshot rejects signer rows bound to another Safe transaction hash", async () => {
  await assertRejects(() => loadSafeExecutionDatabaseSnapshot(client({
    ...snapshot, signers: snapshot.signers.map((row, index) =>
      index === 0 ? { ...row, safe_tx_hash: "0x" + "f".repeat(64) } : row),
  }), dealId));
});

Deno.test("snapshot records dispute, payment, delivery, and wallet blockers", async () => {
  const result = await loadSafeExecutionDatabaseSnapshot(client({
    ...snapshot,
    deal: { ...snapshot.deal, dispute_status: "under_review", payment_status: "pending", delivery_status: "pending" },
    buyer_profile: { ...snapshot.buyer_profile, wallet_verified: false },
  }), dealId);
  assertEquals(result.blockers.includes("DEAL_DISPUTE_STATE_NOT_CLEAR"), true);
  assertEquals(result.blockers.includes("PAYMENT_STATE_NOT_CONFIRMED"), true);
  assertEquals(result.blockers.includes("BUYER_DELIVERY_ACCEPTANCE_MISSING"), true);
  assertEquals(result.blockers.includes("PARTICIPANT_WALLET_VERIFICATION_MISSING"), true);
});

Deno.test("snapshot rejects RPC errors and malformed request identifiers", async () => {
  await assertRejects(() => loadSafeExecutionDatabaseSnapshot(client(null, new Error("denied")), dealId));
  await assertRejects(() => loadSafeExecutionDatabaseSnapshot(client(snapshot), "not-a-uuid"));
});


Deno.test("execution-ready snapshot wrapper refuses every unresolved blocker", async () => {
  await assertRejects(() => loadReadySafeExecutionDatabaseSnapshot(client(snapshot), dealId));
});


Deno.test("snapshot rejects nonce and token symbol drift across deal, policy, and Safe transaction", async () => {
  await assertRejects(() => loadSafeExecutionDatabaseSnapshot(client({
    ...snapshot,
    release_transactions: [{ ...snapshot.release_transactions[0], safe_nonce: "8" }],
  }), dealId));
  await assertRejects(() => loadSafeExecutionDatabaseSnapshot(client({
    ...snapshot,
    release_transactions: [{ ...snapshot.release_transactions[0], token_symbol: "BUSD" }],
  }), dealId));
});

Deno.test("snapshot rejects buyer or seller signatures stored under another party identity", async () => {
  await assertRejects(() => loadSafeExecutionDatabaseSnapshot(client({
    ...snapshot,
    signers: snapshot.signers.map((row, index) =>
      index === 0 ? { ...row, signer_id: sellerId } : row),
  }), dealId));
});

Deno.test("snapshot exposes project owner and platform wallet mismatches as blockers", async () => {
  const result = await loadSafeExecutionDatabaseSnapshot(client({
    ...snapshot,
    project: { ...snapshot.project, owner_id: buyerId },
    policy: { ...snapshot.policy, platform_wallet: "0x6666666666666666666666666666666666666666" },
  }), dealId);
  assertEquals(result.blockers.includes("PROJECT_OWNER_SELLER_MISMATCH"), true);
  assertEquals(result.blockers.includes("POLICY_PLATFORM_WALLET_MISMATCH"), true);
});

import { secp256k1 } from "jsr:@noble/curves@1.8.2/secp256k1";
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";
import { computeDealTermsHash } from "./deal-terms-hash.ts";
import { computeDealTermsAcceptanceDigest } from "./deal-agreement-eip712.ts";

function signerFixture(keyByte: number) {
  const privateKey = new Uint8Array(32);
  privateKey[31] = keyByte;
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  const wallet = "0x" + Array.from(keccak_256(publicKey.slice(1)).slice(12),
    (b) => b.toString(16).padStart(2, "0")).join("");
  return {
    wallet,
    sign(digestHex: string) {
      const digest = Uint8Array.from(digestHex.match(/.{2}/g)!, (x) => Number.parseInt(x, 16));
      const signed = secp256k1.sign(digest, privateKey, { prehash: false });
      return "0x" + Array.from(new Uint8Array([
        ...signed.toCompactRawBytes(), signed.recovery! + 27,
      ]), (b) => b.toString(16).padStart(2, "0")).join("");
    },
  };
}
async function snapshotWithSignedAgreements() {
  const buyer = signerFixture(1);
  const seller = signerFixture(2);
  const deal = { ...snapshot.deal, amount: "100", expected_amount: "100" };
  const policy = {
    ...snapshot.policy, deal_amount: "100", fee_percent: "7.5",
    fee_amount: "7.5", seller_net_amount: "92.5", seller_wallet: seller.wallet,
  };
  const buyerProfile = { ...snapshot.buyer_profile, wallet_address: buyer.wallet };
  const sellerProfile = { ...snapshot.seller_profile, wallet_address: seller.wallet };
  const terms = await computeDealTermsHash({
    dealId, projectId: String(deal.project_id), buyerId, sellerId,
    amount: "100", currency: "USDT", expectedAmount: "100", chainId: 56,
    safeAddress: String(deal.safe_address), tokenContract: String(deal.token_contract),
    policy: {
      dealAmount: "100", feePercent: "7.5", feeAmount: "7.5", sellerNetAmount: "92.5",
      chainId: 56, safeAddress: String(policy.safe_address),
      tokenContract: String(policy.token_contract), sellerWallet: seller.wallet,
      platformWallet: String(policy.platform_wallet), safeNonce: "7", status: "locked",
    },
  });
  const termsVersionId = "77000000-0000-4000-8000-000000000007";
  const baseAcceptance = {
    dealId, projectId: String(deal.project_id), buyerId, sellerId,
    safeAddress: String(policy.safe_address), termsHash: terms.dealTermsHash,
    termsVersion: "1",
  };
  const buyerDigest = computeDealTermsAcceptanceDigest({ ...baseAcceptance, partyRole: "buyer" });
  const sellerDigest = computeDealTermsAcceptanceDigest({ ...baseAcceptance, partyRole: "seller" });
  const buyerSignature = buyer.sign(buyerDigest.slice(2));
  const sellerSignature = seller.sign(sellerDigest.slice(2));
  return {
    ...snapshot,
    deal, policy, buyer_profile: buyerProfile, seller_profile: sellerProfile,
    signers: snapshot.signers.map((row, index) => ({
      ...row, wallet_address: index === 0 ? buyer.wallet : seller.wallet,
    })),
    agreement_binding_supported: true,
    terms_version: {
      id: termsVersionId, deal_id: dealId, terms_version: "1",
      project_id: String(deal.project_id), buyer_id: buyerId, seller_id: sellerId,
      chain_id: "56", safe_address: String(policy.safe_address),
      terms_hash: terms.dealTermsHash, canonical_terms: terms.canonicalTerms,
    },
    agreement_acceptances: [
      {
        id: "78000000-0000-4000-8000-000000000008", terms_version_id: termsVersionId,
        deal_id: dealId, terms_version: "1", party_role: "buyer", party_id: buyerId,
        wallet_address: buyer.wallet, chain_id: "56", safe_address: String(policy.safe_address),
        terms_hash: terms.dealTermsHash, typed_data_digest: buyerDigest,
        signature: buyerSignature, accepted_at: "2026-11-06T19:00:00Z",
      },
      {
        id: "79000000-0000-4000-8000-000000000009", terms_version_id: termsVersionId,
        deal_id: dealId, terms_version: "1", party_role: "seller", party_id: sellerId,
        wallet_address: seller.wallet, chain_id: "56", safe_address: String(policy.safe_address),
        terms_hash: terms.dealTermsHash, typed_data_digest: sellerDigest,
        signature: sellerSignature, accepted_at: "2026-11-06T19:01:00Z",
      },
    ],
  };
}

Deno.test("snapshot clears immutable agreement blocker only after both real EIP-712 signatures verify", async () => {
  const data = await snapshotWithSignedAgreements();
  const result = await loadSafeExecutionDatabaseSnapshot(client(data), dealId);
  assertEquals(result.termsVersion?.termsVersion, "1");
  assertEquals(result.agreementAcceptances.length, 2);
  assertEquals(result.blockers.includes("IMMUTABLE_AGREEMENT_TERMS_BINDING_UNSUPPORTED"), false);
  assertEquals(result.blockers.includes("IMMUTABLE_AGREEMENT_ACCEPTANCES_INCOMPLETE"), false);
});

Deno.test("snapshot rejects an invalid EIP-712 agreement signature", async () => {
  const data = await snapshotWithSignedAgreements();
  const bad = {
    ...data,
    agreement_acceptances: data.agreement_acceptances.map((row, index) =>
      index === 0 ? { ...row, signature: "0x" + "f".repeat(130) } : row),
  };
  await assertRejects(() => loadSafeExecutionDatabaseSnapshot(client(bad), dealId));
});

Deno.test("snapshot rejects canonical terms drift after both parties signed", async () => {
  const data = await snapshotWithSignedAgreements();
  const drifted = {
    ...data,
    deal: { ...data.deal, amount: "101" },
  };
  await assertRejects(() => loadSafeExecutionDatabaseSnapshot(client(drifted), dealId));
});

Deno.test("SIGN snapshot permits an awaiting-signatures transaction without weakening EXECUTE", async () => {
  const pending = {
    ...snapshot,
    release_transactions: [{
      ...snapshot.release_transactions[0],
      status: "awaiting_signatures",
      confirmations_count: 0,
    }],
    signers: [],
  };
  const sign = await loadSafeExecutionDatabaseSnapshot(client(pending), dealId, "SIGN");
  assertEquals(sign.releaseTransaction.status, "awaiting_signatures");
  assertEquals(sign.blockers.includes("SAFE_SIGNATURES_BELOW_THRESHOLD"), false);
  await assertRejects(() => loadSafeExecutionDatabaseSnapshot(client(pending), dealId, "EXECUTE"));
});
