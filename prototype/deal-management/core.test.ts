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
  ["malformed recipient", { transferLogTo: "0x1234" }, "wrong_safe_recipient"],
  ["wrong amount", { amount: 1n }, "amount_mismatch"],
  ["duplicate hash", { alreadyUsedTxHash: true }, "duplicate_tx_hash"],
  ["failed receipt", { receiptStatus: "failed" }, "transaction_not_successful"],
  ["too few confirmations", { confirmations: 2 }, "insufficient_confirmations"],
] as const) {
  Deno.test("deposit rejects " + name, () => {
    assertEquals(validateDepositEvidence({ ...evidence, ...override } as typeof evidence), { ok: false, reason });
  });
}

const base = {
  finalPriceAccepted: true, finalAgreementApproved: true, depositConfirmed: true, assetsTransferred: true,
  aiVerificationComplete: true, buyerAccepted: true, disputeOpen: false,
  disputeDecisionFinalized: false, safeExecutionConfirmed: false,
};

Deno.test("agreement and deposit gates prevent premature funding and transfer", () => {
  assertEquals(canAdvance("negotiation", "agreement_pending", { ...base, finalPriceAccepted: false }), false);
  assertEquals(canAdvance("negotiation", "agreement_pending", base), true);
  assertEquals(canAdvance("agreement_pending", "awaiting_deposit", { ...base, finalAgreementApproved: false }), false);
  assertEquals(canAdvance("awaiting_deposit", "funded", { ...base, depositConfirmed: false }), false);
  assertEquals(canAdvance("awaiting_deposit", "funded", base), true);
  assertEquals(canAdvance("awaiting_deposit", "cancelled", { ...base, depositConfirmed: true }), false);
  assertEquals(canAdvance("awaiting_deposit", "cancelled", { ...base, depositConfirmed: false }), true);
  assertEquals(canAdvance("funded", "transfer_in_progress", { ...base, depositConfirmed: false }), false);
});

Deno.test("asset transfer and AI verification gates protect buyer review", () => {
  assertEquals(canAdvance("transfer_in_progress", "ai_verification", { ...base, assetsTransferred: false }), false);
  assertEquals(canAdvance("ai_verification", "buyer_review", { ...base, aiVerificationComplete: false }), false);
  assertEquals(canAdvance("ai_verification", "buyer_review", base), true);
});

Deno.test("open dispute blocks payout; dispute payout requires a finalized decision", () => {
  assertEquals(canAdvance("buyer_review", "payout_ready", { ...base, disputeOpen: true }), false);
  assertEquals(canAdvance("buyer_review", "dispute_open", { ...base, disputeOpen: true }), true);
  assertEquals(canAdvance("dispute_open", "payout_ready", { ...base, disputeOpen: true, disputeDecisionFinalized: true }), false);
  assertEquals(canAdvance("dispute_open", "payout_ready", { ...base, buyerAccepted: false }), false);
  assertEquals(canAdvance("dispute_open", "payout_ready", { ...base, buyerAccepted: false, disputeDecisionFinalized: true }), true);
});

Deno.test("completion requires confirmed Safe execution", () => {
  assertEquals(canAdvance("payout_ready", "completed", base), false);
  assertEquals(canAdvance("payout_ready", "completed", { ...base, safeExecutionConfirmed: true }), true);
});

Deno.test("dispute allocations must reconcile exactly to deposited total", () => {
  const total = parseUsdtAmount("7000");
  assertEquals(validateDisputeAllocation(total, { buyerRefund: parseUsdtAmount("1000"), sellerPayout: parseUsdtAmount("5475"), platformFee: parseUsdtAmount("525") }), true);
  assertEquals(validateDisputeAllocation(total, { buyerRefund: parseUsdtAmount("1000"), sellerPayout: parseUsdtAmount("5400"), platformFee: parseUsdtAmount("525") }), false);
});
