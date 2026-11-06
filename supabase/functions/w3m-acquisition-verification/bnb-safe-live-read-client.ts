// W3M Protocol V1 — concrete read-only BNB Safe contract reader.
// All Safe eth_call/getCode reads are pinned to one caller-supplied block tag.
// This module never signs, sends, or broadcasts transactions.
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";
import type { JsonRpcClient } from "./bnb-revenue-adapter.ts";
import type {
  SafeLiveReadClient,
  SafeTransactionHashFields,
} from "./safe-live-execution-facts.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const DATA = /^0x(?:[0-9a-f]{2})*$/i;
const UINT = /^(0|[1-9][0-9]*)$/;
const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;

export class BnbSafeLiveReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BnbSafeLiveReadError";
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
function selector(signature: string): string {
  return "0x" + hex(keccak_256(new TextEncoder().encode(signature)).slice(0, 4));
}
function parseUint(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !HEX_QUANTITY.test(value)) {
    throw new BnbSafeLiveReadError("Safe RPC returned an invalid " + label + ".");
  }
  return BigInt(value);
}
function wordAt(data: string, byteOffset: number): string {
  if (!DATA.test(data) || !Number.isSafeInteger(byteOffset) || byteOffset < 0) {
    throw new BnbSafeLiveReadError("Safe ABI response is malformed.");
  }
  const body = data.slice(2);
  const start = byteOffset * 2;
  const word = body.slice(start, start + 64);
  if (word.length !== 64) throw new BnbSafeLiveReadError("Safe ABI response is truncated.");
  return word.toLowerCase();
}
function decodeUint(data: string, byteOffset = 0): bigint {
  return BigInt("0x" + wordAt(data, byteOffset));
}
function decodeAddressArray(data: string): string[] {
  const offset = decodeUint(data);
  if (offset > BigInt(Number.MAX_SAFE_INTEGER) || offset % 32n !== 0n) {
    throw new BnbSafeLiveReadError("Safe owners ABI offset is invalid.");
  }
  const start = Number(offset);
  const length = decodeUint(data, start);
  if (length < 1n || length > 32n) {
    throw new BnbSafeLiveReadError("Safe owners array length is outside the supported bounds.");
  }
  const owners: string[] = [];
  for (let i = 0; i < Number(length); i++) {
    const word = wordAt(data, start + 32 + i * 32);
    if (!/^0{24}[0-9a-f]{40}$/.test(word)) {
      throw new BnbSafeLiveReadError("Safe owners array contains a malformed address word.");
    }
    owners.push("0x" + word.slice(24));
  }
  return owners;
}
function decodeString(data: string): string {
  const offset = decodeUint(data);
  if (offset > BigInt(Number.MAX_SAFE_INTEGER) || offset % 32n !== 0n) {
    throw new BnbSafeLiveReadError("Safe VERSION() ABI offset is invalid.");
  }
  const start = Number(offset);
  const length = decodeUint(data, start);
  if (length < 1n || length > 128n) {
    throw new BnbSafeLiveReadError("Safe VERSION() string length is invalid.");
  }
  const body = data.slice(2);
  const begin = (start + 32) * 2;
  const end = begin + Number(length) * 2;
  const encoded = body.slice(begin, end);
  if (encoded.length !== Number(length) * 2 || !/^[0-9a-f]+$/i.test(encoded)) {
    throw new BnbSafeLiveReadError("Safe VERSION() string is truncated.");
  }
  const bytes = new Uint8Array(encoded.match(/.{2}/g)!.map((part) => parseInt(part, 16)));
  const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!value.trim()) throw new BnbSafeLiveReadError("Safe VERSION() returned an empty string.");
  return value;
}
function uintWord(value: string, label: string): string {
  if (!UINT.test(value)) throw new BnbSafeLiveReadError("Safe transaction " + label + " is invalid.");
  const encoded = BigInt(value).toString(16);
  if (encoded.length > 64) throw new BnbSafeLiveReadError("Safe transaction " + label + " exceeds uint256.");
  return encoded.padStart(64, "0");
}
function addressWord(value: string, label: string): string {
  if (!ADDRESS.test(value)) throw new BnbSafeLiveReadError("Safe transaction " + label + " is invalid.");
  return value.slice(2).toLowerCase().padStart(64, "0");
}
function bytesTail(value: string): string {
  if (!DATA.test(value)) throw new BnbSafeLiveReadError("Safe transaction data is invalid.");
  const body = value.slice(2).toLowerCase();
  const length = body.length / 2;
  const padded = body.padEnd(Math.ceil(body.length / 64) * 64, "0");
  return BigInt(length).toString(16).padStart(64, "0") + padded;
}
function encodeSafeTransactionHashCall(fields: SafeTransactionHashFields): string {
  if (fields.operation !== 0 && fields.operation !== 1) {
    throw new BnbSafeLiveReadError("Safe transaction operation must be CALL or DELEGATECALL.");
  }
  const head = [
    addressWord(fields.to, "target"),
    uintWord(fields.value, "value"),
    uintWord("320", "data offset"),
    uintWord(String(fields.operation), "operation"),
    uintWord(fields.safeTxGas, "safeTxGas"),
    uintWord(fields.baseGas, "baseGas"),
    uintWord(fields.gasPrice, "gasPrice"),
    addressWord(fields.gasToken, "gasToken"),
    addressWord(fields.refundReceiver, "refundReceiver"),
    uintWord(fields.nonce, "nonce"),
  ].join("");
  return selector("getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)") +
    head + bytesTail(fields.data);
}

