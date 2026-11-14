import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateLockedSafeTransaction, type PolicyInput } from "./guard-policy-model.ts";

const safe = "0x1111111111111111111111111111111111111111";
const token = "0x2222222222222222222222222222222222222222";
const seller = "0x3333333333333333333333333333333333333333";
const platform = "0x4444444444444444444444444444444444444444";
const hash = "0x" + "a".repeat(64);

function fixture(): PolicyInput {
  const effects = [
    { kind: "erc20_transfer" as const, target: token, recipient: seller, amount: "6475000000" },
    { kind: "erc20_transfer" as const, target: token, recipient: platform, amount: "525000000" },
  ];
  return {
    lockState: "confirmed",
    tx: { chainId: 56, safe, to: token, value: "0", dataHash: hash, operation: "CALL", safeNonce: 8, viaModule: false },
    intent: { chainId: 56, safe, to: token, value: "0", dataHash: hash, operation: "CALL", safeNonce: 8,
      decisionHash: hash, decisionNonce: 3, token, effects },
    decoded: { complete: true, effects },
    moduleGuardCovered: false,
    consumedDecisionNonces: [],
    consumedSafeNonces: [],
  };
}

Deno.test("allows only exact, complete, decision-bound USDT allocation", () => {
  assertEquals(evaluateLockedSafeTransaction(fixture()).allowed, true);
});

Deno.test("submitted or pending dispute lock is not represented as confirmed", () => {
  for (const lockState of ["submitted", "lock_pending"] as const) {
    const input = fixture(); input.lockState = lockState;
    assertEquals(evaluateLockedSafeTransaction(input).reason, "dispute_lock_not_confirmed");
  }
});

Deno.test("blocks ordinary seller payout and any extra transfer", () => {
  const input = fixture();
  input.decoded.effects = input.decoded.effects.slice(0, 1);
  assertEquals(evaluateLockedSafeTransaction(input).reason, "decoded_effects_do_not_match_decision");
  input.decoded.effects.push({ kind: "erc20_transfer", target: token, recipient: safe, amount: "1" });
  assertEquals(evaluateLockedSafeTransaction(input).reason, "decoded_effects_do_not_match_decision");
});

Deno.test("blocks token approvals, native transfers, arbitrary calls and Safe configuration changes", () => {
  for (const kind of ["erc20_approve", "native_transfer", "arbitrary_call", "safe_configuration"] as const) {
    const input = fixture();
    input.decoded.effects = [...input.decoded.effects, { kind, target: token }];
    assertEquals(evaluateLockedSafeTransaction(input).allowed, false);
  }
});

Deno.test("blocks delegatecall and incomplete nested-call decoding", () => {
  const delegate = fixture(); delegate.tx.operation = "DELEGATECALL";
  assertEquals(evaluateLockedSafeTransaction(delegate).reason, "delegatecall_or_unsupported_operation");
  const partial = fixture(); partial.decoded.complete = false;
  assertEquals(evaluateLockedSafeTransaction(partial).reason, "incomplete_transaction_decode");
});

Deno.test("blocks uncovered module execution", () => {
  const input = fixture(); input.tx.viaModule = true;
  assertEquals(evaluateLockedSafeTransaction(input).reason, "module_guard_not_verified");
  input.moduleGuardCovered = true;
  assertEquals(evaluateLockedSafeTransaction(input).allowed, true);
});

Deno.test("blocks wrong chain, Safe, token target, amount or transaction tuple", () => {
  const cases = [
    (x: PolicyInput) => x.tx.chainId = 97,
    (x: PolicyInput) => x.tx.safe = platform,
    (x: PolicyInput) => x.tx.to = seller,
    (x: PolicyInput) => x.tx.value = "1",
    (x: PolicyInput) => x.tx.dataHash = "0x" + "b".repeat(64),
    (x: PolicyInput) => x.tx.safeNonce++,
    (x: PolicyInput) => x.decoded.effects[0].amount = "1",
  ];
  for (const mutate of cases) {
    const input = fixture(); mutate(input);
    assertEquals(evaluateLockedSafeTransaction(input).allowed, false);
  }
});

Deno.test("blocks replayed decision and Safe nonces", () => {
  const decision = fixture(); decision.consumedDecisionNonces = [3];
  assertEquals(evaluateLockedSafeTransaction(decision).reason, "replay_detected");
  const safeNonce = fixture(); safeNonce.consumedSafeNonces = [8];
  assertEquals(evaluateLockedSafeTransaction(safeNonce).reason, "replay_detected");
});

Deno.test("fails closed for empty or malformed allocations", () => {
  const empty = fixture(); empty.intent.effects = []; empty.decoded.effects = [];
  assertEquals(evaluateLockedSafeTransaction(empty).reason, "empty_settlement");
  const malformed = fixture(); malformed.intent.effects[0].amount = "-5";
  assertEquals(evaluateLockedSafeTransaction(malformed).reason, "invalid_expected_allocation");
});
