import { assertEquals } from "jsr:@std/assert@1.0.14";
import { keccak256 } from "npm:viem@2.37.6";
import {
  assessW3MSafeAuthenticity,
  W3M_SAFE_AUTHENTICITY_CONSTANTS,
  type W3MSafeAuthenticityExpected,
} from "./w3m-safe-authenticity.ts";

const SAFE = "0x3333333333333333333333333333333333333333";
const SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const OTHER = "0x9999999999999999999999999999999999999999";
const PROXY_CODE = "0x608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033";
const SINGLETON_CODE = "0x6000600055";
const FACTORY_CODE = "0x6001600055";
const word = (address: string) => `0x${"0".repeat(24)}${address.slice(2)}`;

const expected: W3MSafeAuthenticityExpected = {
  chainId: 56,
  proxyRuntimeHash: keccak256(PROXY_CODE),
  singletonAddress: SINGLETON,
  singletonRuntimeHash: keccak256(SINGLETON_CODE),
  factoryAddress: W3M_SAFE_AUTHENTICITY_CONSTANTS.factoryAddress,
  factoryRuntimeHash: keccak256(FACTORY_CODE),
};

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    chainId: 56,
    safeAddress: SAFE,
    proxyCode: PROXY_CODE,
    singletonCode: SINGLETON_CODE,
    factoryCode: FACTORY_CODE,
    singletonStorage: word(SINGLETON),
    masterCopy: word(SINGLETON),
    ...overrides,
  };
}

Deno.test("approved Safe v1.4.1 runtime fixture matches the pinned proxy hash", () => {
  assertEquals(keccak256(PROXY_CODE), W3M_SAFE_AUTHENTICITY_CONSTANTS.proxyRuntimeHash);
});

Deno.test("accepts exact proxy, singleton, factory, slot, and masterCopy identity", () => {
  const result = assessW3MSafeAuthenticity(validInput(), expected);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.proxyRuntimeHash, expected.proxyRuntimeHash);
    assertEquals(result.singletonAddress, SINGLETON.toLowerCase());
  }
});

Deno.test("rejects wrong chain before accepting runtime evidence", () => {
  const result = assessW3MSafeAuthenticity(validInput({ chainId: 97 }), expected);
  assertEquals(result.reason, "bsc_rpc_chain_mismatch");
});

Deno.test("rejects missing or malformed SafeProxy runtime code", () => {
  assertEquals(assessW3MSafeAuthenticity(validInput({ proxyCode: "0x" }), expected).reason, "safe_proxy_code_missing");
  assertEquals(assessW3MSafeAuthenticity(validInput({ proxyCode: "0x600" }), expected).reason, "safe_proxy_code_missing");
});

Deno.test("rejects counterfeit SafeProxy runtime", () => {
  const result = assessW3MSafeAuthenticity(validInput({ proxyCode: "0x60006000" }), expected);
  assertEquals(result.reason, "safe_proxy_runtime_hash_mismatch");
});

Deno.test("rejects missing or counterfeit singleton runtime", () => {
  assertEquals(assessW3MSafeAuthenticity(validInput({ singletonCode: "0x" }), expected).reason, "safe_singleton_code_missing");
  assertEquals(assessW3MSafeAuthenticity(validInput({ singletonCode: "0x6002" }), expected).reason, "safe_singleton_runtime_hash_mismatch");
});

Deno.test("rejects missing or counterfeit factory runtime", () => {
  assertEquals(assessW3MSafeAuthenticity(validInput({ factoryCode: "0x" }), expected).reason, "safe_proxy_factory_code_missing");
  assertEquals(assessW3MSafeAuthenticity(validInput({ factoryCode: "0x6002" }), expected).reason, "safe_proxy_factory_runtime_hash_mismatch");
});

Deno.test("rejects wrong singleton storage slot", () => {
  const result = assessW3MSafeAuthenticity(validInput({ singletonStorage: word(OTHER) }), expected);
  assertEquals(result.reason, "safe_singleton_storage_mismatch");
});

Deno.test("rejects wrong masterCopy getter", () => {
  const result = assessW3MSafeAuthenticity(validInput({ masterCopy: word(OTHER) }), expected);
  assertEquals(result.reason, "safe_master_copy_mismatch");
});

Deno.test("rejects malformed storage and getter words", () => {
  assertEquals(assessW3MSafeAuthenticity(validInput({ singletonStorage: "0x1234" }), expected).reason, "safe_singleton_storage_mismatch");
  assertEquals(assessW3MSafeAuthenticity(validInput({ masterCopy: "0x1234" }), expected).reason, "safe_master_copy_mismatch");
});
