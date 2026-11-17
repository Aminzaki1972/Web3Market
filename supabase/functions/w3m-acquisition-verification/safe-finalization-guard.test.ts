import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  finalizeOnlyAfterVerifiedSafeReceipt,
  validateVerifiedSafeReceipt,
  type SafeFinalizationExpectation,
  type VerifiedSafeReceiptEvidence,
} from "./safe-finalization-guard.ts";

const expected: SafeFinalizationExpectation = {
  attemptId: "attempt-1",
  broadcastTxHash: "0x" + "1".repeat(64),
  actorId: "buyer-1",
  safeTxHash: "0x" + "2".repeat(64),
  safeAddress: "0x" + "3".repeat(40),
  tokenContract: "0x" + "4".repeat(40),
  sellerWallet: "0x" + "5".repeat(40),
  sellerAmount: "92.5",
  platformWallet: "0x" + "6".repeat(40),
  platformFee: "7.5",
  minConfirmations: 6,
  packageIssuedAt: "2026-11-06T12:00:00.000Z",
  packageExpiresAt: "2026-11-06T12:02:00.000Z",
};
const evidence: VerifiedSafeReceiptEvidence = {
  chain_id: 56,
  transaction_hash: expected.broadcastTxHash,
  receipt_status: 1,
  execution_success: true,
  execution_failure: false,
  safe_address: expected.safeAddress,
  safe_tx_hash: expected.safeTxHash,
  token_contract: expected.tokenContract,
  confirmations: 13,
  block_timestamp: "2026-11-06T12:01:00.000Z",
  transfers: [
    { from_address: expected.safeAddress, to_address: expected.sellerWallet, amount: "92.5000" },
    { from_address: expected.safeAddress, to_address: expected.platformWallet, amount: "7.500" },
  ],
};

Deno.test("valid BNB Safe receipt evidence matches exact locked transfers", () => {
  assertEquals(validateVerifiedSafeReceipt(expected, evidence), { valid: true });
});

Deno.test("wrong chain, transaction hash, Safe hash, token, or event blocks", () => {
  const bad = {
    ...evidence,
    chain_id: 1,
    transaction_hash: "0x" + "9".repeat(64),
    safe_tx_hash: "0x" + "8".repeat(64),
    token_contract: "0x" + "7".repeat(40),
    execution_failure: true,
  };
  const result = validateVerifiedSafeReceipt(expected, bad);
  assertEquals(result.valid, false);
  if (!result.valid) {
    assertEquals(result.issues.includes("RECEIPT_CHAIN_MISMATCH"), true);
    assertEquals(result.issues.includes("SAFE_EXECUTION_EVENT_INVALID"), true);
  }
});

Deno.test("extra, missing, or substituted transfer blocks", () => {
  const result = validateVerifiedSafeReceipt(expected, {
    ...evidence,
    transfers: [
      evidence.transfers[0],
      { ...evidence.transfers[1], to_address: expected.sellerWallet },
      evidence.transfers[1],
    ],
  });
  assertEquals(result.valid, false);
});

Deno.test("malformed expected or observed amounts never compare equal", () => {
  const result = validateVerifiedSafeReceipt(
    { ...expected, sellerAmount: "not-a-number" },
    evidence,
  );
  assertEquals(result.valid, false);
});

Deno.test("receipt verifier failure never calls finalization RPC", async () => {
  let rpcCalls = 0;
  const client = {
    rpc: async () => {
      rpcCalls += 1;
      return { data: {}, error: null };
    },
  };
  let threw = false;
  try {
    await finalizeOnlyAfterVerifiedSafeReceipt(
      client,
      expected,
      async () => { throw new Error("RPC unavailable"); },
    );
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
  assertEquals(rpcCalls, 0);
});

Deno.test("invalid receipt evidence never calls finalization RPC", async () => {
  let rpcCalls = 0;
  const client = {
    rpc: async () => {
      rpcCalls += 1;
      return { data: {}, error: null };
    },
  };
  let threw = false;
  try {
    await finalizeOnlyAfterVerifiedSafeReceipt(
      client,
      expected,
      async () => ({ ...evidence, receipt_status: 0 }),
    );
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
  assertEquals(rpcCalls, 0);
});

Deno.test("insufficient BNB confirmations block finalization evidence", () => {
  const result = validateVerifiedSafeReceipt(expected, { ...evidence, confirmations: 1 });
  assertEquals(result.valid, false);
  if (!result.valid) assertEquals(result.issues.includes("CONFIRMATIONS_INSUFFICIENT"), true);
});


Deno.test("receipt block timestamp must fall within the exact issued wallet package window", () => {
  const before = validateVerifiedSafeReceipt(expected, {
    ...evidence, block_timestamp: "2026-11-06T11:59:59.000Z",
  });
  const after = validateVerifiedSafeReceipt(expected, {
    ...evidence, block_timestamp: "2026-11-06T12:02:01.000Z",
  });
  assertEquals(before.valid, false);
  assertEquals(after.valid, false);
  if (!before.valid) assertEquals(before.issues.includes("RECEIPT_OUTSIDE_WALLET_PACKAGE_VALIDITY_WINDOW"), true);
  if (!after.valid) assertEquals(after.issues.includes("RECEIPT_OUTSIDE_WALLET_PACKAGE_VALIDITY_WINDOW"), true);
});
