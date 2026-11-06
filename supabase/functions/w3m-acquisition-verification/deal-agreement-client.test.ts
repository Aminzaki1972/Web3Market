import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { signAndSubmitW3MDealAgreement } from "../../../js/w3m-deal-agreement-client.js";
const dealId = "71000000-0000-4000-8000-000000000001";
const wallet = "0x5555555555555555555555555555555555555555";
const signature = "0x" + "a".repeat(130);
function prepared(overrides: Record<string, unknown> = {}) {
  return { ok: true, result: {
    dealId, partyRole: "buyer", walletAddress: wallet, termsHash: "a".repeat(64), termsVersion: "3",
    typedData: { domain: { name: "Web3Market Deal Agreement", version: "1", chainId: 56 },
      primaryType: "DealTermsAcceptance", types: { EIP712Domain: [], DealTermsAcceptance: [] },
      message: { dealId: "0x" + "1".repeat(64), termsHash: "0x" + "2".repeat(64), termsVersion: "3", partyRole: 1 } },
    ...overrides,
  }};
}
Deno.test("client requests, signs with the verified connected wallet, and submits the signature", async () => {
  const calls: unknown[] = [];
  const result = await signAndSubmitW3MDealAgreement({ dealId, accessToken: "session", walletAddress: wallet,
    request: async (body: unknown, token: string) => { calls.push({body,token});
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
    request:async()=>prepared(),signTypedData:async()=>{signed=true;return signature;}}));
  assertEquals(signed,false);
});
Deno.test("client rejects a substituted EIP-712 domain", async () => {
  await assertRejects(()=>signAndSubmitW3MDealAgreement({dealId,accessToken:"session",walletAddress:wallet,
    request:async()=>prepared({typedData:{...prepared().result.typedData,domain:{name:"Attacker",version:"1",chainId:56}}}),
    signTypedData:async()=>signature}));
});
Deno.test("client rejects acceptance for a changed terms version", async () => {
  await assertRejects(()=>signAndSubmitW3MDealAgreement({dealId,accessToken:"session",walletAddress:wallet,
    request:async(body:unknown)=>(body as {mode:string}).mode==="prepare"?prepared():{ok:true,result:{
      dealId,partyRole:"buyer",termsVersion:"4",acceptanceId:"76000000-0000-4000-8000-000000000006",idempotentReplay:false}},
    signTypedData:async()=>signature}));
});
Deno.test("client never submits a malformed wallet signature", async () => {
  let submits=0;
  await assertRejects(()=>signAndSubmitW3MDealAgreement({dealId,accessToken:"session",walletAddress:wallet,
    request:async(body:unknown)=>{if((body as {mode:string}).mode==="prepare")return prepared();submits++;return {};},
    signTypedData:async()=>"0x1234"}));
  assertEquals(submits,0);
});
