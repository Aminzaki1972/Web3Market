// W3M Protocol V1 — read-only live Safe facts verifier.
// The production adapter must bind these methods to a read-only BNB provider.
// This module never sends transactions, signs, or mutates chain state.

export interface SafeTransactionHashFields {
  to: string;
  value: string;
  data: string;
  operation: number;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: string;
  refundReceiver: string;
  nonce: string;
}

export interface SafeLiveReadClient {
  getChainId(): Promise<number | bigint | string>;
  getCode(address: string): Promise<string>;
  getOwners(safeAddress: string): Promise<readonly string[]>;
  getThreshold(safeAddress: string): Promise<number | bigint | string>;
  getNonce(safeAddress: string): Promise<number | bigint | string>;
  getVersion(safeAddress: string): Promise<string>;
  getTransactionHash(safeAddress: string, fields: SafeTransactionHashFields): Promise<string>;
}

export interface SafeLiveExecutionExpectation {
  safeAddress: string;
  expectedSafeAddress: string;
  expectedOwners: readonly string[];
  expectedThreshold: number;
  expectedVersion: string;
  expectedChainId: number;
  expectedNonce: string;
  storedSafeTransactionHash: string;
  transaction: SafeTransactionHashFields;
}

export interface SafeLiveExecutionFacts {
  valid: boolean;
  chainId: number | null;
  safeAddress: string | null;
  owners: string[];
  threshold: number | null;
  nonce: string | null;
  version: string | null;
  recomputedSafeTransactionHash: string | null;
  issues: string[];
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^(0|[1-9][0-9]*)$/;

function address(value: unknown): string | null {
  return typeof value === "string" && ADDRESS.test(value) ? value.toLowerCase() : null;
}
function uint(value: unknown): string | null {
  if (typeof value === "bigint") return value >= 0n ? value.toString() : null;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  if (typeof value === "string" && UINT.test(value)) return value;
  return null;
}
function sameSet(actual: readonly string[], expected: readonly string[]): boolean {
  const a = actual.map((value) => value.toLowerCase()).sort();
  const e = expected.map((value) => value.toLowerCase()).sort();
  return a.length === e.length && a.every((value, index) => value === e[index]);
}

export async function readAndVerifySafeLiveExecutionFacts(
  client: SafeLiveReadClient,
  expected: SafeLiveExecutionExpectation,
): Promise<SafeLiveExecutionFacts> {
  const issues: string[] = [];
  const safeAddress = address(expected.safeAddress);
  const expectedSafeAddress = address(expected.expectedSafeAddress);
  if (!safeAddress || !expectedSafeAddress || safeAddress !== expectedSafeAddress) {
    issues.push("SAFE_ADDRESS_MISMATCH");
  }
  const tx = expected.transaction;
  if (!tx || !address(tx.to) || !address(tx.gasToken) || !address(tx.refundReceiver) ||
      typeof tx.data !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(tx.data) ||
      (tx.operation !== 0 && tx.operation !== 1) ||
      [tx.value, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.nonce].some((value) => uint(value) === null)) {
    issues.push("SAFE_TRANSACTION_FIELDS_INVALID");
  }

  const expectedOwners = expected.expectedOwners.map(address);
  if (expectedOwners.length === 0 || expectedOwners.some((owner) => owner === null) ||
      new Set(expectedOwners).size !== expectedOwners.length) {
    issues.push("EXPECTED_SAFE_OWNERS_INVALID");
  }

  let chainId: number | null = null;
  let code = "0x";
  let ownersRaw: readonly string[] = [];
  let threshold: number | null = null;
  let nonce: string | null = null;
  let version: string | null = null;
  let recomputedSafeTransactionHash: string | null = null;

  if (safeAddress && !issues.includes("SAFE_TRANSACTION_FIELDS_INVALID")) {
    try {
      const [chain, bytecode, currentOwners, currentThreshold, currentNonce, currentVersion, txHash] =
        await Promise.all([
          client.getChainId(),
          client.getCode(safeAddress),
          client.getOwners(safeAddress),
          client.getThreshold(safeAddress),
          client.getNonce(safeAddress),
          client.getVersion(safeAddress),
          client.getTransactionHash(safeAddress, expected.transaction),
        ]);
      const chainText = uint(chain);
      chainId = chainText !== null && Number.isSafeInteger(Number(chainText))
        ? Number(chainText)
        : null;
      code = bytecode;
      ownersRaw = currentOwners;
      const thresholdText = uint(currentThreshold);
      threshold = thresholdText !== null && Number.isSafeInteger(Number(thresholdText))
        ? Number(thresholdText)
        : null;
      nonce = uint(currentNonce);
      version = typeof currentVersion === "string" ? currentVersion : null;
      recomputedSafeTransactionHash = typeof txHash === "string" && HASH.test(txHash)
        ? txHash
        : null;
    } catch {
      issues.push("SAFE_LIVE_READ_FAILED");
    }
  }

  if (chainId !== expected.expectedChainId) issues.push("SAFE_CHAIN_ID_MISMATCH");
  if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) {
    issues.push("SAFE_CONTRACT_CODE_MISSING");
  }

  const owners = ownersRaw.map(address);
  if (owners.length === 0 || owners.some((owner) => owner === null) ||
      new Set(owners).size !== owners.length) {
    issues.push("SAFE_LIVE_OWNERS_INVALID");
  } else if (!sameSet(owners as string[], expectedOwners.filter((x): x is string => x !== null))) {
    issues.push("SAFE_LIVE_OWNER_SET_MISMATCH");
  }

  if (threshold !== expected.expectedThreshold || threshold === null ||
      threshold < 1 || threshold > owners.length) {
    issues.push("SAFE_LIVE_THRESHOLD_MISMATCH");
  }
  const expectedNonce = uint(expected.expectedNonce);
  if (nonce === null || expectedNonce === null || nonce !== expectedNonce) {
    issues.push("SAFE_LIVE_NONCE_MISMATCH");
  }
  if (version !== expected.expectedVersion) issues.push("SAFE_LIVE_VERSION_MISMATCH");
  if (!recomputedSafeTransactionHash || !HASH.test(expected.storedSafeTransactionHash) ||
      recomputedSafeTransactionHash.toLowerCase() !== expected.storedSafeTransactionHash.toLowerCase()) {
    issues.push("SAFE_LIVE_TRANSACTION_HASH_MISMATCH");
  }

  return {
    valid: issues.length === 0,
    chainId,
    safeAddress,
    owners: owners.filter((owner): owner is string => owner !== null),
    threshold,
    nonce,
    version,
    recomputedSafeTransactionHash,
    issues: [...new Set(issues)],
  };
}
