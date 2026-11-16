import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { Wallet } from "npm:ethers@6.15.0";
import {
  buildW3MAgreementChallenge,
  verifyW3MAgreementChallengeSignature,
  type W3MAgreementChallengeRequest,
} from "./agreement-challenge.ts";
import { createW3MDealAuditBinding } from "./deal-audit-binding.ts";

const NOW = 1_800_000_000;
const wallet = new Wallet("0x" + "31".repeat(32));
const expectedBinding = {
  dealId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  auditId: "33333333-3333-4333-8333-333333333333",
  fingerprintId: "44444444-4444-4444-8444-444444444444",
  fingerprintDigest: "a".repeat(64),
  repository: "Aminzaki1972/Web3Market",
  commitSha: "b".repeat(40),
};

async function request(): Promise<W3MAgreementChallengeRequest> {
  const binding = await createW3MDealAuditBinding(expectedBinding);
  return {
    binding,
    expectedBinding,
    termsHash: "0x" + "c".repeat(64),
    termsVersion: "1",
    partyRole: "buyer",
    walletAddress: wallet.address,
    nonce: "0x" + "d".repeat(64),
    deadline: NOW + 300,
  };
}

Deno.test("builds EIP-712 challenge with the verified deal-audit binding hash", async () => {
  const challenge = await buildW3MAgreementChallenge(await request(), NOW);
  assertEquals(challenge.typedData.message.bindingHash, challenge.bindingHash);
  assertEquals(challenge.typedData.message.fingerprintDigest, "0x" + expectedBinding.fingerprintDigest);
  assertEquals(challenge.typedData.message.partyRole, 1);
});

Deno.test("rejects a changed expected project, audit, fingerprint, or commit before challenge creation", async () => {
  const base = await request();
  const mutations = [
    { ...expectedBinding, projectId: "55555555-5555-4555-8555-555555555555" },
    { ...expectedBinding, auditId: "66666666-6666-4666-8666-666666666666" },
    { ...expectedBinding, fingerprintDigest: "e".repeat(64) },
    { ...expectedBinding, commitSha: "f".repeat(40) },
  ];
  for (const changed of mutations) {
    await assertRejects(() => buildW3MAgreementChallenge({
      ...base,
      expectedBinding: changed,
    }, NOW));
  }
});

Deno.test("rejects tampered binding contents and a changed terms hash", async () => {
  const base = await request();
  await assertRejects(() => buildW3MAgreementChallenge({
    ...base,
    binding: { ...base.binding, commit_sha: "f".repeat(40) },
  }, NOW));
  const challenge = await buildW3MAgreementChallenge(base, NOW);
  const alteredTerms = await buildW3MAgreementChallenge({
    ...base,
    termsHash: "0x" + "e".repeat(64),
  }, NOW);
  if (challenge.typedData.message.termsHash === alteredTerms.typedData.message.termsHash) {
    throw new Error("Changed agreement terms must produce a different signing message.");
  }
});

Deno.test("rejects invalid deadlines and nonce through the EIP-712 builder", async () => {
  const base = await request();
  await assertRejects(() => buildW3MAgreementChallenge({
    ...base,
    deadline: NOW,
  }, NOW));
  await assertRejects(() => buildW3MAgreementChallenge({
    ...base,
    nonce: "bad",
  }, NOW));
});


Deno.test("verifies a signature only after rebuilding the challenge from current binding and terms", async () => {
  const base = await request();
  const challenge = await buildW3MAgreementChallenge(base, NOW);
  const signature = await wallet.signTypedData(
    challenge.typedData.domain,
    challenge.typedData.types,
    challenge.typedData.message,
  );
  const verified = await verifyW3MAgreementChallengeSignature(base, signature, NOW);
  assertEquals(verified.valid, true);
  assertEquals(verified.recoveredAddress.toLowerCase(), wallet.address.toLowerCase());
  assertEquals(verified.bindingHash, challenge.bindingHash);
});

Deno.test("rejects a previously valid signature after terms, nonce, deadline, or role changes", async () => {
  const base = await request();
  const challenge = await buildW3MAgreementChallenge(base, NOW);
  const signature = await wallet.signTypedData(
    challenge.typedData.domain,
    challenge.typedData.types,
    challenge.typedData.message,
  );
  const changedRequests: W3MAgreementChallengeRequest[] = [
    { ...base, termsHash: "0x" + "e".repeat(64) },
    { ...base, nonce: "0x" + "f".repeat(64) },
    { ...base, deadline: NOW + 301 },
    { ...base, partyRole: "seller" },
  ];
  for (const changed of changedRequests) {
    await assertRejects(() => verifyW3MAgreementChallengeSignature(changed, signature, NOW));
  }
});

Deno.test("rejects a challenge signature made by a wallet other than the expected verified wallet", async () => {
  const base = await request();
  const other = new Wallet("0x" + "32".repeat(32));
  const challenge = await buildW3MAgreementChallenge({
    ...base,
    walletAddress: other.address,
  }, NOW);
  const signature = await other.signTypedData(
    challenge.typedData.domain,
    challenge.typedData.types,
    challenge.typedData.message,
  );
  await assertRejects(() => verifyW3MAgreementChallengeSignature(base, signature, NOW));
});
