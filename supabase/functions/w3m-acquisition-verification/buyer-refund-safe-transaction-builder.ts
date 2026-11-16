// W3M Protocol V1 — exact unsigned Safe MultiSend transaction builder for buyer refunds.
// Pure deterministic encoding only. Safe hash must be read from the live Safe contract
// at a canonical BNB block by the caller. This module never signs or broadcasts.
import { W3M_BNB_USDT, W3M_PLATFORM_WALLET, type BuyerRefundRequestIntent } from "./buyer-refund-request-builder.ts";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^(0|[1-9][0-9]*)$/;
const DECIMAL = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,18}))?$/;
export const W3M_BNB_MULTISEND_CALL_ONLY = "0x9641d764fc13c8b624c04430c7356c1c7c8102e2";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const SCALE = 10n ** 18n;

export interface BuyerRefundSafeTransactionFields {
  to: string;
  value: string;
  data: string;
  operation: 1;
  safeTxGas: "0";
  baseGas: "0";
  gasPrice: "0";
  gasToken: string;
  refundReceiver: string;
  nonce: string;
}
export interface BuyerRefundSafeTransactionBuild {
  action: "refund_to_buyer";
  chainId: 56;
  safeAddress: string;
  safeTransaction: BuyerRefundSafeTransactionFields;
  innerTransfers: Array<{ token: string; recipient: string; amount: string; amountUnits: string }>;
}
function address(value: string): string {
  if (!ADDRESS.test(value || "")) throw new Error("REFUND_SAFE_TX_ADDRESS_INVALID");
  return value.toLowerCase();
}
function word(value: bigint): string {
  if (value < 0n || value >= (1n << 256n)) throw new Error("REFUND_SAFE_TX_UINT256_OUT_OF_RANGE");
  return value.toString(16).padStart(64, "0");
}
function units(value: string): bigint {
  if (!DECIMAL.test(value || "")) throw new Error("REFUND_SAFE_TX_AMOUNT_INVALID");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt((fraction + "0".repeat(18)).slice(0, 18));
}
function transferData(recipient: string, amount: bigint): string {
  return "a9059cbb" + recipient.slice(2).padStart(64, "0") + word(amount);
}
function packedCall(token: string, callData: string): string {
  const byteLength = BigInt(callData.length / 2);
  return "00" + token.slice(2) + word(0n) + word(byteLength) + callData;
}
function multiSendCalldata(calls: string[]): string {
  const body = calls.join("");
  const byteLength = body.length / 2;
  const padded = body.padEnd(Math.ceil(byteLength / 32) * 64, "0");
  return "0x8d80ff0a" + word(32n) + word(BigInt(byteLength)) + padded;
}

/** Builds exact two-transfer calldata and Safe fields; caller obtains hash via Safe.getTransactionHash. */
export function buildBuyerRefundSafeTransaction(
  intent: BuyerRefundRequestIntent,
  safeNonce: string,
): BuyerRefundSafeTransactionBuild {
  if (intent.action !== "refund_to_buyer" || intent.chainId !== 56 ||
      !UINT.test(safeNonce || "") || safeNonce !== intent.safeNonce) {
    throw new Error("REFUND_SAFE_TX_CONTEXT_INVALID");
  }
  const safe = address(intent.safeAddress);
  const token = address(intent.tokenAddress);
  const buyer = address(intent.buyerRecipient);
  const platform = address(W3M_PLATFORM_WALLET);
  if (token !== address(W3M_BNB_USDT)) throw new Error("REFUND_SAFE_TX_TOKEN_NOT_OFFICIAL_BNB_USDT");
  const originalUnits = units(intent.originalDealAmount);
  const refundUnits = units(intent.buyerRefundAmount);
  const feeUnits = units(intent.platformFeeAmount);
  const fundedUnits = units(intent.confirmedFundedAmount);
  const balanceUnits = units(intent.confirmedSafeBalance);
  const expectedFeeUnits = (originalUnits * 75n + 500n) / 1000n;
  if (originalUnits <= 0n || refundUnits <= 0n || fundedUnits <= 0n ||
      refundUnits > fundedUnits || feeUnits !== expectedFeeUnits ||
      refundUnits + feeUnits !== fundedUnits || refundUnits + feeUnits > balanceUnits) {
    throw new Error("REFUND_SAFE_TX_AMOUNT_OR_FIXED_FEE_BINDING_INVALID");
  }
  const transfers = intent.transfers;
  if (!Array.isArray(transfers) || transfers.length !== 2) {
    throw new Error("REFUND_SAFE_TX_REQUIRES_EXACTLY_TWO_TRANSFERS");
  }
  const feeRecipient = address(transfers[1].recipient);
  if (address(transfers[0].to) !== token || transfers[0].method !== "transfer" ||
      address(transfers[0].recipient) !== buyer ||
      units(transfers[0].amount) !== refundUnits ||
      address(transfers[1].to) !== token || transfers[1].method !== "transfer" ||
      feeRecipient !== platform ||
      units(transfers[1].amount) !== feeUnits ||
      buyer === feeRecipient) {
    throw new Error("REFUND_SAFE_TX_TRANSFER_BINDING_MISMATCH");
  }
  const buyerUnits = refundUnits;
  const calldata = multiSendCalldata([
    packedCall(token, transferData(buyer, buyerUnits)),
    packedCall(token, transferData(feeRecipient, feeUnits)),
  ]);
  return {
    action: "refund_to_buyer",
    chainId: 56,
    safeAddress: safe,
    safeTransaction: {
      to: W3M_BNB_MULTISEND_CALL_ONLY,
      value: "0",
      data: calldata,
      operation: 1,
      safeTxGas: "0",
      baseGas: "0",
      gasPrice: "0",
      gasToken: ZERO_ADDRESS,
      refundReceiver: ZERO_ADDRESS,
      nonce: safeNonce,
    },
    innerTransfers: [
      { token, recipient: buyer, amount: intent.buyerRefundAmount, amountUnits: buyerUnits.toString() },
      { token, recipient: feeRecipient, amount: intent.platformFeeAmount, amountUnits: feeUnits.toString() },
    ],
  };
}
