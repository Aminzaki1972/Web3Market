import { ethers } from "npm:ethers@6.15.0";

const MULTISEND_CALL_ONLY = "0x9641d764fc13c8B624c04430C7356C1C7C8102e2";
const BSC_USDT = "0x55d398326f99059ff775485246999027b3197955";
const MULTISEND = new ethers.Interface(["function multiSend(bytes transactions)"]);
const ERC20 = new ethers.Interface(["function transfer(address to,uint256 amount) returns (bool)"]);

export class W3MSafePayloadError extends Error {
  constructor(message: string) { super(message); this.name = "W3MSafePayloadError"; }
}

export function assertW3MV1SafeReleasePayloadMatchesPolicy(
  tx: Record<string, unknown>,
  policy: Record<string, unknown>,
): void {
  try {
    if (ethers.getAddress(String(tx.to_address)).toLowerCase() !== MULTISEND_CALL_ONLY.toLowerCase() ||
        BigInt(String(tx.value_wei ?? "0")) !== 0n ||
        Number(tx.operation) !== 1 ||
        BigInt(String(tx.safe_tx_gas ?? "0")) !== 0n ||
        BigInt(String(tx.base_gas ?? "0")) !== 0n ||
        BigInt(String(tx.gas_price ?? "0")) !== 0n ||
        ethers.getAddress(String(tx.gas_token ?? ethers.ZeroAddress)) !== ethers.ZeroAddress ||
        ethers.getAddress(String(tx.refund_receiver ?? ethers.ZeroAddress)) !== ethers.ZeroAddress) {
      throw new W3MSafePayloadError("Safe transaction envelope is not the approved MultiSendCallOnly DELEGATECALL.");
    }
    if (ethers.getAddress(String(policy.token_contract)).toLowerCase() !== BSC_USDT.toLowerCase()) {
      throw new W3MSafePayloadError("Release policy token is not BNB USDT.");
    }
    const parsed = MULTISEND.parseTransaction({ data: String(tx.data ?? "0x"), value: 0n });
    if (!parsed || parsed.name !== "multiSend") throw new W3MSafePayloadError("Safe calldata is not a MultiSend batch.");
    const packed = ethers.getBytes(String(parsed.args[0]));
    const calls: Array<{to:string;value:bigint;data:string}> = [];
    let offset = 0;
    while (offset < packed.length) {
      if (offset + 85 > packed.length) throw new W3MSafePayloadError("MultiSend call header is truncated.");
      const operation = packed[offset];
      const to = ethers.getAddress(ethers.hexlify(packed.slice(offset + 1, offset + 21)));
      const value = BigInt(ethers.hexlify(packed.slice(offset + 21, offset + 53)));
      const dataLength = Number(BigInt(ethers.hexlify(packed.slice(offset + 53, offset + 85))));
      if (operation !== 0 || !Number.isSafeInteger(dataLength) || dataLength < 0 ||
          offset + 85 + dataLength > packed.length) {
        throw new W3MSafePayloadError("MultiSend contains an unsupported or malformed inner operation.");
      }
      const data = ethers.hexlify(packed.slice(offset + 85, offset + 85 + dataLength));
      calls.push({to,value,data});
      offset += 85 + dataLength;
    }
    if (calls.length !== 2) throw new W3MSafePayloadError("Release must contain exactly two token transfers.");
    const expected = [
      {to: String(policy.seller_wallet), amount: ethers.parseUnits(String(policy.seller_net_amount), 18)},
      {to: String(policy.platform_wallet), amount: ethers.parseUnits(String(policy.fee_amount), 18)},
    ];
    for (let i=0;i<2;i++) {
      if (calls[i].to.toLowerCase() !== BSC_USDT.toLowerCase() || calls[i].value !== 0n) {
        throw new W3MSafePayloadError("MultiSend inner call is not a zero-value BNB USDT token call.");
      }
      const transfer = ERC20.parseTransaction({data:calls[i].data,value:0n});
      if (!transfer || transfer.name !== "transfer" ||
          String(transfer.args[0]).toLowerCase() !== ethers.getAddress(expected[i].to).toLowerCase() ||
          BigInt(transfer.args[1]) !== expected[i].amount) {
        throw new W3MSafePayloadError("Safe token transfer does not exactly match the signed seller net and platform fee.");
      }
    }
  } catch (error) {
    if (error instanceof W3MSafePayloadError) throw error;
    throw new W3MSafePayloadError(error instanceof Error ? error.message : String(error));
  }
}
