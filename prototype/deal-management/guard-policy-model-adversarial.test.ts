import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateLockedSafeTransaction, type PolicyInput } from "./guard-policy-model.ts";

const safe = "0x1111111111111111111111111111111111111111";
const token = "0x2222222222222222222222222222222222222222";
const seller = "0x3333333333333333333333333333333333333333";
const platform = "0x4444444444444444444444444444444444444444";
const attacker = "0x5555555555555555555555555555555555555555";
const hash = "0x" + "c".repeat(64);

function base(): PolicyInput {
  const effects = [
    { kind: "erc20_transfer" as const, target: token, recipient: seller, amount: "6475000000" },
    { kind: "erc20_transfer" as const, target: token, recipient: platform, amount: "525000000" },
  ];
  return {
    lockState: "confirmed",
    tx: { chainId: 56, safe, to: token, value: "0", dataHash: hash, operation: "CALL", safeNonce: 19, viaModule: false },
    intent: { chainId: 56, safe, to: token, value: "0", dataHash: hash, operation: "CALL", safeNonce: 19,
      decisionHash: hash, decisionNonce: 12, token, approvedExecutionTargets: [token], effects },
    decoded: { complete: true, effects: effects.map(effect => ({ ...effect })) },
    moduleGuardCovered: false,
    approvedDecisionHash: hash,
    approvedDecisionNonce: 12,
    consumedDecisionNonces: [],
    consumedSafeNonces: [],
  };
}

Deno.test("blocks attempted Safe Guard removal or replacement", () => {
  for (const selectorAttempt of ["setGuard(0)", "setGuard(attacker)", "setModuleGuard(0)",
    "enableModule(attacker)", "disableModule(existing)", "changeThreshold(1)",
    "addOwnerWithThreshold(attacker)", "removeOwner(owner)", "swapOwner(owner,attacker)",
    "setFallbackHandler(attacker)"]) {
    const input = base();
    input.decoded.effects.push({ kind: "safe_configuration", target: safe, recipient: selectorAttempt });
    assertEquals(evaluateLockedSafeTransaction(input).allowed, false);
  }
});

Deno.test("blocks malicious MultiSend with a hidden extra nested transfer", () => {
  const input = base();
  // The hypothetical trusted decoder must expose every nested effect, not just the outer MultiSend call.
  const multiSend = "0x6666666666666666666666666666666666666666";
  input.tx.to = multiSend;
  input.intent.to = multiSend;
  input.intent.approvedExecutionTargets.push(multiSend);
  input.decoded.effects.push({
    kind: "erc20_transfer", target: token, recipient: attacker, amount: "1",
  });
  assertEquals(evaluateLockedSafeTransaction(input).reason, "decoded_effects_do_not_match_decision");
});

Deno.test("blocks hidden nested approval or native BNB movement in a batch", () => {
  for (const effect of [
    { kind: "erc20_approve" as const, target: token, recipient: attacker, amount: "999999" },
    { kind: "native_transfer" as const, target: safe, recipient: attacker, amount: "1" },
    { kind: "arbitrary_call" as const, target: attacker },
  ]) {
    const input = base();
    input.decoded.effects.push(effect);
    assertEquals(evaluateLockedSafeTransaction(input).allowed, false);
  }
});

Deno.test("blocks an otherwise exact batch if the decision hash or decision nonce is invalid", () => {
  const badHash = base(); badHash.intent.decisionHash = "0x1234";
  assertEquals(evaluateLockedSafeTransaction(badHash).reason, "invalid_decision_or_nonce");
  const badNonce = base(); badNonce.intent.decisionNonce = -1;
  assertEquals(evaluateLockedSafeTransaction(badNonce).reason, "invalid_decision_or_nonce");
});

Deno.test("blocks payout attempts when dispute is absent, merely submitted, or pending", () => {
  for (const lockState of ["none", "submitted", "lock_pending"] as const) {
    const input = base(); input.lockState = lockState;
    assertEquals(evaluateLockedSafeTransaction(input).allowed, false);
  }
});

Deno.test("blocks a settlement sent to a non-token target", () => {
  const input = base();
  input.tx.to = attacker;
  input.intent.to = attacker;
  assertEquals(evaluateLockedSafeTransaction(input).reason, "settlement_target_not_approved");
});

Deno.test("does not treat a different recipient as the approved decision allocation", () => {
  const input = base();
  input.decoded.effects[0].recipient = attacker;
  assertEquals(evaluateLockedSafeTransaction(input).reason, "decoded_effects_do_not_match_decision");
});
