import { assertEquals } from "jsr:@std/assert@1.0.14";
import { isW3MBscMainnetChain, W3M_BSC_MAINNET_CHAIN_ID } from "./w3m-safe-chain.ts";

Deno.test("W3M V1 accepts only BNB Smart Chain Mainnet chain ID 56", () => {
  assertEquals(W3M_BSC_MAINNET_CHAIN_ID, 56);
  assertEquals(isW3MBscMainnetChain(56), true);
  assertEquals(isW3MBscMainnetChain(97), false);
  assertEquals(isW3MBscMainnetChain(1), false);
  assertEquals(isW3MBscMainnetChain(Number.NaN), false);
});
