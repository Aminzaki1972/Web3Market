// W3M Protocol V1 — strict decoder for Safe MultiSendCallOnly calldata.
// Pure parsing only. The caller must supply the exact signed Safe transaction fields.
// This decoder does not authorize, sign, submit, or execute any transaction.

export interface DecodedMultiSendCall {
  operation: number;
  to: string;
  value: string;
  method: string;
  recipient?: string;
  amount?: string;
}

export interface MultiSendDecodeResult {
  valid: boolean;
  calls: DecodedMultiSendCall[];
  issues: string[];
}

const MULTISEND_SELECTOR = "8d80ff0a";
const ERC20_TRANSFER_SELECTOR = "a9059cbb";
const HEX = /^[0-9a-fA-F]*$/;

function readUint(hex: string): bigint {
  if (!hex || !HEX.test(hex) || hex.length % 2 !== 0) throw new Error("HEX_INVALID");
  return BigInt("0x" + (hex || "0"));
}

function safeNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("INTEGER_OUT_OF_RANGE");
  return Number(value);
}

function decodeTransfer(data: string): { method: string; recipient?: string; amount?: string } {
  if (data.length < 8) return { method: "unknown" };
  const selector = data.slice(0, 8).toLowerCase();
  if (selector !== ERC20_TRANSFER_SELECTOR) return { method: "unknown" };
  if (data.length !== 8 + 64 + 64) return { method: "transfer" };
  const addressWord = data.slice(8, 72);
  if (!/^0{24}[0-9a-fA-F]{40}$/.test(addressWord)) return { method: "transfer" };
  const amountWord = data.slice(72, 136);
  return {
    method: "transfer",
    recipient: "0x" + addressWord.slice(24),
    amount: readUint(amountWord).toString(),
  };
}

export function decodeSafeMultiSendCalldata(calldata: string): MultiSendDecodeResult {
  const issues: string[] = [];
  const calls: DecodedMultiSendCall[] = [];
  if (typeof calldata !== "string" || !/^0x[0-9a-fA-F]+$/.test(calldata)) {
    return { valid: false, calls, issues: ["CALLDATA_FORMAT_INVALID"] };
  }

  const hex = calldata.slice(2);
  if (hex.length < 8 + 64 + 64 || hex.length % 2 !== 0) {
    return { valid: false, calls, issues: ["CALLDATA_TOO_SHORT_OR_UNALIGNED"] };
  }
  if (hex.slice(0, 8).toLowerCase() !== MULTISEND_SELECTOR) {
    return { valid: false, calls, issues: ["MULTISEND_SELECTOR_MISMATCH"] };
  }

  let offset: number;
  let byteLength: number;
  try {
    offset = safeNumber(readUint(hex.slice(8, 72)));
    if (offset !== 32) throw new Error("ABI_OFFSET_INVALID");
    byteLength = safeNumber(readUint(hex.slice(72, 136)));
  } catch (error) {
    return { valid: false, calls, issues: [String(error instanceof Error ? error.message : error)] };
  }

  const bodyStart = 136;
  const bodyEnd = bodyStart + byteLength * 2;
  const paddedEnd = bodyStart + Math.ceil(byteLength / 32) * 64;
  if (!Number.isSafeInteger(bodyEnd) || bodyEnd > hex.length || paddedEnd !== hex.length) {
    return { valid: false, calls, issues: ["ABI_DYNAMIC_BYTES_LENGTH_INVALID"] };
  }
  if (!/^0*$/.test(hex.slice(bodyEnd, paddedEnd))) {
    return { valid: false, calls, issues: ["ABI_PADDING_INVALID"] };
  }

  const body = hex.slice(bodyStart, bodyEnd);
  let cursor = 0;
  while (cursor < body.length) {
    if (body.length - cursor < 170) {
      issues.push("MULTISEND_CALL_HEADER_TRUNCATED");
      break;
    }
    const operation = Number.parseInt(body.slice(cursor, cursor + 2), 16);
    const to = "0x" + body.slice(cursor + 2, cursor + 42);
    const valueHex = body.slice(cursor + 42, cursor + 106);
    const lengthHex = body.slice(cursor + 106, cursor + 170);
    let value: string;
    let dataLength: number;
    try {
      value = readUint(valueHex).toString();
      dataLength = safeNumber(readUint(lengthHex));
    } catch (error) {
      issues.push(String(error instanceof Error ? error.message : error));
      break;
    }
    const dataStart = cursor + 170;
    const dataEnd = dataStart + dataLength * 2;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > body.length) {
      issues.push("MULTISEND_CALL_DATA_TRUNCATED");
      break;
    }
    const callData = body.slice(dataStart, dataEnd);
    const decoded = decodeTransfer(callData);
    calls.push({ operation, to, value, ...decoded });
    cursor = dataEnd;
  }

  if (cursor !== body.length && issues.length === 0) issues.push("MULTISEND_TRAILING_BYTES");
  if (calls.length === 0) issues.push("MULTISEND_HAS_NO_CALLS");
  return { valid: issues.length === 0, calls, issues };
}
