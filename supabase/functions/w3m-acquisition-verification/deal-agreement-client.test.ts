import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { signAndSubmitW3MDealAgreement } from "../../../js/w3m-deal-agreement-client.js";
const dealId = "71000000-0000-4000-8000-000000000001";
const wallet = "0x5555555555555555555555555555555555555555";
const signature = "0x" + "a".repeat(130);
const types = {
  EIP712Domain: [
    { name: "name", type: "string" }, { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
  ],
  DealTermsAcceptance: [
    { name: "dealId", type: "bytes32" }, { name: "projectId", type: "bytes32" },
    { name: "buyerId", type: "bytes32" }, { name: "sellerId", type: "bytes32" },
    { name: "safeAddress", type: "address" }, { name: "termsHash", type: "bytes32" },
    { name: "termsVersion", type: "uint256" }, { name: "partyRole", type: "uint8" },
  ],
};
function prepared(overrides: Record<string, unknown> = {}) {
  return { ok: true, result: {
    dealId, partyRole: "buyer", walletAddress: wallet, termsHash: "2".repeat(64), termsVersion: "3",
    canonicalTerms: { dealId, amount: "100", currency: "USDT", feePercent: "7.5", sellerNetAmount: "92.5" },
    typedData: { domain: { name: "Web3Market Deal Agreement", version: "1", chainId: 56 },
      primaryType: "DealTermsAcceptance", types,
      message: { dealId: "0x" + "1".repeat(64), projectId: "0x" + "3".repeat(64),
        buyerId: "0x" + "4".repeat(64), sellerId: "0x" + "5".repeat(64),
        safeAddress: "0x2222222222222222222222222222222222222222",
        termsHash: "0x" + "2".repeat(64), termsVersion: "3", partyRole: 1 } },
    ...overrides,
  }};
}
Deno.test("client requests, signs with the verified connected wallet, and submits the signature", async () => {
  const calls: unknown[] = [];
  const result = await signAndSubmitW3MDealAgreement({ dealId, accessToken: "session", walletAddress: wallet,
    reviewTerms: async () => true, request: async (body: unknown, token: string) => { calls.push({body,token});
      return (body as {mode:string}).mode === "prepare" ? prepared() : { ok:true, result:{
        dealId,partyRole:"buyer",termsVersion:"3",acceptanceId:"76000000-0000-4000-8000-000000000006",idempotentReplay:false } }; },
    signTypedData: async (address: string, typedData: unknown) => { assertEquals(address,wallet);
      assertEquals((typedData as {domain:{chainId:number}}).domain.chainId,56); return signature; },
  });
  assertEquals(result.partyRole,"buyer"); assertEquals(result.termsVersion,"3"); assertEquals(calls.length,2);
});
Deno.test("client refuses to sign if connected wallet differs from server verified wallet", async () => {
  let signed=false;
  await assertRejects(()=>signAndSubmitW3MDealAgreement({dealId,accessToken:"session",
    walletAddress:"0x6666666666666666666666666666666666666666",
    reviewTerms: async () => true, request:async()=>prepared(),signTypedData:async()=>{signed=true;return signature;}}));
  assertEquals(signed,false);
});
Deno.test("client rejects a substituted EIP-712 domain", async () => {
  await assertRejects(()=>signAndSubmitW3MDealAgreement({dealId,accessToken:"session",walletAddress:wallet,
    reviewTerms: async () => true, request:async()=>prepared({typedData:{...prepared().result.typedData,domain:{name:"Attacker",version:"1",chainId:56}}}),
    signTypedData:async()=>signature}));
});
Deno.test("client rejects changed terms hash before requesting a wallet signature", async () => {
  let signed=false;
  const altered=prepared();
  altered.result.typedData.message.termsHash="0x"+"9".repeat(64);
  await assertRejects(()=>signAndSubmitW3MDealAgreement({dealId,accessToken:"session",walletAddress:wallet,
    reviewTerms: async () => true, request:async()=>altered,signTypedData:async()=>{signed=true;return signature;}}));
  assertEquals(signed,false);
});
Deno.test("client rejects a substituted typed-data field schema", async () => {
  let signed=false;
  const altered=prepared();
  altered.result.typedData.types.DealTermsAcceptance=types.DealTermsAcceptance.slice(0,7);
  await assertRejects(()=>signAndSubmitW3MDealAgreement({dealId,accessToken:"session",walletAddress:wallet,
    reviewTerms: async () => true, request:async()=>altered,signTypedData:async()=>{signed=true;return signature;}}));
  assertEquals(signed,false);
});
Deno.test("client rejects acceptance for a changed terms version", async () => {
  await assertRejects(()=>signAndSubmitW3MDealAgreement({dealId,accessToken:"session",walletAddress:wallet,
    reviewTerms: async () => true, request:async(body:unknown)=>(body as {mode:string}).mode==="prepare"?prepared():{ok:true,result:{
      dealId,partyRole:"buyer",termsVersion:"4",acceptanceId:"76000000-0000-4000-8000-000000000006",idempotentReplay:false}},
    signTypedData:async()=>signature}));
});
Deno.test("client rejects a malformed acceptance identifier", async () => {
  await assertRejects(()=>signAndSubmitW3MDealAgreement({dealId,accessToken:"session",walletAddress:wallet,
    reviewTerms: async () => true, request:async(body:unknown)=>(body as {mode:string}).mode==="prepare"?prepared():{ok:true,result:{
      dealId,partyRole:"buyer",termsVersion:"3",acceptanceId:"not-a-uuid",idempotentReplay:false}},
    signTypedData:async()=>signature}));
});
Deno.test("client never submits a malformed wallet signature", async () => {
  let submits=0;
  await assertRejects(()=>signAndSubmitW3MDealAgreement({dealId,accessToken:"session",walletAddress:wallet,
    reviewTerms: async () => true, request:async(body:unknown)=>{if((body as {mode:string}).mode==="prepare")return prepared();submits++;return {};},
    signTypedData:async()=>"0x1234"}));
  assertEquals(submits,0);
});

Deno.test("client requires explicit review of canonical terms before requesting wallet signature", async () => {
  let signed = false;
  const reviewed: Array<Record<string, unknown>> = [];
  await assertRejects(() => signAndSubmitW3MDealAgreement({
    dealId, accessToken: "session", walletAddress: wallet,
    request: async () => prepared(),
    reviewTerms: async (value: Record<string, unknown>) => { reviewed.push(value); return false; },
    signTypedData: async () => { signed = true; return signature; },
  }));
  assertEquals(signed, false);
  assertEquals((reviewed[0].canonicalTerms as Record<string, unknown>).feePercent, "7.5");
});
