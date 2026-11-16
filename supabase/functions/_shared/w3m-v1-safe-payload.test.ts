import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { ethers } from "npm:ethers@6.15.0";
import { assertW3MV1SafeReleasePayloadMatchesPolicy } from "./w3m-v1-safe-payload.ts";

const MULTISEND_CALL_ONLY = "0x9641d764fc13c8B624c04430C7356C1C7C8102e2";
const USDT = "0x55d398326f99059ff775485246999027b3197955";
const seller = "0x1111111111111111111111111111111111111111";
const platform = "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9";
const erc20 = new ethers.Interface(["function transfer(address to,uint256 amount) returns (bool)"]);
const multisend = new ethers.Interface(["function multiSend(bytes transactions)"]);
function pack(to:string,data:string){
 const bytes=ethers.getBytes(data);
 return ethers.concat([
  "0x00",ethers.getAddress(to),
  ethers.zeroPadValue("0x00",32),
  ethers.zeroPadValue(ethers.toBeHex(bytes.length),32),
  data
 ]);
}
const policy={
 token_contract:USDT,seller_wallet:seller,platform_wallet:platform,
 seller_net_amount:"925.00",fee_amount:"75.00",deal_amount:"1000.00",
};
function transaction(sellerAmount="925.00",feeAmount="75.00"){
 const a=erc20.encodeFunctionData("transfer",[seller,ethers.parseUnits(sellerAmount,18)]);
 const b=erc20.encodeFunctionData("transfer",[platform,ethers.parseUnits(feeAmount,18)]);
 const packed=ethers.concat([pack(USDT,a),pack(USDT,b)]);
 return {
  to_address:MULTISEND_CALL_ONLY,value_wei:"0",operation:1,safe_tx_gas:0,
  base_gas:0,gas_price:0,gas_token:ethers.ZeroAddress,refund_receiver:ethers.ZeroAddress,
  data:multisend.encodeFunctionData("multiSend",[packed]),
 };
}
Deno.test("accepts only the exact two signed seller and platform USDT transfers",()=>{
 assertEquals(assertW3MV1SafeReleasePayloadMatchesPolicy(transaction(),policy),undefined);
});
Deno.test("rejects a changed seller transfer amount",()=>{
 assertThrows(()=>assertW3MV1SafeReleasePayloadMatchesPolicy(transaction("924.00","76.00"),policy));
});
Deno.test("rejects a non-MultiSend envelope",()=>{
 assertThrows(()=>assertW3MV1SafeReleasePayloadMatchesPolicy({...transaction(),operation:0},policy));
});
Deno.test("rejects an extra inner transfer",()=>{
 const tx=transaction();
 const third=pack(USDT,erc20.encodeFunctionData("transfer",[seller,1n]));
 const decoded=multisend.decodeFunctionData("multiSend",tx.data)[0];
 const bad={...tx,data:multisend.encodeFunctionData("multiSend",[ethers.concat([decoded,third])])};
 assertThrows(()=>assertW3MV1SafeReleasePayloadMatchesPolicy(bad,policy));
});
