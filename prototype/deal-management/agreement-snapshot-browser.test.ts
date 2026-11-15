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
