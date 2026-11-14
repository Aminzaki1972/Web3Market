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
  disputeEverOpened: false, disputeDecisionFinalized: false, safeExecutionConfirmed: false,
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

Deno.test("an open dispute blocks payout until the dispute is resolved", () => {
  assertEquals(canAdvance("buyer_review", "payout_ready", { ...base, disputeOpen: true }), false);
  assertEquals(canAdvance("payout_ready", "completed", { ...base, disputeOpen: true, safeExecutionConfirmed: true }), false);
  assertEquals(canAdvance("buyer_review", "dispute_open", { ...base, disputeOpen: true }), true);
  assertEquals(canAdvance("dispute_open", "payout_ready", {
    ...base, disputeOpen: false, disputeDecisionFinalized: false, buyerAccepted: false,
  }), false);
  assertEquals(canAdvance("dispute_open", "payout_ready", {
    ...base, disputeOpen: false, disputeEverOpened: true, disputeDecisionFinalized: true, buyerAccepted: false,
  }), true);
  assertEquals(canAdvance("dispute_open", "payout_ready", {
    ...base, disputeOpen: false, disputeEverOpened: false, disputeDecisionFinalized: true, buyerAccepted: false,
  }), false);
  assertEquals(canAdvance("dispute_open", "payout_ready", {
    ...base, disputeOpen: false, disputeEverOpened: undefined as unknown as boolean,
    disputeDecisionFinalized: true, buyerAccepted: false,
  }), false);
  assertEquals(canAdvance("buyer_review", "payout_ready", {
    ...base, disputeOpen: false, disputeEverOpened: true, buyerAccepted: true,
    disputeDecisionFinalized: false,
  }), false);
  assertEquals(canAdvance("buyer_review", "payout_ready", {
    ...base, disputeOpen: false, disputeEverOpened: true, buyerAccepted: true,
    disputeDecisionFinalized: true,
  }), false);
  assertEquals(canAdvance("buyer_review", "payout_ready", {
    ...base, disputeOpen: false, disputeEverOpened: undefined as unknown as boolean,
    buyerAccepted: true,
  }), false);
  assertEquals(canAdvance("buyer_review", "payout_ready", {
    ...base, disputeOpen: true, buyerAccepted: true,
  }), false);
});

Deno.test("completion requires confirmed Safe execution", () => {
  assertEquals(canAdvance("payout_ready", "completed", base), false);
  assertEquals(canAdvance("payout_ready", "completed", { ...base, safeExecutionConfirmed: true }), true);
  assertEquals(canAdvance("payout_ready", "completed", {
    ...base, disputeEverOpened: true, disputeDecisionFinalized: false, safeExecutionConfirmed: true,
  }), false);
  assertEquals(canAdvance("payout_ready", "completed", {
    ...base, disputeEverOpened: true, disputeDecisionFinalized: true, safeExecutionConfirmed: true,
  }), true);
});

Deno.test("dispute allocation uses buyer gross refund bucket and exact full fee", () => {
  const total = parseUsdtAmount("7000");
  const fee = parseUsdtAmount("525");
  assertEquals(validateDisputeAllocation(total, {
    buyerGrossRefund: parseUsdtAmount("2000"), sellerPayout: parseUsdtAmount("5000"), platformFee: fee,
  }, total), true);
  assertEquals(validateDisputeAllocation(total, {
    buyerGrossRefund: parseUsdtAmount("500"), sellerPayout: parseUsdtAmount("6500"), platformFee: fee,
  }, total), false); // Buyer gross refund cannot cover the full commission.
  assertEquals(validateDisputeAllocation(total, {
    buyerGrossRefund: parseUsdtAmount("2000"), sellerPayout: parseUsdtAmount("5000"), platformFee: 1n,
  }, total), false); // Fee cannot be reduced or invented by the decision.
  assertEquals(validateDisputeAllocation(total, {
    buyerGrossRefund: parseUsdtAmount("2000"), sellerPayout: parseUsdtAmount("5000"), platformFee: fee,
  }, parseUsdtAmount("8000")), false); // Original agreement amount must match the deposit.
});
