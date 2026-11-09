import { keccak256, type Hex } from "npm:viem@2.37.6";

export const W3M_SAFE_AUTHENTICITY_CONSTANTS = Object.freeze({
  chainId: 56,
  proxyRuntimeHash: "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
  singletonAddress: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
  singletonRuntimeHash: "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4",
  factoryAddress: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  factoryRuntimeHash: "0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317",
});

export type W3MSafeAuthenticityExpected = {
  chainId: number;
  proxyRuntimeHash: string;
  singletonAddress: string;
  singletonRuntimeHash: string;
  factoryAddress: string;
  factoryRuntimeHash: string;
};

export type W3MSafeAuthenticityInput = {
  chainId: number;
  safeAddress: unknown;
  proxyCode: unknown;
  singletonCode: unknown;
  factoryCode: unknown;
  singletonStorage: unknown;
  masterCopy: unknown;
};

const isAddress = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value);

const isRuntimeCode = (value: unknown): value is Hex =>
  typeof value === "string" && /^0x(?:[0-9a-f]{2})+$/i.test(value);

function addressFromWord(value: unknown): string | null {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) return null;
  const address = `0x${value.slice(-40)}`;
  return isAddress(address) ? address.toLowerCase() : null;
}

function matchesRuntimeHash(code: unknown, expectedHash: string): boolean {
  if (!isRuntimeCode(code)) return false;
  try {
    return keccak256(code).toLowerCase() === expectedHash.toLowerCase();
  } catch {
    return false;
  }
}

export function assessW3MSafeAuthenticity(
  input: W3MSafeAuthenticityInput,
  expected: W3MSafeAuthenticityExpected = W3M_SAFE_AUTHENTICITY_CONSTANTS,
) {
  if (input.chainId !== expected.chainId) return { ok: false, reason: "bsc_rpc_chain_mismatch" } as const;
  if (!isAddress(input.safeAddress)) return { ok: false, reason: "safe_address_missing_or_invalid" } as const;

  if (!isRuntimeCode(input.proxyCode)) return { ok: false, reason: "safe_proxy_code_missing" } as const;
  if (!matchesRuntimeHash(input.proxyCode, expected.proxyRuntimeHash)) {
    return { ok: false, reason: "safe_proxy_runtime_hash_mismatch" } as const;
  }

  if (!isRuntimeCode(input.singletonCode)) return { ok: false, reason: "safe_singleton_code_missing" } as const;
  if (!matchesRuntimeHash(input.singletonCode, expected.singletonRuntimeHash)) {
    return { ok: false, reason: "safe_singleton_runtime_hash_mismatch" } as const;
  }

  if (!isRuntimeCode(input.factoryCode)) return { ok: false, reason: "safe_proxy_factory_code_missing" } as const;
  if (!matchesRuntimeHash(input.factoryCode, expected.factoryRuntimeHash)) {
    return { ok: false, reason: "safe_proxy_factory_runtime_hash_mismatch" } as const;
  }

  const storageAddress = addressFromWord(input.singletonStorage);
  if (!storageAddress || storageAddress !== expected.singletonAddress.toLowerCase()) {
    return { ok: false, reason: "safe_singleton_storage_mismatch" } as const;
  }

  const getterAddress = addressFromWord(input.masterCopy);
  if (!getterAddress || getterAddress !== expected.singletonAddress.toLowerCase()) {
    return { ok: false, reason: "safe_master_copy_mismatch" } as const;
  }
  if (storageAddress !== getterAddress) {
    return { ok: false, reason: "safe_singleton_reference_disagreement" } as const;
  }

  return {
    ok: true,
    reason: "valid",
    proxyRuntimeHash: keccak256(input.proxyCode).toLowerCase(),
    singletonRuntimeHash: keccak256(input.singletonCode).toLowerCase(),
    factoryRuntimeHash: keccak256(input.factoryCode).toLowerCase(),
    singletonAddress: storageAddress,
  } as const;
}
