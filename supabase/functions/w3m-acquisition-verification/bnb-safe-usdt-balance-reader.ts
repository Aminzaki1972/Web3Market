// W3M Protocol V1 — canonical-block BNB USDT balance reader for refund preparation.
// Read-only JSON-RPC. The balance is read at the Safe configuration block and that
// block hash is rechecked after eth_call to reject a reorg during the snapshot.
import type { JsonRpcClient } from "./bnb-revenue-adapter.ts";
import { W3M_BNB_USDT } from "./buyer-refund-request-builder.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const UINT = /^(0|[1-9][0-9]*)$/;
const BALANCE_OF = "70a08231";

function fail(message: string): never { throw new Error("W3M_SAFE_USDT_BALANCE: " + message); }
function blockTag(decimal: string): string {
  if (!UINT.test(decimal)) fail("canonical block number is malformed");
  return "0x" + BigInt(decimal).toString(16);
}
function header(value: unknown, expectedTag: string): { hash: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("block header is malformed");
  const row = value as Record<string, unknown>;
  if (typeof row.number !== "string" || row.number.toLowerCase() !== expectedTag.toLowerCase() ||
      typeof row.hash !== "string" || !HASH.test(row.hash)) fail("block header identity is invalid");
  return { hash: row.hash.toLowerCase() };
}
function decimalFromUnits(value: bigint): string {
  const scale = 10n ** 18n;
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}

export interface CanonicalBnbUsdtBalance {
  chainId: 56;
  tokenAddress: string;
  safeAddress: string;
  blockNumber: string;
  blockHash: string;
  balanceBaseUnits: string;
  balance: string;
}

export async function readCanonicalBnbUsdtBalance(
  rpc: JsonRpcClient,
  input: { safeAddress: string; blockNumber: string; blockHash: string },
): Promise<CanonicalBnbUsdtBalance> {
  if (!ADDRESS.test(input.safeAddress) || !UINT.test(input.blockNumber) || !HASH.test(input.blockHash)) {
    fail("requested Safe snapshot is malformed");
  }
  const chain = await rpc.request<unknown>("eth_chainId", []);
  if (typeof chain !== "string" || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== 56n) {
    fail("RPC is not BNB Chain mainnet");
  }
  const tag = blockTag(input.blockNumber);
  const before = header(await rpc.request<unknown>("eth_getBlockByNumber", [tag, false]), tag);
  if (before.hash !== input.blockHash.toLowerCase()) fail("requested Safe snapshot block is no longer canonical");
  const callData = "0x" + BALANCE_OF + input.safeAddress.slice(2).toLowerCase().padStart(64, "0");
  const raw = await rpc.request<unknown>("eth_call", [{ to: W3M_BNB_USDT, data: callData }, tag]);
  if (typeof raw !== "string" || !/^0x[0-9a-f]{64}$/i.test(raw)) fail("USDT balanceOf returned malformed data");
  const after = header(await rpc.request<unknown>("eth_getBlockByNumber", [tag, false]), tag);
  if (after.hash !== before.hash) fail("Safe balance block changed during read");
  const units = BigInt(raw);
  return {
    chainId: 56,
    tokenAddress: W3M_BNB_USDT,
    safeAddress: input.safeAddress.toLowerCase(),
    blockNumber: input.blockNumber,
    blockHash: before.hash,
    balanceBaseUnits: units.toString(),
    balance: decimalFromUnits(units),
  };
}
