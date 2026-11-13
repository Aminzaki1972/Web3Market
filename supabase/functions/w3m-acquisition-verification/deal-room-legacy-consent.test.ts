import { assert, assertStringIncludes } from "jsr:@std/assert@1";

Deno.test("Deal Room never treats a timestamp-only row as agreement acceptance", async () => {
  const source = await Deno.readTextFile("js/deal-room.js");
  const start = source.indexOf(" async function renderTerms(){");
  const end = source.indexOf(" // Keep dispute input bounded", start);
  if (start < 0 || end < 0) throw new Error("renderTerms block could not be located");
  const renderTerms = source.slice(start, end);

  assert(!source.includes("deal_party_agreements"));
  assert(!source.includes("loadAgreement"));
  assertStringIncludes(renderTerms, "Secure agreement signature required");
  assertStringIncludes(renderTerms, "A timestamp or the old");
  assertStringIncludes(renderTerms, "No agreement acceptance is recorded from this screen.");
  assert(!renderTerms.includes("deal_party_agreements"));
  assert(!/\.agreed_at\b|['"]agreed_at['"]/.test(renderTerms));
  assert(!renderTerms.includes("agreeBtn"));
  assert(renderTerms.includes("openDisputeModal()"));
});
