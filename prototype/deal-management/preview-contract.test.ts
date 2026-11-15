import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.14";

const preview = await Deno.readTextFile("deal-management-preview.html");

Deno.test("preview buyer review is generated from every selected deal asset", () => {
  assertStringIncludes(preview, 'id="buyerAssetReviewList"');
  assertStringIncludes(preview, "querySelectorAll('#assets input[data-asset]:checked')");
  assertStringIncludes(preview, "assets.every(x=>buyerAccepted[x.id]===true)");
  assertStringIncludes(preview, "buyerAccepted={};buyerRejectedAssetId=null");
  assertEquals(preview.includes('id="acceptRepo"'), false);
  assertEquals(preview.includes('id="acceptDomain"'), false);
  assertEquals(preview.includes('id="rejectRepo"'), false);
  assertEquals(preview.includes("function inferDemoActor"), false);
  assertEquals(preview.includes("function classifyActivity"), false);
  assertStringIncludes(preview, "if(!actorRole||!type)");
});
