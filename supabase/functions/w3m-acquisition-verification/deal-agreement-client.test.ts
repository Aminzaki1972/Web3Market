import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { getW3MDealAgreementStatus, signAndSubmitW3MDealAgreement } from "../../../js/w3m-deal-agreement-client.js";

const dealId = "71000000-0000-4000-8000-000000000001";
const wallet = "0x5555555555555555555555555555555555555555";
const signature = "0x" + "a".repeat(130);
const bytes32 = (digit: string) => "0x" + digit.repeat(64);
function prepared(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    result: {
      dealId, partyRole: "buyer", partyId: "73000000-0000-4000-8000-000000000003",
      walletAddress: wallet, fingerprintId: "74000000-0000-4000-8000-000000000004",
      fingerprintDigest: "1".repeat(64), bindingHash: "3".repeat(64),
      termsHash: "2".repeat(64), termsVersion: "3",
      termsVersionId: "75000000-0000-4000-8000-000000000005",
      challengeId: "77000000-0000-4000-8000-000000000007",
      typedData: {
        domain: { name: "Web3Market Deal Agreement", version: "1", chainId: 56 },
        primaryType: "DealTermsAcceptance",
        types: { DealTermsAcceptance: [
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
        ] },
        message: {
          dealId: "0x" + "71000000000040008000000000000001".padStart(64, "0"),
          fingerprintId: "0x" + "74000000000040008000000000000004".padStart(64, "0"), fingerprintDigest: bytes32("1"),
          bindingHash: bytes32("3"), termsHash: bytes32("2"), termsVersion: "3",
          partyRole: 1, wallet, nonce: bytes32("4"), deadline: "1800000300",
        },
      },
      ...overrides,
    },
  };
}
async function runClient(
  request: (body: object, token: string) => Promise<unknown>,
  sign: (address: string, typedData: object) => Promise<string> = async () => signature,
) {
  return signAndSubmitW3MDealAgreement({
    dealId, accessToken: "session", walletAddress: wallet, request,
    signTypedData: sign,
  });
}
Deno.test("client requests exact terms, signs with verified connected wallet, then submits signature", async () => {
  const calls: unknown[] = [];
  const result = await runClient(async (body, token) => {
    calls.push({ body, token });
    return (body as {action:string}).action === "prepare" ? prepared() : {
      ok: true, result: { dealId, partyRole: "buyer", termsVersion: "3",
        acceptanceId: "76000000-0000-4000-8000-000000000006", idempotentReplay: false },
    };
  }, async (address, typedData) => {
    assertEquals(address, wallet);
    assertEquals((typedData as {domain:{chainId:number}}).domain.chainId, 56);
    return signature;
  });
  assertEquals(result.partyRole, "buyer");
  assertEquals(result.termsVersion, "3");
  assertEquals(calls.length, 2);
  assertEquals(calls[0], { body: { action: "prepare", deal_id: dealId, wallet_address: wallet }, token: "session" });
  assertEquals(calls[1], { body: { action: "accept", deal_id: dealId, challenge_id: "77000000-0000-4000-8000-000000000007", signature }, token: "session" });
});
Deno.test("client refuses to sign if connected wallet differs from server verified wallet", async () => {
  let signed = false;
  await assertRejects(() => signAndSubmitW3MDealAgreement({
    dealId, accessToken: "session", walletAddress: "0x6666666666666666666666666666666666666666",
    request: async () => prepared(),
    signTypedData: async () => { signed = true; return signature; },
  }));
  assertEquals(signed, false);
});
Deno.test("client refuses a typed-data domain, role, or schema substitution", async () => {
  const badResponses = [
    prepared({ typedData: { ...prepared().result.typedData,
      domain: { name: "Attacker", version: "1", chainId: 56 } } }),
    prepared({ typedData: { ...prepared().result.typedData,
      message: { ...prepared().result.typedData.message, partyRole: 2 } } }),
    prepared({ typedData: { ...prepared().result.typedData,
      types: { DealTermsAcceptance: [] } } }),
    prepared({ typedData: { ...prepared().result.typedData,
      domain: { ...prepared().result.typedData.domain, verifyingContract: wallet } } }),
  ];
  for (const response of badResponses) {
    let signed = false;
    await assertRejects(() => runClient(async () => response, async () => {
      signed = true; return signature;
    }));
    assertEquals(signed, false);
  }
});
Deno.test("client refuses incomplete or mismatched evidence and terms bindings", async () => {
  const base = prepared().result.typedData;
  const badMessages = [
    { ...base.message, fingerprintId: undefined },
    { ...base.message, fingerprintId: bytes32("f") },
    { ...base.message, fingerprintDigest: bytes32("f") },
    { ...base.message, bindingHash: bytes32("f") },
    { ...base.message, bindingHash: undefined },
    { ...base.message, termsHash: bytes32("f") },
    { ...base.message, wallet: "0x6666666666666666666666666666666666666666" },
    { ...base.message, nonce: "bad" },
    { ...base.message, deadline: "0" },
  ];
  for (const message of badMessages) {
    let signed = false;
    await assertRejects(() => runClient(async () => prepared({
      typedData: { ...base, message },
    }), async () => { signed = true; return signature; }));
    assertEquals(signed, false);
  }
});
Deno.test("client rejects acceptance for changed terms version after signing", async () => {
  await assertRejects(() => runClient(async (body) =>
    (body as {action:string}).action === "prepare" ? prepared() : ({
      ok: true, result: { dealId, partyRole: "buyer", termsVersion: "4",
        acceptanceId: "76000000-0000-4000-8000-000000000006", idempotentReplay: false },
    })));
});
Deno.test("client never submits a malformed wallet signature", async () => {
  let submits = 0;
  await assertRejects(() => runClient(async (body) => {
    if ((body as {action:string}).action === "prepare") return prepared();
    submits++; return {};
  }, async () => "0x1234"));
  assertEquals(submits, 0);
});

