import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { signAndSubmitW3MDealAgreement } from "../../../js/w3m-deal-agreement-client.js";

const dealId = "71000000-0000-4000-8000-000000000001";
const wallet = "0x5555555555555555555555555555555555555555";
const safeAddress = "0x7777777777777777777777777777777777777777";
const signature = "0x" + "a".repeat(130);
const documentText = "Web3Market approved Arabic deal agreement. ".repeat(40);

function stableCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableCanonicalValue);
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = stableCanonicalValue((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function prepared(overrides: Record<string, unknown> = {}) {
  const documentHash = await sha256Hex(documentText);
  const canonicalTerms = {
    dealId,
    amount: "100.00",
    currency: "USDT",
    agreementDocument: {
      documentId: "W3M-AGREEMENT",
      version: "1.0",
      locale: "ar",
      sha256: documentHash,
    },
  };
  const termsHash = await sha256Hex(JSON.stringify(stableCanonicalValue(canonicalTerms)));
  const typedData = {
    domain: { name: "Web3Market Deal Agreement", version: "1", chainId: 56 },
    primaryType: "DealTermsAcceptance",
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      DealTermsAcceptance: [
        { name: "dealId", type: "bytes32" },
        { name: "projectId", type: "bytes32" },
        { name: "buyerId", type: "bytes32" },
        { name: "sellerId", type: "bytes32" },
        { name: "safeAddress", type: "address" },
        { name: "termsHash", type: "bytes32" },
        { name: "agreementDocumentVersion", type: "string" },
        { name: "agreementDocumentHash", type: "bytes32" },
        { name: "termsVersion", type: "uint256" },
        { name: "partyRole", type: "uint8" },
      ],
    },
    message: {
      dealId: "0x" + "1".repeat(64),
      projectId: "0x" + "2".repeat(64),
      buyerId: "0x" + "3".repeat(64),
      sellerId: "0x" + "4".repeat(64),
      safeAddress,
      termsHash: "0x" + termsHash,
      agreementDocumentVersion: "1.0",
      agreementDocumentHash: "0x" + documentHash,
      termsVersion: "3",
      partyRole: 1,
    },
  };
  return {
    ok: true,
    result: {
      dealId,
      partyRole: "buyer",
      partyId: "73000000-0000-4000-8000-000000000003",
      walletAddress: wallet,
      safeAddress,
      termsHash,
      termsVersion: "3",
      termsVersionId: "75000000-0000-4000-8000-000000000005",
      canonicalTerms,
      agreementDocument: {
        documentId: "W3M-AGREEMENT",
        version: "1.0",
        locale: "ar",
        sha256: documentHash,
        text: documentText,
      },
      typedData,
      ...overrides,
    },
  };
}

const acceptReview = async (_review: Record<string, unknown>) => true;

Deno.test("client requests exact terms, reviews them, signs with verified connected wallet, then submits signature", async () => {
  const calls: unknown[] = [];
  const result = await signAndSubmitW3MDealAgreement({
    dealId, accessToken: "session", walletAddress: wallet,
    request: async (body: Record<string, unknown>, token: string) => {
      calls.push({ body, token });
      return (body as {mode:string}).mode === "prepare" ? prepared() : {
        ok: true, result: { dealId, partyRole: "buyer", termsVersion: "3",
          acceptanceId: "76000000-0000-4000-8000-000000000006", idempotentReplay: false },
      };
    },
    reviewTerms: acceptReview,
    signTypedData: async (address: string, typedData: Record<string, unknown>) => {
      assertEquals(address, wallet);
      assertEquals((typedData as {domain:{chainId:number}}).domain.chainId, 56);
      return signature;
    },
  });
  assertEquals(result.partyRole, "buyer");
  assertEquals(result.termsVersion, "3");
  assertEquals(calls.length, 2);
  assertEquals(calls[0], { body: { mode: "prepare", deal_id: dealId }, token: "session" });
  assertEquals(calls[1], { body: { mode: "accept", deal_id: dealId, signature }, token: "session" });
});

Deno.test("client refuses to sign if connected wallet differs from server verified wallet", async () => {
  let signed = false;
  await assertRejects(() => signAndSubmitW3MDealAgreement({
    dealId, accessToken: "session", walletAddress: "0x6666666666666666666666666666666666666666",
    request: async () => prepared(),
    reviewTerms: acceptReview,
    signTypedData: async () => { signed = true; return signature; },
  }));
  assertEquals(signed, false);
});

Deno.test("client refuses a typed-data domain or party-role substitution", async () => {
  await assertRejects(() => signAndSubmitW3MDealAgreement({
    dealId, accessToken: "session", walletAddress: wallet,
    request: async () => {
      const value = await prepared();
      return {
        ...value,
        result: {
          ...value.result,
          typedData: {
            ...value.result.typedData,
            domain: { name: "Attacker", version: "1", chainId: 56 },
          },
        },
      };
    },
    reviewTerms: acceptReview,
    signTypedData: async () => signature,
  }));
});

Deno.test("client rejects acceptance for changed terms version after signing", async () => {
  await assertRejects(() => signAndSubmitW3MDealAgreement({
    dealId, accessToken: "session", walletAddress: wallet,
    request: async (body: Record<string, unknown>) => (body as {mode:string}).mode === "prepare" ? prepared() : ({
      ok: true, result: { dealId, partyRole: "buyer", termsVersion: "4",
        acceptanceId: "76000000-0000-4000-8000-000000000006", idempotentReplay: false },
    }),
    reviewTerms: acceptReview,
    signTypedData: async () => signature,
  }));
});

Deno.test("client never submits a malformed wallet signature", async () => {
  let submits = 0;
  await assertRejects(() => signAndSubmitW3MDealAgreement({
    dealId, accessToken: "session", walletAddress: wallet,
    request: async (body: Record<string, unknown>) => {
      if ((body as {mode:string}).mode === "prepare") return prepared();
      submits++; return {};
    },
    reviewTerms: acceptReview,
    signTypedData: async () => "0x1234",
  }));
  assertEquals(submits, 0);
});
