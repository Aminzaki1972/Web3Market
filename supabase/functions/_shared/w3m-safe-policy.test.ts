import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  buildW3MSafeConfiguration,
  W3M_SAFE_DEFAULT_THRESHOLD,
  W3M_SAFE_OWNER_ROLES,
} from "./w3m-safe-policy.ts";

const BUYER = "0x1111111111111111111111111111111111111111";
const SELLER = "0x2222222222222222222222222222222222222222";
const PLATFORM = "0x3333333333333333333333333333333333333333";

Deno.test("W3M V1 creates Safe with buyer, seller, platform and 2-of-3 threshold", () => {
  const config = buildW3MSafeConfiguration({
    buyerWallet: BUYER,
    sellerWallet: SELLER,
    platformWallet: PLATFORM,
  });
  assertEquals(config.owners, [BUYER, SELLER, PLATFORM]);
  assertEquals(config.threshold, 2);
  assertEquals(config.ownerRoles, ["buyer", "seller", "platform"]);
  assertEquals(W3M_SAFE_OWNER_ROLES, ["buyer", "seller", "platform"]);
  assertEquals(W3M_SAFE_DEFAULT_THRESHOLD, 2);
});

Deno.test("W3M V1 rejects duplicate owner addresses case-insensitively", () => {
  assertThrows(
    () => buildW3MSafeConfiguration({
      buyerWallet: BUYER,
      sellerWallet: BUYER.toUpperCase().replace("0X", "0x"),
      platformWallet: PLATFORM,
    }),
    Error,
    "W3M_SAFE_OWNERS_MUST_BE_DISTINCT",
  );
});

Deno.test("W3M V1 rejects malformed owner addresses", () => {
  assertThrows(
    () => buildW3MSafeConfiguration({
      buyerWallet: "bad",
      sellerWallet: SELLER,
      platformWallet: PLATFORM,
    }),
    Error,
    "W3M_SAFE_OWNER_ADDRESS_INVALID",
  );
});