export interface BnbSafeLiveReadClient extends SafeLiveReadClient {
  readonly blockTag: string;
}

export function createBnbSafeLiveReadClient(
  rpc: JsonRpcClient,
  blockTag: string,
): BnbSafeLiveReadClient {
  if (typeof blockTag !== "string" || !HEX_QUANTITY.test(blockTag)) {
    throw new BnbSafeLiveReadError("A fixed canonical BNB block tag is required.");
  }
  async function call(safeAddress: string, data: string): Promise<string> {
    if (!ADDRESS.test(safeAddress) || !/^0x[0-9a-f]{8,}$/i.test(data)) {
      throw new BnbSafeLiveReadError("Safe eth_call target or calldata is malformed.");
    }
    const result = await rpc.request<unknown>("eth_call", [
      { to: safeAddress, data },
      blockTag,
    ]);
    if (typeof result !== "string" || !DATA.test(result)) {
      throw new BnbSafeLiveReadError("Safe eth_call returned malformed hex data.");
    }
    return result;
  }
  return {
    blockTag,
    async getChainId() {
      const value = await rpc.request<unknown>("eth_chainId", []);
      const parsed = parseUint(value, "chain ID");
      if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new BnbSafeLiveReadError("BNB chain ID exceeds safe integer bounds.");
      }
      return Number(parsed);
    },
    async getCode(address: string) {
      const value = await rpc.request<unknown>("eth_getCode", [address, blockTag]);
      if (typeof value !== "string" || !DATA.test(value)) {
        throw new BnbSafeLiveReadError("Safe bytecode RPC response is malformed.");
      }
      return value;
    },
    async getOwners(safeAddress: string) {
      return decodeAddressArray(await call(safeAddress, selector("getOwners()")));
    },
    async getThreshold(safeAddress: string) {
      return decodeUint(await call(safeAddress, selector("getThreshold()")));
    },
    async getNonce(safeAddress: string) {
      return decodeUint(await call(safeAddress, selector("nonce()")));
    },
    async getVersion(safeAddress: string) {
      return decodeString(await call(safeAddress, selector("VERSION()")));
    },
    async getTransactionHash(safeAddress: string, fields: SafeTransactionHashFields) {
      const result = await call(safeAddress, encodeSafeTransactionHashCall(fields));
      if (!HASH.test(result)) throw new BnbSafeLiveReadError("Safe getTransactionHash() did not return bytes32.");
      return result;
    },
  };
}
