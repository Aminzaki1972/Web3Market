import { readAndVerifySafeConfigurationFacts, type SafeConfigurationReadClient, type SafeConfigurationExpectation } from "./safe-live-configuration-facts.ts";

const SAFE="0x1111111111111111111111111111111111111111";
const BUYER="0x2222222222222222222222222222222222222222";
const SELLER="0x3333333333333333333333333333333333333333";
const PLATFORM="0x4444444444444444444444444444444444444444";

function expected(overrides: Partial<SafeConfigurationExpectation> = {}): SafeConfigurationExpectation {
  return { safeAddress:SAFE, expectedSafeAddress:SAFE, expectedOwners:[BUYER,SELLER,PLATFORM],
    expectedThreshold:2, expectedVersion:"1.4.1", expectedChainId:56, expectedNonce:"7", ...overrides };
}
function client(overrides: Partial<SafeConfigurationReadClient> = {}): SafeConfigurationReadClient {
  return { getChainId:async()=>56, getCode:async()=>"0x60016000",
    getOwners:async()=>[BUYER,SELLER,PLATFORM], getThreshold:async()=>2,
    getNonce:async()=>7n, getVersion:async()=>"1.4.1", ...overrides };
}
function assert(ok:boolean,message:string){if(!ok)throw new Error(message);}

Deno.test("PREPARE Safe configuration accepts exact BNB Safe owners, threshold, version and nonce",async()=>{
  const result=await readAndVerifySafeConfigurationFacts(client(),expected());
  assert(result.valid,JSON.stringify(result.issues));
  assert(result.chainId===56&&result.threshold===2&&result.nonce==="7",JSON.stringify(result));
});

Deno.test("PREPARE configuration rejects wrong chain and missing contract code",async()=>{
  const result=await readAndVerifySafeConfigurationFacts(client({getChainId:async()=>97,getCode:async()=>"0x"}),expected());
  assert(!result.valid&&result.issues.includes("SAFE_CHAIN_ID_MISMATCH"),JSON.stringify(result));
  assert(result.issues.includes("SAFE_CONTRACT_CODE_MISSING"),JSON.stringify(result));
});

Deno.test("PREPARE configuration rejects owner set drift and duplicate owners",async()=>{
  const changed=await readAndVerifySafeConfigurationFacts(client({getOwners:async()=>[BUYER,SELLER]}),expected());
  assert(!changed.valid&&changed.issues.includes("SAFE_LIVE_OWNERS_INVALID"),JSON.stringify(changed));
  const duplicate=await readAndVerifySafeConfigurationFacts(client({getOwners:async()=>[BUYER,BUYER,PLATFORM]}),expected());
  assert(!duplicate.valid&&duplicate.issues.includes("SAFE_LIVE_OWNERS_INVALID"),JSON.stringify(duplicate));
});

Deno.test("PREPARE configuration rejects threshold, nonce and version drift",async()=>{
  const result=await readAndVerifySafeConfigurationFacts(client({
    getThreshold:async()=>1,getNonce:async()=>8,getVersion:async()=>"1.3.0",
  }),expected());
  assert(!result.valid,JSON.stringify(result.issues));
  assert(result.issues.includes("SAFE_LIVE_THRESHOLD_MISMATCH"),JSON.stringify(result));
  assert(result.issues.includes("SAFE_LIVE_NONCE_MISMATCH"),JSON.stringify(result));
  assert(result.issues.includes("SAFE_LIVE_VERSION_MISMATCH"),JSON.stringify(result));
});

Deno.test("PREPARE configuration rejects an invalid expected owner set before provider reads",async()=>{
  let reads=0;
  const result=await readAndVerifySafeConfigurationFacts(client({getChainId:async()=>{reads++;return 56;}}),
    expected({expectedOwners:[BUYER,BUYER,PLATFORM]}));
  assert(!result.valid&&result.issues.includes("EXPECTED_SAFE_OWNERS_INVALID"),JSON.stringify(result));
  assert(reads===0,"provider must not be called for malformed expectations");
});

Deno.test("PREPARE configuration fails closed when a provider read fails",async()=>{
  const result=await readAndVerifySafeConfigurationFacts(client({getOwners:async()=>{throw new Error("offline");}}),expected());
  assert(!result.valid&&result.issues.includes("SAFE_CONFIGURATION_READ_FAILED"),JSON.stringify(result));
});
