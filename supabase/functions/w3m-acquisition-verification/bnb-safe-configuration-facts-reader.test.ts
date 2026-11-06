import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";
import type { JsonRpcClient } from "./bnb-revenue-adapter.ts";
import { readCanonicalBnbSafeConfigurationFacts } from "./bnb-safe-configuration-facts-reader.ts";

const SAFE="0x1111111111111111111111111111111111111111";
const BUYER="0x2222222222222222222222222222222222222222";
const SELLER="0x3333333333333333333333333333333333333333";
const PLATFORM="0x4444444444444444444444444444444444444444";
const BLOCK="0x123456", BLOCK_HASH="0x"+"9".repeat(64);
function selector(signature:string){return "0x"+Array.from(keccak_256(new TextEncoder().encode(signature)).slice(0,4),b=>b.toString(16).padStart(2,"0")).join("");}
function word(v:bigint){return v.toString(16).padStart(64,"0");}
function addressWord(v:string){return v.slice(2).toLowerCase().padStart(64,"0");}
function stringResult(v:string){const b=Array.from(new TextEncoder().encode(v),x=>x.toString(16).padStart(2,"0")).join("");return "0x"+word(32n)+word(BigInt(b.length/2))+b.padEnd(Math.ceil(b.length/64)*64,"0");}
function ownersResult(){return "0x"+word(32n)+word(3n)+addressWord(BUYER)+addressWord(SELLER)+addressWord(PLATFORM);}
function makeRpc(reorg=false){const calls:string[]=[];let headers=0;const rpc:JsonRpcClient={async request<T>(method:string,params:unknown[]):Promise<T>{
 calls.push(method);let result:unknown;
 if(method==="eth_chainId")result="0x38";
 else if(method==="eth_blockNumber")result=BLOCK;
 else if(method==="eth_getBlockByNumber"){headers++;result={number:BLOCK,hash:reorg&&headers>1?"0x"+"8".repeat(64):BLOCK_HASH};}
 else if(method==="eth_getCode")result="0x60016000";
 else if(method==="eth_call"){const data=String((params[0] as Record<string,unknown>).data),sig=data.slice(0,10).toLowerCase();
  if(sig===selector("getOwners()"))result=ownersResult();
  else if(sig===selector("getThreshold()"))result="0x"+word(2n);
  else if(sig===selector("nonce()"))result="0x"+word(7n);
  else if(sig===selector("VERSION()"))result=stringResult("1.4.1");
  else result="0x";
 } else result=null;return result as T;}};return {rpc,calls};}
const expected={safeAddress:SAFE,expectedSafeAddress:SAFE,expectedOwners:[BUYER,SELLER,PLATFORM],expectedThreshold:2,expectedVersion:"1.4.1",expectedChainId:56,expectedNonce:"7"};

Deno.test("PREPARE Safe configuration reads at one canonical BNB block without requiring a transaction hash",async()=>{
 const {rpc,calls}=makeRpc();const result=await readCanonicalBnbSafeConfigurationFacts(rpc,expected);
 assertEquals(result.valid,true);assertEquals(result.nonce,"7");assertEquals(result.readBlockNumber,BLOCK);
 assertEquals(result.readBlockHash,BLOCK_HASH);assertEquals(calls.filter(x=>x==="eth_getBlockByNumber").length,2);
 assertEquals(calls.includes("eth_call"),true);
});

Deno.test("PREPARE Safe configuration fails closed when the pinned block changes",async()=>{
 const {rpc}=makeRpc(true);const result=await readCanonicalBnbSafeConfigurationFacts(rpc,expected);
 assertEquals(result.valid,false);assertEquals(result.issues.includes("SAFE_READ_BLOCK_NOT_CANONICAL"),true);
});

Deno.test("PREPARE Safe configuration rejects malformed block headers",async()=>{
 const rpc:JsonRpcClient={async request<T>(method:string):Promise<T>{
  if(method==="eth_chainId")return "0x38" as T;if(method==="eth_blockNumber")return BLOCK as T;
  if(method==="eth_getBlockByNumber")return {number:BLOCK,hash:"0x12"} as T;
  throw new Error("Unexpected RPC method");
 }};
 await assertRejects(()=>readCanonicalBnbSafeConfigurationFacts(rpc,expected));
});
