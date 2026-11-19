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
