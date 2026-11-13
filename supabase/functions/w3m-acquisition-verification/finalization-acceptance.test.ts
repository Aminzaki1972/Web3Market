import { assertEquals } from "jsr:@std/assert@1.0.14";
import { Wallet } from "npm:ethers@6.15.0";
import { buildW3MAgreementChallenge } from "./agreement-challenge.ts";
import { createW3MDealAuditBinding } from "./deal-audit-binding.ts";
import {
  verifyW3MFinalizationAcceptancePair,
  type W3MAcceptancePartyUsers,
} from "./finalization-acceptance.ts";
import type { W3MAcceptanceRecord, W3MCompleteAcceptanceExpectation } from "./acceptance-ledger.ts";

const NOW = 1_800_000_000;
const dealId = "71000000-0000-4000-8000-000000000001";
const projectId = "72000000-0000-4000-8000-000000000002";
const auditId = "73000000-0000-4000-8000-000000000003";
const fingerprintId = "74000000-0000-4000-8000-000000000004";
const parties: W3MAcceptancePartyUsers = {
  buyerUserId: "75000000-0000-4000-8000-000000000005",
  sellerUserId: "76000000-0000-4000-8000-000000000006",
};
const buyerWallet = new Wallet("0x" + "11".repeat(32));
const sellerWallet = new Wallet("0x" + "22".repeat(32));
const termsHash = "0x" + "33".repeat(32);
const fingerprintDigest = "44".repeat(32);
const commitSha = "ab".repeat(20);
const expected: W3MCompleteAcceptanceExpectation = {
  dealId, projectId, auditId, fingerprintId,
  fingerprintDigest, bindingHash: "", termsHash, termsVersion: "1",
};
const expectedBinding = {
  dealId, projectId, auditId, fingerprintId,
  fingerprintDigest, repository: "aminzaki1972/web3market", commitSha,
};

async function fixture() {
  const binding = await createW3MDealAuditBinding(expectedBinding);
  const completeExpected = { ...expected, bindingHash: "0x" + binding.binding_hash };
  const acceptedAt = new Date(NOW * 1000).toISOString();
  const makeRecord = async (
    role: "buyer" | "seller",
    userId: string,
    wallet: Wallet,
    nonceByte: string,
  ): Promise<W3MAcceptanceRecord> => {
    const challenge = await buildW3MAgreementChallenge({
      binding, expectedBinding, termsHash, termsVersion: "1", partyRole: role,
      walletAddress: wallet.address, nonce: "0x" + nonceByte.repeat(64),
      deadline: NOW + 300,
    }, NOW);
    const signature = await wallet.signTypedData(
      challenge.typedData.domain,
      challenge.typedData.types,
      challenge.typedData.message,
    );
    return {
      deal_id: dealId, project_id: projectId, audit_id: auditId,
      fingerprint_id: fingerprintId, fingerprint_digest: "0x" + fingerprintDigest,
      binding_hash: completeExpected.bindingHash, terms_hash: termsHash,
      terms_version: "1", party_role: role, user_id: userId,
      wallet_address: wallet.address.toLowerCase(), signature,
      nonce: "0x" + nonceByte.repeat(64), signature_deadline: NOW + 300,
      accepted_at: acceptedAt,
    };
  };
  const rows = [
    await makeRecord("buyer", parties.buyerUserId, buyerWallet, "a"),
    await makeRecord("seller", parties.sellerUserId, sellerWallet, "b"),
  ];
  return { binding, completeExpected, rows };
}

Deno.test("finalization verifier accepts the exact two valid EIP-712 party signatures", async () => {
  const f = await fixture();
  assertEquals(await verifyW3MFinalizationAcceptancePair(
    f.rows, f.completeExpected, parties, f.binding, expectedBinding,
  ), true);
});

Deno.test("finalization verifier rejects a persisted signature altered after acceptance", async () => {
  const f = await fixture();
  const rows = [...f.rows];
  rows[0] = { ...rows[0], signature: "0x" + "00".repeat(65) };
  assertEquals(await verifyW3MFinalizationAcceptancePair(
    rows, f.completeExpected, parties, f.binding, expectedBinding,
  ), false);
});

Deno.test("finalization verifier rejects a role row belonging to the wrong authenticated user", async () => {
  const f = await fixture();
  const rows = [...f.rows];
  rows[0] = { ...rows[0], user_id: parties.sellerUserId };
  assertEquals(await verifyW3MFinalizationAcceptancePair(
    rows, f.completeExpected, parties, f.binding, expectedBinding,
  ), false);
});

Deno.test("finalization verifier rejects changed trusted audit evidence", async () => {
  const f = await fixture();
  const changedBinding = { ...expectedBinding, commitSha: "cd".repeat(20) };
  assertEquals(await verifyW3MFinalizationAcceptancePair(
    f.rows, f.completeExpected, parties, f.binding, changedBinding,
  ), false);
});
