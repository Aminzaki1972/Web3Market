import { assertEquals } from "jsr:@std/assert@1.0.14";
import { handleW3MSafeVerify } from "../w3m-safe-verify/index.ts";

Deno.test("Safe verifier answers CORS preflight without touching services", async () => {
  const response = await handleW3MSafeVerify(new Request("https://local.test", { method: "OPTIONS" }));
  assertEquals(response.status, 204);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "https://web3market.xyz");
  assertEquals(response.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
});

Deno.test("Safe verifier rejects non-POST methods before authentication", async () => {
  const response = await handleW3MSafeVerify(new Request("https://local.test", { method: "GET" }));
  assertEquals(response.status, 405);
  assertEquals((await response.json()).reason, "method_not_allowed");
});

Deno.test("Safe verifier fails closed when Authorization is absent", async () => {
  const response = await handleW3MSafeVerify(new Request("https://local.test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deal_id: "00000000-0000-4000-8000-000000000001" }),
  }));
  assertEquals(response.status, 401);
  assertEquals((await response.json()).reason, "authentication_required");
});

Deno.test("Safe verifier rejects malformed JSON before service initialization", async () => {
  const response = await handleW3MSafeVerify(new Request("https://local.test", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: "{",
  }));
  assertEquals(response.status, 400);
  assertEquals((await response.json()).reason, "invalid_deal_id");
});

Deno.test("Safe verifier rejects a missing deal ID before service initialization", async () => {
  const response = await handleW3MSafeVerify(new Request("https://local.test", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }));
  assertEquals(response.status, 400);
  assertEquals((await response.json()).reason, "invalid_deal_id");
});

Deno.test("Safe verifier rejects a malformed deal ID before service initialization", async () => {
  const response = await handleW3MSafeVerify(new Request("https://local.test", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ deal_id: "not-a-uuid" }),
  }));
  assertEquals(response.status, 400);
  assertEquals((await response.json()).reason, "invalid_deal_id");
});
