import { assert, assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert@1";
import { decryptGuestToken, encryptGuestToken, importGuestTokenKey } from "./guest-report-token.ts";

Deno.test("guest report tokens are encrypted and recoverable for retries", async () => {
  const token = "a".repeat(64);
  const key = await importGuestTokenKey("test-only-secret-value-that-is-long-enough-123");
  const encrypted = await encryptGuestToken(token, key);
  assert(!encrypted.ciphertext.includes(token));
  assertEquals(await decryptGuestToken(encrypted.ciphertext, encrypted.iv, key), token);
});

Deno.test("guest report token encryption uses a fresh IV", async () => {
  const token = "b".repeat(64);
  const key = await importGuestTokenKey("test-only-secret-value-that-is-long-enough-123");
  const first = await encryptGuestToken(token, key);
  const second = await encryptGuestToken(token, key);
  assertNotEquals(first.iv, second.iv);
  assertNotEquals(first.ciphertext, second.ciphertext);
});

Deno.test("guest report token ciphertext cannot be decrypted with a different key", async () => {
  const encrypted = await encryptGuestToken("c".repeat(64), await importGuestTokenKey("test-only-secret-value-that-is-long-enough-123"));
  const wrongKey = await importGuestTokenKey("different-test-secret-value-long-enough-456");
  await assertRejects(() => decryptGuestToken(encrypted.ciphertext, encrypted.iv, wrongKey));
});

Deno.test("weak encryption secrets are rejected", async () => {
  await assertRejects(() => importGuestTokenKey("too-short"));
});
