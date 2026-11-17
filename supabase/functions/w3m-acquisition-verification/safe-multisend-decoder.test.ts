import { decodeSafeMultiSendCalldata } from "./safe-multisend-decoder.ts";

const TOKEN = "0x3333333333333333333333333333333333333333";
const SELLER = "0x4444444444444444444444444444444444444444";
const PLATFORM = "0x5555555555555555555555555555555555555555";

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}
function transfer(recipient: string, amount: bigint): string {
  return "a9059cbb" + recipient.slice(2).toLowerCase().padStart(64, "0") + word(amount);
}
function packedCall(to: string, data: string, operation = 0, value = 0n): string {
  return operation.toString(16).padStart(2, "0") + to.slice(2).toLowerCase() +
    word(value) + word(BigInt(data.length / 2)) + data;
}
function multisend(calls: string[]): string {
  const body = calls.join("");
  const bytes = body.length / 2;
  const padded = body.padEnd(Math.ceil(bytes / 32) * 64, "0");
  return "0x8d80ff0a" + word(32n) + word(BigInt(bytes)) + padded;
}
function assert(ok: boolean, message: string) {
  if (!ok) throw new Error(message);
}

Deno.test("decodes the two expected ERC20 transfer calls", () => {
  const data = multisend([
    packedCall(TOKEN, transfer(SELLER, 9250000000000000000n)),
    packedCall(TOKEN, transfer(PLATFORM, 750000000000000000n)),
  ]);
  const result = decodeSafeMultiSendCalldata(data);
  assert(result.valid, JSON.stringify(result.issues));
  assert(result.calls.length === 2, "expected exactly two calls");
  assert(result.calls[0].recipient?.toLowerCase() === SELLER.toLowerCase(), "seller recipient mismatch");
  assert(result.calls[0].amount === "9250000000000000000", "seller amount mismatch");
  assert(result.calls[1].recipient?.toLowerCase() === PLATFORM.toLowerCase(), "platform recipient mismatch");
  assert(result.calls[1].amount === "750000000000000000", "platform amount mismatch");
});

Deno.test("rejects a wrong MultiSend selector", () => {
  const result = decodeSafeMultiSendCalldata("0x12345678" + word(32n) + word(0n));
  assert(!result.valid && result.issues.includes("MULTISEND_SELECTOR_MISMATCH"), "wrong selector accepted");
});

Deno.test("rejects malformed ABI offset", () => {
  const result = decodeSafeMultiSendCalldata("0x8d80ff0a" + word(64n) + word(0n));
  assert(!result.valid && result.issues.includes("ABI_OFFSET_INVALID"), "wrong offset accepted");
});

Deno.test("rejects truncated MultiSend call data", () => {
  const body = "00" + TOKEN.slice(2) + word(0n) + word(100n) + "a9059cbb";
  const result = decodeSafeMultiSendCalldata(multisend([body]));
  assert(!result.valid && result.issues.includes("MULTISEND_CALL_DATA_TRUNCATED"), "truncated call accepted");
});

Deno.test("rejects nonzero ABI padding", () => {
  const valid = multisend([packedCall(TOKEN, transfer(SELLER, 1n))]);
  const tampered = valid.slice(0, -2) + "ff";
  const result = decodeSafeMultiSendCalldata(tampered);
  assert(!result.valid && result.issues.includes("ABI_PADDING_INVALID"), "nonzero padding accepted");
});

Deno.test("decodes but preserves unexpected inner method for later rejection", () => {
  const approveSelector = "095ea7b3" + word(0n) + word(1n);
  const result = decodeSafeMultiSendCalldata(multisend([packedCall(TOKEN, approveSelector)]));
  assert(result.valid, JSON.stringify(result.issues));
  assert(result.calls[0].method === "unknown", "unexpected method was not identified");
});

Deno.test("rejects empty MultiSend payload", () => {
  const result = decodeSafeMultiSendCalldata(multisend([]));
  assert(!result.valid && result.issues.includes("MULTISEND_HAS_NO_CALLS"), "empty payload accepted");
});
