// W3M Protocol V1 — read-only Safe configuration verifier for PREPARE.
// Unlike the execution verifier, this does not require a pre-existing SafeTx hash.
// The caller must pin all reads to one canonical BNB block and supply verified
// buyer/seller wallets from the authoritative server-side Deal Room snapshot.

export interface SafeConfigurationReadClient {
  getChainId(): Promise<number | bigint | string>;
  getCode(address: string): Promise<string>;
  getOwners(safeAddress: string): Promise<readonly string[]>;
  getThreshold(safeAddress: string): Promise<number | bigint | string>;
  getNonce(safeAddress: string): Promise<number | bigint | string>;
  getVersion(safeAddress: string): Promise<string>;
}

export interface SafeConfigurationExpectation {
  safeAddress: string;
  expectedSafeAddress: string;
  expectedOwners: readonly string[];
  expectedThreshold: number;
  expectedVersion: string;
  expectedChainId: number;
  expectedNonce?: string;
}

export interface SafeConfigurationFacts {
  valid: boolean;
  chainId: number | null;
  safeAddress: string | null;
  owners: string[];
  threshold: number | null;
  nonce: string | null;
  version: string | null;
  issues: string[];
}

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const UINT = /^(0|[1-9][0-9]*)$/;

function address(value: unknown): string | null {
  return typeof value === "string" && ADDRESS.test(value) ? value.toLowerCase() : null;
}
function uint(value: unknown): string | null {
  if (typeof value === "bigint") return value >= 0n ? value.toString() : null;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  return typeof value === "string" && UINT.test(value) ? value : null;
}
function sameSet(actual: readonly string[], expected: readonly string[]): boolean {
  const a = actual.map((value) => value.toLowerCase()).sort();
  const e = expected.map((value) => value.toLowerCase()).sort();
  return a.length === e.length && a.every((value, index) => value === e[index]);
}

export async function readAndVerifySafeConfigurationFacts(
  client: SafeConfigurationReadClient,
  expected: SafeConfigurationExpectation,
): Promise<SafeConfigurationFacts> {
  const issues: string[] = [];
  const safeAddress = address(expected.safeAddress);
  const expectedSafeAddress = address(expected.expectedSafeAddress);
  if (!safeAddress || !expectedSafeAddress || safeAddress !== expectedSafeAddress) {
    issues.push("SAFE_ADDRESS_MISMATCH");
  }
  const expectedOwners = expected.expectedOwners.map(address);
  if (expectedOwners.length !== 3 || expectedOwners.some((owner) => owner === null) ||
      new Set(expectedOwners).size !== expectedOwners.length) {
    issues.push("EXPECTED_SAFE_OWNERS_INVALID");
  }

  let chainId: number | null = null;
  let code = "0x";
  let ownersRaw: readonly string[] = [];
  let threshold: number | null = null;
  let nonce: string | null = null;
  let version: string | null = null;

  if (safeAddress && !issues.includes("EXPECTED_SAFE_OWNERS_INVALID")) {
    try {
      const [chain, bytecode, currentOwners, currentThreshold, currentNonce, currentVersion] =
        await Promise.all([
          client.getChainId(),
          client.getCode(safeAddress),
          client.getOwners(safeAddress),
          client.getThreshold(safeAddress),
          client.getNonce(safeAddress),
          client.getVersion(safeAddress),
        ]);
      const chainText = uint(chain);
      chainId = chainText !== null && Number.isSafeInteger(Number(chainText)) ? Number(chainText) : null;
      code = bytecode;
      ownersRaw = currentOwners;
      const thresholdText = uint(currentThreshold);
      threshold = thresholdText !== null && Number.isSafeInteger(Number(thresholdText))
        ? Number(thresholdText)
        : null;
      nonce = uint(currentNonce);
      version = typeof currentVersion === "string" ? currentVersion : null;
    } catch {
      issues.push("SAFE_CONFIGURATION_READ_FAILED");
    }
  }

  if (chainId !== expected.expectedChainId) issues.push("SAFE_CHAIN_ID_MISMATCH");
  if (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(code)) {
    issues.push("SAFE_CONTRACT_CODE_MISSING");
  }
  const owners = ownersRaw.map(address);
  if (owners.length !== 3 || owners.some((owner) => owner === null) ||
      new Set(owners).size !== owners.length) {
    issues.push("SAFE_LIVE_OWNERS_INVALID");
  } else if (!sameSet(owners as string[], expectedOwners.filter((x): x is string => x !== null))) {
    issues.push("SAFE_LIVE_OWNER_SET_MISMATCH");
  }
  if (threshold !== expected.expectedThreshold || threshold === null ||
      threshold < 1 || threshold > owners.length) {
    issues.push("SAFE_LIVE_THRESHOLD_MISMATCH");
  }
  const expectedNonce = expected.expectedNonce === undefined ? null : uint(expected.expectedNonce);
  if (nonce === null || (expected.expectedNonce !== undefined &&
      (expectedNonce === null || nonce !== expectedNonce))) {
    issues.push("SAFE_LIVE_NONCE_MISMATCH");
  }
  if (version !== expected.expectedVersion) issues.push("SAFE_LIVE_VERSION_MISMATCH");

  return {
    valid: issues.length === 0,
    chainId,
    safeAddress,
    owners: owners.filter((owner): owner is string => owner !== null),
    threshold,
    nonce,
    version,
    issues: [...new Set(issues)],
  };
}
