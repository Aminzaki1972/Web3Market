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

  const readTlv = (bytes: Uint8Array, offset: number) => {
    const tag = bytes[offset];
    let length = bytes[offset + 1];
    let cursor = offset + 2;
    if (length & 0x80) {
      const count = length & 0x7f;
      length = 0;
      for (let index = 0; index < count; index++) length = (length << 8) | bytes[cursor++];
    }
    return { tag, start: cursor, end: cursor + length, next: cursor + length };
  };
  const outer = readTlv(pkcs8, 0);
  const versionTlv = readTlv(pkcs8, outer.start);
  const algorithmTlv = readTlv(pkcs8, versionTlv.next);
  const privateOctets = readTlv(pkcs8, algorithmTlv.next);
  if (outer.tag !== 0x30 || privateOctets.tag !== 0x04) throw new Error("Unexpected PKCS8 test-key structure.");
  const pkcs1 = pkcs8.slice(privateOctets.start, privateOctets.end);
  let rsaBinary = "";
  for (const byte of pkcs1) rsaBinary += String.fromCharCode(byte);
  const rsaPem = "-----BEGIN RSA PRIVATE KEY-----\n" + (btoa(rsaBinary).match(/.{1,64}/g)?.join("\n") || "") + "\n-----END RSA PRIVATE KEY-----";
  const rsaToken = await (await import("./github-app.ts")).createGitHubAppJwt("5840629", rsaPem, now);
  const rsaParts = rsaToken.split(".");
  const rsaSignature = Uint8Array.from(atob(rsaParts[2].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - rsaParts[2].length % 4) % 4)), (value) => value.charCodeAt(0));
  const rsaValid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pair.publicKey, rsaSignature, new TextEncoder().encode(rsaParts[0] + "." + rsaParts[1]));
  if (!rsaValid) throw new Error("PKCS1 GitHub private key conversion did not verify.");
});
