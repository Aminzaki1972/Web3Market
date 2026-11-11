import { assertEquals } from "jsr:@std/assert@1.0.14";
import { isW3MSafeDeploymentSuccess } from "./w3m-safe-deployment-response.js";

const VALID = {
  ok: true,
  stage: "safe_deployed_and_verified",
  usdt_moved: false,
  safe_address: "0x1111111111111111111111111111111111111111",
  owners: [
    "0x2222222222222222222222222222222222222222",
    "0x3333333333333333333333333333333333333333",
    "0x4444444444444444444444444444444444444444",
  ],
  threshold: 2,
};

Deno.test("accepts verified create-safe response contract", () => {
  assertEquals(isW3MSafeDeploymentSuccess(VALID), true);
});

Deno.test("rejects legacy success field without verified response metadata", () => {
  assertEquals(isW3MSafeDeploymentSuccess({ success: true }), false);
});

Deno.test("rejects ok response without verified deployment stage", () => {
  assertEquals(isW3MSafeDeploymentSuccess({ ...VALID, stage: "submitted" }), false);
});

Deno.test("rejects response that does not explicitly guarantee no USDT movement", () => {
  assertEquals(isW3MSafeDeploymentSuccess({ ...VALID, usdt_moved: true }), false);
});

Deno.test("rejects non-2-of-3 or malformed Safe owner configuration", () => {
  assertEquals(isW3MSafeDeploymentSuccess({ ...VALID, threshold: 1 }), false);
  assertEquals(isW3MSafeDeploymentSuccess({ ...VALID, owners: VALID.owners.slice(0, 2) }), false);
  assertEquals(isW3MSafeDeploymentSuccess({ ...VALID, safe_address: "invalid" }), false);
});
