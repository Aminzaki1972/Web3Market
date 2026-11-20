import { buildAppJwtClaims } from "./github-app.ts";

Deno.test("GitHub App JWT claims use a short lifetime and clock-skew allowance", () => {
  const now = 1_800_000_000;
  const claims = buildAppJwtClaims("5840629", now);
  if (claims.iat !== now - 60 || claims.exp !== now + 540 || claims.iss !== "5840629") {
    throw new Error("Unexpected GitHub App JWT claims.");
  }
});

Deno.test("GitHub App ID must be numeric", () => {
  let rejected = false;
  try { buildAppJwtClaims("not-an-app-id", 1_800_000_000); } catch { rejected = true; }
  if (!rejected) throw new Error("Invalid app ID was accepted.");
});

Deno.test("GitHub App JWT is signed with RS256 and carries the expected claims", async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let binary = "";
  for (const byte of pkcs8) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).match(/.{1,64}/g)?.join("\n") || "";
  const pem = "-----BEGIN PRIVATE KEY-----\n" + encoded + "\n-----END PRIVATE KEY-----";
  const now = 1_800_000_000;
  const token = await (await import("./github-app.ts")).createGitHubAppJwt("5840629", pem, now);
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("JWT must have three segments.");
  const decode = (value: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4)), (c) => c.charCodeAt(0))));
  const header = decode(parts[0]);
  const claims = decode(parts[1]);
  if (header.alg !== "RS256" || claims.iss !== "5840629" || claims.iat !== now - 60 || claims.exp !== now + 540) throw new Error("Unexpected JWT content.");
  const signature = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - parts[2].length % 4) % 4)), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pair.publicKey, signature, new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!valid) throw new Error("JWT signature did not verify.");
});
