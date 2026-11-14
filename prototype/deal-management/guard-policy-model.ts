/**
 * Guard-policy MODEL for adversarial sandbox tests only.
 *
 * This is not Solidity, a Safe Guard, an ABI decoder, an authorization service,
 * or an on-chain enforcement mechanism. It evaluates already-decoded facts
 * supplied by a hypothetical trusted decoder. Never treat browser-supplied
 * decoded effects as authoritative.
 */
export type DisputeLockState = "none" | "submitted" | "lock_pending" | "confirmed";
export type SafeOperation = "CALL" | "DELEGATECALL";
export type EffectKind =
  | "erc20_transfer"
  | "erc20_approve"
  | "native_transfer"
  | "safe_configuration"
  | "arbitrary_call";

export type DecodedEffect = {
  kind: EffectKind;
  target: string;
  recipient?: string;
  amount?: string;
};

export type SafeTransactionModel = {
  chainId: number;
  safe: string;
  to: string;
  value: string;
  dataHash: string;
  operation: SafeOperation;
  safeNonce: number;
  viaModule: boolean;
};

export type SettlementIntentModel = {
  chainId: number;
  safe: string;
  to: string;
  value: string;
  dataHash: string;
  operation: "CALL";
  safeNonce: number;
  decisionHash: string;
  decisionNonce: number;
  token: string;
  /** Trusted, code-hash-verified execution targets: token directly and/or reviewed MultiSend. */
  approvedExecutionTargets: string[];
  effects: Array<{ kind: "erc20_transfer"; target: string; recipient: string; amount: string }>;
};

export type PolicyInput = {
  lockState: DisputeLockState;
  tx: SafeTransactionModel;
  intent: SettlementIntentModel;
  decoded: { complete: boolean; effects: DecodedEffect[] };
  moduleGuardCovered: boolean;
  consumedDecisionNonces: number[];
  consumedSafeNonces: number[];
};

export type PolicyResult = { allowed: true; reason: "exact_authorized_settlement" } |
  { allowed: false; reason: string };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function effectKey(e: DecodedEffect): string {
  return [e.kind, e.target.toLowerCase(), (e.recipient ?? "").toLowerCase(), e.amount ?? ""].join("|");
}

/**
 * Desired locked-state policy model:
 * - no ordinary outgoing transaction during a dispute;
 * - only one exact, fully decoded, decision-authorized USDT transfer batch;
 * - no delegatecall, hidden effects, approvals, config changes or uncovered modules.
 * This function cannot enforce anything on a real Safe.
 */
export function evaluateLockedSafeTransaction(input: PolicyInput): PolicyResult {
  const { tx, intent, decoded } = input;
  if (input.lockState !== "confirmed") return { allowed: false, reason: "dispute_lock_not_confirmed" };
  if (tx.chainId !== 56 || intent.chainId !== 56) return { allowed: false, reason: "wrong_chain" };
  if (!same(tx.safe, intent.safe) || !/^0x[0-9a-fA-F]{40}$/.test(tx.safe)) {
    return { allowed: false, reason: "wrong_safe" };
  }
  if (tx.viaModule && !input.moduleGuardCovered) return { allowed: false, reason: "module_guard_not_verified" };
  if (tx.operation !== "CALL" || intent.operation !== "CALL") return { allowed: false, reason: "delegatecall_or_unsupported_operation" };
  if (tx.to.toLowerCase() !== intent.to.toLowerCase() ||
      tx.value !== intent.value ||
      tx.dataHash.toLowerCase() !== intent.dataHash.toLowerCase() ||
      tx.safeNonce !== intent.safeNonce) return { allowed: false, reason: "transaction_tuple_mismatch" };
  if (!/^0x[0-9a-fA-F]{64}$/.test(intent.decisionHash) ||
      !Number.isSafeInteger(intent.decisionNonce) || intent.decisionNonce < 0 ||
      !Number.isSafeInteger(tx.safeNonce) || tx.safeNonce < 0) {
    return { allowed: false, reason: "invalid_decision_or_nonce" };
  }
  if (input.consumedDecisionNonces.includes(intent.decisionNonce) ||
      input.consumedSafeNonces.includes(tx.safeNonce)) return { allowed: false, reason: "replay_detected" };
  if (!/^0x[0-9a-fA-F]{40}$/.test(intent.token) ||
      !intent.approvedExecutionTargets.some(target => /^0x[0-9a-fA-F]{40}$/.test(target) && same(intent.to, target))) {
    return { allowed: false, reason: "settlement_target_not_approved" };
  }
  if (!decoded.complete) return { allowed: false, reason: "incomplete_transaction_decode" };
  if (intent.effects.length === 0) return { allowed: false, reason: "empty_settlement" };

  const expected = intent.effects.map(effectKey).sort();
  const actual = decoded.effects.map(effectKey).sort();
  if (intent.effects.some(e => e.kind !== "erc20_transfer" || !same(e.target, intent.token) ||
      !/^0x[0-9a-fA-F]{40}$/.test(e.recipient) || !/^\d+$/.test(e.amount) || BigInt(e.amount) <= 0n)) {
    return { allowed: false, reason: "invalid_expected_allocation" };
  }
  if (actual.some((_, i) => actual[i] !== expected[i]) || actual.length !== expected.length) {
    return { allowed: false, reason: "decoded_effects_do_not_match_decision" };
  }
  return { allowed: true, reason: "exact_authorized_settlement" };
}
