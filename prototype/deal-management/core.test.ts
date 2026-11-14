import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  calculateOrdinaryPayout, canAdvance, formatUsdt, parseUsdtAmount,
  validateDepositEvidence, validateDisputeAllocation,
} from "./core.ts";

Deno.test("USDT parsing uses six-decimal integer units without floating point", () => {
  assertEquals(parseUsdtAmount("7000"), 7_000_000_000n);
  assertEquals(parseUsdtAmount("0.000001"), 1n);
  assertEquals(formatUsdt(parseUsdtAmount("6475.125")), "6475.125");
  assertThrows(() => parseUsdtAmount("1.0000001"));
  assertThrows(() => parseUsdtAmount("0"));
});

Deno.test("ordinary 7.5 percent commission split is exact", () => {
  const result = calculateOrdinaryPayout(parseUsdtAmount("7000"));
  assertEquals(formatUsdt(result.platformFee), "525");
  assertEquals(formatUsdt(result.sellerNet), "6475");
  assertEquals(result.platformFee + result.sellerNet, result.gross);
});

const token = "0x1111111111111111111111111111111111111111";
const safe = "0x2222222222222222222222222222222222222222";
const evidence = {
  chainId: 56, tokenAddress: token, expectedTokenAddress: token,
  safeAddress: safe, expectedSafeAddress: safe, transferLogTo: safe,
  amount: parseUsdtAmount("7000"), expectedAmount: parseUsdtAmount("7000"),
  txHash: "0x" + "a".repeat(64), receiptStatus: "success" as const,
  confirmations: 15, requiredConfirmations: 12, alreadyUsedTxHash: false,
};

Deno.test("deposit evidence passes only when normalized BSC USDT transfer matches deal", () => {
  assertEquals(validateDepositEvidence(evidence), { ok: true });
});
for (const [name, override, reason] of [
  ["wrong network", { chainId: 97 }, "wrong_network"],
  ["wrong token", { tokenAddress: safe }, "wrong_token"],
  ["wrong recipient", { transferLogTo: token }, "wrong_safe_recipient"],
  ["wrong amount", { amount: 1n }, "amount_mismatch"],
  ["duplicate hash", { alreadyUsedTxHash: true }, "duplicate_tx_hash"],
  ["failed receipt", { receiptStatus: "failed" }, "transaction_not_successful"],
  ["too few confirmations", { confirmations: 2 }, "insufficient_confirmations"],
] as const) {
  Deno.test("deposit rejects " + name, () => {
    assertEquals(validateDepositEvidence({ ...evidence, ...override } as typeof evidence), { ok: false, reason });
  });
}

Deno.test("agreement and deposit gates prevent premature funding", () => {
  const base = { finalAgreementApproved: false, depositConfirmed: false, assetsTransferred: false,
    aiVerificationComplete: false, buyerAccepted: false, disputeOpen: false, safeExecutionConfirmed: false };
  assertEquals(canAdvance("agreement_pending", "awaiting_deposit", base), false);
  assertEquals(canAdvance("awaiting_deposit", "funded", { ...base, finalAgreementApproved: true }), false);
  assertEquals(canAdvance("awaiting_deposit", "funded", { ...base, depositConfirmed: true }), true);
});

Deno.test("dispute blocks ordinary progress until resolution", () => {
  const flags = { finalAgreementApproved: true, depositConfirmed: true, assetsTransferred: true,
    aiVerificationComplete: true, buyerAccepted: true, disputeOpen: true, safeExecutionConfirmed: false };
  assertEquals(canAdvance("buyer_review", "payout_ready", flags), false);
  assertEquals(canAdvance("buyer_review", "dispute_open", flags), true);
});

Deno.test("completion requires confirmed Safe execution", () => {
  const base = { finalAgreementApproved: true, depositConfirmed: true, assetsTransferred: true,
    aiVerificationComplete: true, buyerAccepted: true, disputeOpen: false, safeExecutionConfirmed: false };
  assertEquals(canAdvance("payout_ready", "completed", base), false);
  assertEquals(canAdvance("payout_ready", "completed", { ...base, safeExecutionConfirmed: true }), true);
});

Deno.test("dispute allocations must reconcile exactly to deposited total", () => {
  const total = parseUsdtAmount("7000");
  assertEquals(validateDisputeAllocation(total, { buyerRefund: parseUsdtAmount("1000"), sellerPayout: parseUsdtAmount("5475"), platformFee: parseUsdtAmount("525") }), true);
  assertEquals(validateDisputeAllocation(total, { buyerRefund: parseUsdtAmount("1000"), sellerPayout: parseUsdtAmount("5400"), platformFee: parseUsdtAmount("525") }), false);
});
