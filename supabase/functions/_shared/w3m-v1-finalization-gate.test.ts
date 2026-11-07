import { assertEquals } from "jsr:@std/assert@1.0.14";
import { Wallet } from "npm:ethers@6.15.0";
import { buildW3MAgreementChallenge } from "../w3m-acquisition-verification/agreement-challenge.ts";
import { createW3MDealAuditBinding } from "../w3m-acquisition-verification/deal-audit-binding.ts";
import {
  assertW3MFinalizationReady,
  W3MFinalizationGateError,
  type W3MFinalizationGateClient,
} from "./w3m-v1-finalization-gate.ts";
import type { W3MAcceptanceRecord } from "../w3m-acquisition-verification/acceptance-ledger.ts";

const NOW = 1_800_000_000;
const dealId = "71000000-0000-4000-8000-000000000001";
const projectId = "72000000-0000-4000-8000-000000000002";
const auditId = "73000000-0000-4000-8000-000000000003";
const fingerprintId = "74000000-0000-4000-8000-000000000004";
const buyerId = "75000000-0000-4000-8000-000000000005";
const sellerId = "76000000-0000-4000-8000-000000000006";
const buyerWallet = new Wallet("0x" + "11".repeat(32));
const sellerWallet = new Wallet("0x" + "22".repeat(32));
const termsHash = "0x" + "33".repeat(32);
const fingerprintDigest = "44".repeat(32);
const commitSha = "ab".repeat(20);

async function evidenceFixture() {
  const expectedBinding = {
    dealId, projectId, auditId, fingerprintId,
    fingerprintDigest, repository: "aminzaki1972/web3market", commitSha,
  };
  const binding = await createW3MDealAuditBinding(expectedBinding);
  const acceptedAt = new Date(NOW * 1000).toISOString();
  const makeRecord = async (
    role: "buyer" | "seller",
    userId: string,
    wallet: Wallet,
    nonceByte: string,
  ): Promise<W3MAcceptanceRecord> => {
    const challenge = await buildW3MAgreementChallenge({
      binding,
      expectedBinding,
      termsHash,
      termsVersion: "1",
      partyRole: role,
      walletAddress: wallet.address,
      nonce: "0x" + nonceByte.repeat(64),
      deadline: NOW + 300,
    }, NOW);
    const signature = await wallet.signTypedData(
      challenge.typedData.domain,
      challenge.typedData.types,
      challenge.typedData.message,
    );
    return {
      deal_id: dealId,
      project_id: projectId,
      audit_id: auditId,
      fingerprint_id: fingerprintId,
      fingerprint_digest: "0x" + fingerprintDigest,
      binding_hash: "0x" + binding.binding_hash,
      terms_hash: termsHash,
      terms_version: "1",
      party_role: role,
      user_id: userId,
      wallet_address: wallet.address.toLowerCase(),
      signature,
      nonce: "0x" + nonceByte.repeat(64),
      signature_deadline: NOW + 300,
      accepted_at: acceptedAt,
    };
  };
  const acceptanceRows = [
    await makeRecord("buyer", buyerId, buyerWallet, "a"),
    await makeRecord("seller", sellerId, sellerWallet, "b"),
  ];
  return {
    binding,
    acceptanceRows,
    row: {
      deal_id: dealId,
      project_id: projectId,
      buyer_id: buyerId,
      seller_id: sellerId,
      deal_status: "accepted",
      dispute_status: "none",
      audit_id: auditId,
      fingerprint_id: fingerprintId,
      fingerprint_digest: "0x" + fingerprintDigest,
      repository: "aminzaki1972/web3market",
      commit_sha: commitSha,
      binding_hash: "0x" + binding.binding_hash,
      terms_hash: termsHash,
      terms_version: "1",
      acceptance_rows: acceptanceRows,
    },
  };
}

function client(data: unknown, error: { code?: string; message?: string } | null = null): W3MFinalizationGateClient {
  return {
    async rpc(name, args) {
      if (name !== "w3m_get_deal_finalization_evidence" || args.p_deal_id !== dealId) {
        throw new Error("Unexpected finalization evidence RPC call");
      }
      return { data, error };
    },
  };
}

Deno.test("shared finalization gate accepts the exact two-party persisted signature pair", async () => {
  const fixture = await evidenceFixture();
  const result = await assertW3MFinalizationReady(client([fixture.row]), dealId);
  assertEquals(result.acceptanceCount, 2);
  assertEquals(result.termsVersion, "1");
  assertEquals(result.buyerUserId, buyerId);
  assertEquals(result.sellerUserId, sellerId);
});

Deno.test("shared finalization gate rejects altered persisted signatures", async () => {
  const fixture = await evidenceFixture();
  const rows = [...fixture.acceptanceRows];
  rows[0] = { ...rows[0], signature: "0x" + "00".repeat(65) };
  const response = await assertW3MFinalizationReady(
    client([{ ...fixture.row, acceptance_rows: rows }]), dealId,
  ).then(() => "unexpected-success", (error) => error);
  assertEquals(response instanceof W3MFinalizationGateError, true);
  assertEquals((response as W3MFinalizationGateError).code, "W3M_ACCEPTANCE_PAIR_INVALID");
});

Deno.test("shared finalization gate rejects evidence for a different deal", async () => {
  const fixture = await evidenceFixture();
  const response = await assertW3MFinalizationReady(
    client([{ ...fixture.row, deal_id: "79000000-0000-4000-8000-000000000009" }]), dealId,
  ).then(() => "unexpected-success", (error) => error);
  assertEquals(response instanceof W3MFinalizationGateError, true);
  assertEquals((response as W3MFinalizationGateError).code, "W3M_FINALIZATION_EVIDENCE_UNAVAILABLE");
});

Deno.test("shared finalization gate fails closed when the evidence RPC is unavailable", async () => {
  const response = await assertW3MFinalizationReady(
    client(null, { code: "PGRST301", message: "permission denied" }), dealId,
  ).then(() => "unexpected-success", (error) => error);
  assertEquals(response instanceof W3MFinalizationGateError, true);
  assertEquals((response as W3MFinalizationGateError).code, "W3M_FINALIZATION_EVIDENCE_UNAVAILABLE");
});
