import {
  readAndVerifySafeLiveExecutionFacts,
  type SafeLiveReadClient,
  type SafeLiveExecutionExpectation,
} from "./safe-live-execution-facts.ts";

const SAFE = "0x1111111111111111111111111111111111111111";
const BUYER = "0x2222222222222222222222222222222222222222";
const SELLER = "0x3333333333333333333333333333333333333333";
const PLATFORM = "0x4444444444444444444444444444444444444444";
const HASH = "0x" + "a".repeat(64);

function expectation(overrides: Partial<SafeLiveExecutionExpectation> = {}): SafeLiveExecutionExpectation {
  return {
    safeAddress: SAFE,
    expectedSafeAddress: SAFE,
    expectedOwners: [BUYER, SELLER, PLATFORM],
    expectedThreshold: 2,
    expectedVersion: "1.4.1",
    expectedChainId: 56,
    expectedNonce: "7",
    storedSafeTransactionHash: HASH,
    transaction: {
      to: "0x5555555555555555555555555555555555555555",
      value: "0",
      data: "0x1234",
      operation: 1,
      safeTxGas: "0",
      baseGas: "0",
      gasPrice: "0",
      gasToken: "0x0000000000000000000000000000000000000000",
      refundReceiver: "0x0000000000000000000000000000000000000000",
      nonce: "7",
    },
    ...overrides,
  };
}
function client(overrides: Partial<SafeLiveReadClient> = {}): SafeLiveReadClient {
  return {
    getChainId: async () => 56,
    getCode: async () => "0x60016000",
    getOwners: async () => [BUYER, SELLER, PLATFORM],
    getThreshold: async () => 2,
    getNonce: async () => 7n,
    getVersion: async () => "1.4.1",
    getTransactionHash: async () => HASH,
    ...overrides,
  };
}
function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }

Deno.test("live Safe facts accept exact BNB chain, code, owners, threshold, version, nonce and hash", async () => {
  const result = await readAndVerifySafeLiveExecutionFacts(client(), expectation());
  assert(result.valid, JSON.stringify(result.issues));
  assert(result.chainId === 56 && result.threshold === 2 && result.nonce === "7", JSON.stringify(result));
  assert(result.recomputedSafeTransactionHash === HASH, JSON.stringify(result));
});

Deno.test("live Safe facts reject a chain other than BNB mainnet", async () => {
  const result = await readAndVerifySafeLiveExecutionFacts(client({ getChainId: async () => 97 }), expectation());
  assert(!result.valid && result.issues.includes("SAFE_CHAIN_ID_MISMATCH"), JSON.stringify(result));
});

Deno.test("live Safe facts reject missing Safe bytecode", async () => {
  const result = await readAndVerifySafeLiveExecutionFacts(client({ getCode: async () => "0x" }), expectation());
  assert(!result.valid && result.issues.includes("SAFE_CONTRACT_CODE_MISSING"), JSON.stringify(result));
});

Deno.test("live Safe facts reject a changed owner set", async () => {
  const result = await readAndVerifySafeLiveExecutionFacts(client({ getOwners: async () => [BUYER, SELLER] }), expectation());
  assert(!result.valid && result.issues.includes("SAFE_LIVE_OWNER_SET_MISMATCH"), JSON.stringify(result));
});

Deno.test("live Safe facts reject duplicate owners", async () => {
  const result = await readAndVerifySafeLiveExecutionFacts(client({ getOwners: async () => [BUYER, BUYER, PLATFORM] }), expectation());
  assert(!result.valid && result.issues.includes("SAFE_LIVE_OWNERS_INVALID"), JSON.stringify(result));
});

Deno.test("live Safe facts reject threshold, nonce and Safe version changes", async () => {
  const result = await readAndVerifySafeLiveExecutionFacts(client({
    getThreshold: async () => 1,
    getNonce: async () => 8,
    getVersion: async () => "1.3.0",
  }), expectation());
  assert(!result.valid, JSON.stringify(result));
  assert(result.issues.includes("SAFE_LIVE_THRESHOLD_MISMATCH"), JSON.stringify(result));
  assert(result.issues.includes("SAFE_LIVE_NONCE_MISMATCH"), JSON.stringify(result));
  assert(result.issues.includes("SAFE_LIVE_VERSION_MISMATCH"), JSON.stringify(result));
});

Deno.test("live Safe facts reject a recomputed transaction hash mismatch", async () => {
  const result = await readAndVerifySafeLiveExecutionFacts(client({
    getTransactionHash: async () => "0x" + "b".repeat(64),
  }), expectation());
  assert(!result.valid && result.issues.includes("SAFE_LIVE_TRANSACTION_HASH_MISMATCH"), JSON.stringify(result));
});

Deno.test("live Safe facts fail closed when a read-only provider call fails", async () => {
  const result = await readAndVerifySafeLiveExecutionFacts(client({
    getOwners: async () => { throw new Error("provider down"); },
  }), expectation());
  assert(!result.valid && result.issues.includes("SAFE_LIVE_READ_FAILED"), JSON.stringify(result));
});
