import { assert, assertStringIncludes } from "jsr:@std/assert@1";

Deno.test("Deal Room never treats a timestamp-only row as agreement acceptance", async () => {
  const source = await Deno.readTextFile("js/deal-room.js");
  const start = source.indexOf(" async function renderTerms(){");
  const end = source.indexOf(" // Keep dispute input bounded", start);
  if (start < 0 || end < 0) throw new Error("renderTerms block could not be located");
  const renderTerms = source.slice(start, end);

  assert(!source.includes("deal_party_agreements"));
  assert(!source.includes("loadAgreement"));
  assertStringIncludes(renderTerms, "Immutable EIP-712 deal agreement");
  assertStringIncludes(renderTerms, "showCanonicalAgreementReview");
  assertStringIncludes(renderTerms, "signAndSubmitW3MDealAgreement");
  assertStringIncludes(renderTerms, "import('/js/w3m-deal-agreement-client.js')");
  assertStringIncludes(renderTerms, "sb.auth.getSession()");
  assertStringIncludes(renderTerms, "sb.functions.invoke('w3m-protocol-v1-deal-agreement'");
  assertStringIncludes(renderTerms, "reviewTerms:showCanonicalAgreementReview");
  assertStringIncludes(renderTerms, "signTypedData:async(walletAddress,typedData)");
  assertStringIncludes(renderTerms, "signer.signTypedData(typedData.domain,types,typedData.message)");
  assertStringIncludes(renderTerms, "canonicalWalletVerified");
  assertStringIncludes(renderTerms, "network.chainId)!==56");

  assert(!renderTerms.includes("deal_party_agreements"));
  assert(!/\.agreed_at\b|['"]agreed_at['"]/.test(renderTerms));
  assert(!renderTerms.includes("agreeBtn"));
  assert(renderTerms.includes("openDisputeModal()"));
});

Deno.test("Deal Room opens disputes through the atomic authenticated RPC", async () => {
  const source = await Deno.readTextFile("js/deal-room.js");
  const start = source.indexOf(" async function openDisputeModal(){");
  const end = source.indexOf(" renderDealWalletState();", start);
  if (start < 0 || end < 0) throw new Error("openDisputeModal block could not be located");
  const dispute = source.slice(start, end);

  assertStringIncludes(dispute, "sb.rpc('open_deal_dispute'");
  assert(!dispute.includes("from('deal_disputes').insert"));
  assertStringIncludes(dispute, "p_deal_id:deal.id");
  assertStringIncludes(dispute, "p_reason:reason");
});