Deno.test("status client requests the authenticated participant view and validates exact deal", async () => {
  const calls: unknown[] = [];
  const result = await getW3MDealAgreementStatus({
    dealId, accessToken: "session",
    request: async (body, token) => {
      calls.push({ body, token });
      return {
        ok: true,
        result: {
          deal_id: dealId,
          current_terms: {
            terms_version: "3", terms_hash: "a".repeat(64),
            canonical_terms: { schema: "w3m-acquisition-terms-v1", terms_version: 3 },
          },
          acceptances: {
            buyer: { accepted: true, accepted_at: "2026-11-07T01:00:00Z" },
            seller: { accepted: false },
          },
          assets: [{
            asset_id: "79000000-0000-4000-8000-000000000009",
            asset_name: "repository: Source code", status: "delivered",
            delivery_url: "https://example.invalid/repo", delivered_at: "2026-11-07T02:00:00Z",
            accepted_at: null,
            events: [{
              event_type: "delivered", attempt_number: 1,
              evidence_digest: "d".repeat(64), occurred_at: "2026-11-07T02:00:00Z",
            }],
          }],
          assets: [{ asset_id: "79000000-0000-4000-8000-000000000009", asset_name: "repository: Source code", status: "delivered", delivery_url: "https://example.invalid/repo", delivered_at: "2026-11-07T02:00:00Z", accepted_at: null, events: [{ event_type: "delivered", attempt_number: 1, evidence_digest: "d".repeat(64), occurred_at: "2026-11-07T02:00:00Z" }] }],
          both_accepted: false, deal_eligible: true,
        },
      };
    },
  });
  assertEquals(calls, [{ body: { action: "status", deal_id: dealId }, token: "session" }]);
  assertEquals(result.bothAccepted, false);
  assertEquals(result.acceptances.buyer.accepted, true);
  assertEquals(result.acceptances.seller.accepted, false);
  assertEquals(result.currentTerms.terms_hash, "a".repeat(64));
  assertEquals(result.assets.length, 1);
  assertEquals(result.assets[0].assetName, "repository: Source code");
  assertEquals(result.assets[0].events[0].evidenceDigest, "d".repeat(64));
  assertEquals(result.assets.length, 1);
  assertEquals(result.assets[0].assetName, "repository: Source code");
  assertEquals(result.assets[0].events[0].evidenceDigest, "d".repeat(64));
});
Deno.test("status client rejects cross-deal and malformed acceptance responses", async () => {
  await assertRejects(() => getW3MDealAgreementStatus({
    dealId, accessToken: "session",
    request: async () => ({ ok: true, result: {
      deal_id: "71000000-0000-4000-8000-000000000099",
      current_terms: null,
      acceptances: { buyer: { accepted: false }, seller: { accepted: false } },
      both_accepted: false, deal_eligible: true,
    } }),
  }));
  await assertRejects(() => getW3MDealAgreementStatus({
    dealId, accessToken: "session",
    request: async () => ({ ok: true, result: {
      deal_id: dealId, current_terms: null,
      acceptances: { buyer: { accepted: "yes" }, seller: { accepted: false } },
      both_accepted: false, deal_eligible: true,
    } }),
  }));
});
