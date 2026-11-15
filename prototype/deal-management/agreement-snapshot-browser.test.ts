import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { hashDealAgreementSnapshot } from "./agreement-snapshot-browser.js";

Deno.test("browser agreement hash is deterministic across object key order", async () => {
  const a = await hashDealAgreementSnapshot({ price: "100.000000", assets: ["repo", "domain"], terms: { b: 2, a: 1 } });
  const b = await hashDealAgreementSnapshot({ terms: { a: 1, b: 2 }, assets: ["repo", "domain"], price: "100.000000" });
  assertEquals(a.termsHash, b.termsHash);
  assertEquals(/^0x[0-9a-f]{64}$/.test(a.termsHash), true);
});
Deno.test("any changed agreement term changes the digest", async () => {
  const base = { price: "100.000000", assets: ["repo"], deadlineHours: 48, transferPlan: "transfer repo" };
  const first = await hashDealAgreementSnapshot(base);
  for (const changed of [
    { ...base, price: "101.000000" },
    { ...base, assets: ["repo", "domain"] },
    { ...base, deadlineHours: 72 },
    { ...base, transferPlan: "transfer organization" },
  ]) {
    const next = await hashDealAgreementSnapshot(changed);
    assertEquals(next.termsHash === first.termsHash, false);
  }
});
Deno.test("rejects incomplete or unsupported agreement values", async () => {
  await assertRejects(() => hashDealAgreementSnapshot([]));
  await assertRejects(() => hashDealAgreementSnapshot({ price: Number.NaN }));
});
Deno.test("deal preview binds every demo approval to the current terms fingerprint", async () => {
  const html = await Deno.readTextFile("deal-management-preview.html");
  for (const required of [
    "agreement-snapshot-browser.js",
    "function agreementTermsPayload()",
    "async function refreshAgreementHash()",
    "approvalHashes[k]===agreementHashState.termsHash",
    "result.termsHash!==current.termsHash",
    "approvalHashes={buyer:null,seller:null,platform:null}",
    "SHA-256 terms fingerprint",
    "function reviseAgreementForChange(control,description)",
    "approvalHashes={buyer:null,seller:null,platform:null};agreementHashState={canonicalJson:null,termsHash:null}",
    "document.querySelectorAll('#assets input[data-asset]').forEach(input=>input.addEventListener('change'",
    "document.querySelectorAll('#agreementTerms input,#agreementTerms textarea,#agreementTerms select').forEach",
    "approvalHashes[k]===currentFingerprint",
    "approvalHashes={buyer:null,seller:null,platform:null};agreementVersion=1",
  ]) {
    if (!html.includes(required)) throw new Error("Missing agreement fingerprint integration contract: " + required);
  }
});
Deno.test("SHA-256 output matches the standard known vector for an empty JSON object", async () => {
  const result = await hashDealAgreementSnapshot({});
  assertEquals(result.canonicalJson, "{}");
  assertEquals(result.termsHash, "0x44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
});
Deno.test("browser serializer normalizes Unicode and rejects lossy array entries", async () => {
  const composed = await hashDealAgreementSnapshot({ title: "\u00e9" });
  const decomposed = await hashDealAgreementSnapshot({ title: "e\u0301" });
  assertEquals(composed.termsHash, decomposed.termsHash);
  await assertRejects(() => hashDealAgreementSnapshot({ values: [undefined] }));
});
Deno.test("browser serializer rejects sparse arrays instead of producing malformed JSON", async () => {
  const sparse = new Array(2);
  await assertRejects(() => hashDealAgreementSnapshot({ values: sparse }));
});
