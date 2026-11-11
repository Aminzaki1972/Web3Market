import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { signAndSubmitW3MDealAgreement } from "./w3m-deal-agreement-client.js";

const DEAL_ID = "71000000-0000-4000-8000-000000000001";
const CHALLENGE_ID = "75000000-0000-4000-8000-000000000005";
const ACCEPTANCE_ID = "76000000-0000-4000-8000-000000000006";
const FINGERPRINT_ID = "74000000-0000-4000-8000-000000000004";
const WALLET = "0x" + "1".repeat(40);
const SIGNATURE = "0x" + "a".repeat(130);
const HEX = (char) => "0x" + char.repeat(64);
const uuidToBytes32 = (value) => "0x" + value.replaceAll("-", "").toLowerCase().padStart(64, "0");
const UUID_BYTES32 = uuidToBytes32(DEAL_ID);

function preparedResponse(overrides = {}) {
  const typedData = {
    domain: { name: "Web3Market Deal Agreement", version: "1", chainId: 56 },
    primaryType: "DealTermsAcceptance",
    types: {
      DealTermsAcceptance: [
        { name: "dealId", type: "bytes32" },
        { name: "fingerprintId", type: "bytes32" },
        { name: "fingerprintDigest", type: "bytes32" },
        { name: "bindingHash", type: "bytes32" },
        { name: "termsHash", type: "bytes32" },
        { name: "termsVersion", type: "uint256" },
        { name: "partyRole", type: "uint8" },
        { name: "wallet", type: "address" },
        { name: "nonce", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    },
    message: {
      dealId: UUID_BYTES32,
      fingerprintId: uuidToBytes32(FINGERPRINT_ID),
      fingerprintDigest: HEX("b"),
      bindingHash: HEX("c"),
      termsHash: HEX("d"),
      termsVersion: "3",
      partyRole: 1,
      wallet: WALLET,
      nonce: HEX("e"),
      deadline: "1794000000",
    },
  };
  const result = {
    dealId: DEAL_ID,
    partyRole: "buyer",
    walletAddress: WALLET,
    challengeId: CHALLENGE_ID,
    fingerprintId: FINGERPRINT_ID,
    fingerprintDigest: HEX("b"),
    bindingHash: HEX("c"),
    termsHash: HEX("d"),
    termsVersion: "3",
    typedData,
    ...overrides,
  };
  return { ok: true, result: { ...result, ...(overrides.typedData ? { typedData: overrides.typedData } : {}) } };
}

function acceptedResponse(overrides = {}) {
  return {
    ok: true,
    result: {
      dealId: DEAL_ID,
      partyRole: "buyer",
      termsVersion: "3",
      acceptanceId: ACCEPTANCE_ID,
      idempotentReplay: false,
      ...overrides,
    },
  };
}

Deno.test("EIP-712 client completes prepare, wallet signing, and acceptance with exact bindings", async () => {
  const calls = [];
  let signed;
  const result = await signAndSubmitW3MDealAgreement({
    dealId: DEAL_ID,
    accessToken: "isolated-test-session",
    walletAddress: WALLET,
    request: async (body, token) => {
      calls.push({ body, token });
      if (body.action === "prepare") return preparedResponse();
      if (body.action === "accept") return acceptedResponse();
      throw new Error("Unexpected request action");
    },
    signTypedData: async (address, typedData) => {
      signed = { address, typedData };
      return SIGNATURE;
    },
  });
  assertEquals(calls.map((call) => call.body.action), ["prepare", "accept"]);
  assertEquals(calls[0].body, { action: "prepare", deal_id: DEAL_ID, wallet_address: WALLET });
  assertEquals(calls[1].body, {
    action: "accept", deal_id: DEAL_ID, challenge_id: CHALLENGE_ID, signature: SIGNATURE,
  });
  assertEquals(calls.every((call) => call.token === "isolated-test-session"), true);
  assertEquals(signed.address, WALLET);
  assertEquals(signed.typedData.message.termsHash, HEX("d"));
  assertEquals(result, {
    dealId: DEAL_ID,
    partyRole: "buyer",
    termsVersion: "3",
    acceptanceId: ACCEPTANCE_ID,
    idempotentReplay: false,
  });
});

Deno.test("EIP-712 client never asks the wallet to sign when published terms are absent", async () => {
  let signCalls = 0;
  await assertRejects(() => signAndSubmitW3MDealAgreement({
    dealId: DEAL_ID,
    accessToken: "isolated-test-session",
    walletAddress: WALLET,
    request: async () => ({ ok: false, error: "No published V1 acquisition terms exist for this deal." }),
    signTypedData: async () => { signCalls++; return SIGNATURE; },
  }));
  assertEquals(signCalls, 0);
});

Deno.test("EIP-712 client rejects a prepared wallet that differs from the verified account before signing", async () => {
  let signCalls = 0;
  const wrongWallet = "0x" + "2".repeat(40);
  await assertRejects(() => signAndSubmitW3MDealAgreement({
    dealId: DEAL_ID,
    accessToken: "isolated-test-session",
    walletAddress: WALLET,
    request: async () => {
      const response = preparedResponse();
      response.result.walletAddress = wrongWallet;
      return response;
    },
    signTypedData: async () => { signCalls++; return SIGNATURE; },
  }));
  assertEquals(signCalls, 0);
});

Deno.test("EIP-712 client rejects a typed-data terms hash substitution before signing", async () => {
  let signCalls = 0;
  const response = preparedResponse();
  response.result.typedData.message.termsHash = HEX("f");
  await assertRejects(() => signAndSubmitW3MDealAgreement({
    dealId: DEAL_ID,
    accessToken: "isolated-test-session",
    walletAddress: WALLET,
    request: async () => response,
    signTypedData: async () => { signCalls++; return SIGNATURE; },
  }));
  assertEquals(signCalls, 0);
});

Deno.test("EIP-712 client rejects malformed wallet signatures and does not submit acceptance", async () => {
  const actions = [];
  await assertRejects(() => signAndSubmitW3MDealAgreement({
    dealId: DEAL_ID,
    accessToken: "isolated-test-session",
    walletAddress: WALLET,
    request: async (body) => {
      actions.push(body.action);
      return body.action === "prepare" ? preparedResponse() : acceptedResponse();
    },
    signTypedData: async () => "0x1234",
  }));
  assertEquals(actions, ["prepare"]);
});

Deno.test("EIP-712 client rejects acceptance results for another deal, role, or terms version", async () => {
  for (const mutation of [
    { dealId: "72000000-0000-4000-8000-000000000002" },
    { partyRole: "seller" },
    { termsVersion: "4" },
  ]) {
    await assertRejects(() => signAndSubmitW3MDealAgreement({
      dealId: DEAL_ID,
      accessToken: "isolated-test-session",
      walletAddress: WALLET,
      request: async (body) => body.action === "prepare"
        ? preparedResponse()
        : acceptedResponse(mutation),
      signTypedData: async () => SIGNATURE,
    }));
  }
});

Deno.test("EIP-712 client rejects missing authentication, invalid wallet, and malformed deal identifiers", async () => {
  const base = {
    dealId: DEAL_ID,
    accessToken: "isolated-test-session",
    walletAddress: WALLET,
    request: async () => preparedResponse(),
    signTypedData: async () => SIGNATURE,
  };
  await assertRejects(() => signAndSubmitW3MDealAgreement({ ...base, accessToken: "" }));
  await assertRejects(() => signAndSubmitW3MDealAgreement({ ...base, walletAddress: "not-a-wallet" }));
  await assertRejects(() => signAndSubmitW3MDealAgreement({ ...base, dealId: "not-a-deal" }));
});
