import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { parseSafeDemoUsdtNumber } from "./safe-demo-usdt-number.js";

Deno.test("safe demo amount conversion preserves six-decimal values", () => {
  assertEquals(parseSafeDemoUsdtNumber("7000"), 7000);
  assertEquals(parseSafeDemoUsdtNumber("7000.123456"), 7000.123456);
  assertEquals(parseSafeDemoUsdtNumber("0.000001"), 0.000001);
});

Deno.test("safe demo amount conversion rejects values that lose a micro-USDT unit", async () => {
  await assertRejects(() => Promise.resolve().then(() => parseSafeDemoUsdtNumber("9007199254.740991")));
});

Deno.test("safe demo amount conversion rejects malformed precision and exponent notation", async () => {
  await assertRejects(() => Promise.resolve().then(() => parseSafeDemoUsdtNumber("1.0000001")));
  await assertRejects(() => Promise.resolve().then(() => parseSafeDemoUsdtNumber("1e6")));
  await assertRejects(() => Promise.resolve().then(() => parseSafeDemoUsdtNumber("-1")));
});
