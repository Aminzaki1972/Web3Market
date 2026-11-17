import { extractW3MBearerToken } from "./bearer-token.ts";
Deno.test("extracts a normal Bearer token", () => {
  if (extractW3MBearerToken("Bearer abc.def-123") !== "abc.def-123") {
    throw new Error("valid bearer token was not extracted");
  }
});
Deno.test("accepts case-insensitive scheme and surrounding whitespace", () => {
  if (extractW3MBearerToken("  bearer   token-value  ") !== "token-value") {
    throw new Error("bearer scheme parsing failed");
  }
});
Deno.test("rejects missing, empty, and multi-part credentials", () => {
  for (const value of [null, "", "Basic abc", "Bearer", "Bearer one two"]) {
    if (extractW3MBearerToken(value) !== null) {
      throw new Error("invalid authorization header was accepted: " + String(value));
    }
  }
});
