import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.14";

const preview = await Deno.readTextFile("deal-management-preview.html");

Deno.test("preview buyer review is generated from every selected deal asset", () => {
  assertStringIncludes(preview, 'id="buyerAssetReviewList"');
  assertStringIncludes(preview, "querySelectorAll('#assets input[data-asset]:checked')");
  assertStringIncludes(preview, "assets.every(x=>buyerAccepted[x.id]===true)");
  assertStringIncludes(preview, "buyerAccepted={};buyerRejectedAssets={};buyerRejectedReasons={}");
  assertEquals(preview.includes('id="acceptRepo"'), false);
  assertEquals(preview.includes('id="acceptDomain"'), false);
  assertEquals(preview.includes('id="rejectRepo"'), false);
  assertEquals(preview.includes("function inferDemoActor"), false);
  assertEquals(preview.includes("function classifyActivity"), false);
  assertStringIncludes(preview, "if(!actorRole||!type)");
  assertStringIncludes(preview, "buyerRejectedAssets[asset.id]=true");
  assertStringIncludes(preview, "assets.some(x=>buyerRejectedAssets[x.id]===true)");
});

Deno.test("dispute preview requires claimant evidence and models respondent response deadline", () => {
  assertStringIncludes(preview, 'id="disputeInitialEvidence"');
  assertStringIncludes(preview, 'id="disputeRespondentEvidence"');
  assertStringIncludes(preview, 'id="submitRespondentEvidence"');
  assertStringIncludes(preview, 'id="markResponseExpired"');
  assertStringIncludes(preview, "disputeLifecycle.responseDeadline");
  assertStringIncludes(preview, "disputeLifecycle.status='response_received'");
  assertStringIncludes(preview, "disputeLifecycle.status='response_expired'");
  assertStringIncludes(preview, "The agreed response deadline has not expired yet.");
  assertStringIncludes(preview, "Safe lock is NOT verified or claimed.");
});

Deno.test("dispute decision preview enforces reason, six-decimal fee and balanced allocation", () => {
  assertStringIncludes(preview, 'id="disputeDecisionReason"');
  assertStringIncludes(preview, 'id="buyerGrossRefund"');
  assertStringIncludes(preview, 'id="sellerPayout"');
  assertStringIncludes(preview, "function parseUsdtUnits(value)");
  assertStringIncludes(preview, "const platformFee=gross*750n/10000n");
  assertStringIncludes(preview, "buyerGrossRefund<platformFee");
  assertStringIncludes(preview, "buyerGrossRefund+sellerPayout!==gross");
  assertStringIncludes(preview, "disputeLifecycle.decision={reason,buyerGrossRefund,sellerPayout,platformFee,decidedAt:Date.now()}");
  assertStringIncludes(preview, "Safe execution is not connected.");
  assertStringIncludes(preview, "recalc();renderDisputeLifecycle();log('Demo deposit state toggled");
});
