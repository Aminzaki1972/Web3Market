import { assertEquals } from "jsr:@std/assert@1";
import {
  authorizePrelockSafePrepare,
  type PrelockPrepareDatabase,
  type PrelockSafePrepareDependencies,
} from "./prelock-safe-prepare-gate.ts";
import type { SafeConfigurationExpectation } from "./safe-live-configuration-facts.ts";

const DEAL="71000000-0000-4000-8000-000000000001";
const SAFE="0x1111111111111111111111111111111111111111";
const BUYER="0x2222222222222222222222222222222222222222";
const SELLER="0x3333333333333333333333333333333333333333";
const PLATFORM="0x2b15cc63ee3b833f502c065767695fa2b584f8c9";
const HASH="0x"+"a".repeat(64);
function snapshot(overrides:Record<string,unknown>={}) {
 return {deal_id:DEAL,deal_status:"funded",deal_chain_id:"56",project_id:"72000000-0000-4000-8000-000000000002",
  buyer_id:"73000000-0000-4000-8000-000000000003",seller_id:"74000000-0000-4000-8000-000000000004",
  project_owner_id:"74000000-0000-4000-8000-000000000004",project_status:"active",
  buyer_wallet:BUYER,buyer_wallet_verified:"true",buyer_wallet_verified_at:"2026-11-05T00:00:00Z",
  seller_wallet:SELLER,seller_wallet_verified:"true",seller_wallet_verified_at:"2026-11-05T00:00:00Z",
  deal_amount:"100.000000000000000001",currency:"USDT",expected_amount:"100.000000000000000001",
  deal_safe_address:SAFE,deal_token_contract:"0x55d398326f99059ff775485246999027b3197955",
  payment_status:"confirmed",payment_tx_hash:"0x"+"b".repeat(64),delivery_status:"accepted",
  buyer_approved_at:"2026-11-05T00:00:00Z",dispute_status:"none",release_tx_hash:null,
  ...overrides};
}
function deps(overrides:{snapshot?:unknown;policy?:unknown;facts?:Record<string,unknown>}={}):PrelockSafePrepareDependencies {
 const database={rpc:async(name:string)=>{
  if(name==="w3m_read_dealroom_terms_snapshot")return {data:overrides.snapshot??[snapshot()],error:null};
  if(name==="w3m_read_validated_release_policy")return {data:overrides.policy??[{
   valid:"true",deal_amount:"100.000000000000000001",fee_percent:"7.500000000000000000",
   fee_amount:"7.500000000000000000",seller_net_amount:"92.500000000000000001"}],error:null};
  throw new Error("unexpected RPC");
 }} as unknown as PrelockPrepareDatabase;
 return {database,readSafeConfiguration:async(expected:SafeConfigurationExpectation)=>{
  assertEquals(expected.expectedNonce,undefined);
  assertEquals(expected.expectedOwners,[BUYER,SELLER,PLATFORM]);
  return {valid:true,chainId:56,safeAddress:SAFE,owners:[BUYER,SELLER,PLATFORM],
   threshold:2,nonce:"7",version:"1.4.1",issues:[],readBlockNumber:"0x123",readBlockHash:HASH,
   ...overrides.facts};
 }};
}
const verifier=async()=>false;

Deno.test("pre-lock PREPARE fails closed when exact deal or validated policy snapshot is missing",async()=>{
 const missing=await authorizePrelockSafePrepare(deps({snapshot:[]}),DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(missing.authorized,false);
 assertEquals(missing.issues,["W3M_PRELOCK_DEAL_SNAPSHOT_UNAVAILABLE"]);
 const noPolicy=await authorizePrelockSafePrepare(deps({policy:[]}),DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(noPolicy.authorized,false);
 assertEquals(noPolicy.issues,["W3M_PRELOCK_POLICY_VALIDATION_UNAVAILABLE"]);
});



Deno.test("pre-lock PREPARE rejects a token other than the approved BNB USDT contract",async()=>{
 const result=await authorizePrelockSafePrepare(
  deps({snapshot:[snapshot({deal_token_contract:"0x4444444444444444444444444444444444444444"})]}),
  DEAL,"2026-11-06T00:00:00Z",verifier,
 );
 assertEquals(result.authorized,false);
 assertEquals(result.issues,["W3M_PRELOCK_PARTY_OR_TERMS_INVALID"]);
});


Deno.test("pre-lock PREPARE rejects non-USDT denomination and malformed payment hash",async()=>{
 const currency=await authorizePrelockSafePrepare(
  deps({snapshot:[snapshot({currency:"BUSD"})]}),DEAL,"2026-11-06T00:00:00Z",verifier,
 );
 assertEquals(currency.authorized,false);
 assertEquals(currency.issues,["W3M_PRELOCK_PARTY_OR_TERMS_INVALID"]);
 const payment=await authorizePrelockSafePrepare(
  deps({snapshot:[snapshot({payment_tx_hash:"not-a-transaction-hash"})]}),
  DEAL,"2026-11-06T00:00:00Z",verifier,
 );
 assertEquals(payment.authorized,false);
 assertEquals(payment.issues.length > 0,true);
});

Deno.test("pre-lock PREPARE rejects non-releasable deal status and non-BNB chain",async()=>{
 const status=await authorizePrelockSafePrepare(deps({snapshot:[snapshot({deal_status:"draft"})]}),DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(status.authorized,false);
 assertEquals(status.issues,["W3M_PRELOCK_PARTY_OR_TERMS_INVALID"]);
 const chain=await authorizePrelockSafePrepare(deps({snapshot:[snapshot({deal_chain_id:"97"})]}),DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(chain.authorized,false);
 assertEquals(chain.issues,["W3M_PRELOCK_PARTY_OR_TERMS_INVALID"]);
});

Deno.test("pre-lock PREPARE refuses a failed database release-policy validation",async()=>{
 const result=await authorizePrelockSafePrepare(deps({policy:[{valid:"false"}]}),DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(result.authorized,false);
 assertEquals(result.issues,["W3M_RELEASE_POLICY_VALIDATION_FAILED"]);
});

Deno.test("pre-lock PREPARE rejects seller ownership, wallet verification and distinct-party drift",async()=>{
 const owner=await authorizePrelockSafePrepare(deps({snapshot:[snapshot({project_owner_id:"another"})]}),DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(owner.authorized,false);
 assertEquals(owner.issues,["W3M_PRELOCK_PARTY_OR_TERMS_INVALID"]);
 const unverified=await authorizePrelockSafePrepare(deps({snapshot:[snapshot({buyer_wallet_verified:"false"})]}),DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(unverified.authorized,false);
 assertEquals(unverified.issues,["W3M_PRELOCK_PARTY_OR_TERMS_INVALID"]);
 const shared=await authorizePrelockSafePrepare(deps({snapshot:[snapshot({seller_wallet:BUYER})]}),DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(shared.authorized,false);
 assertEquals(shared.issues,["W3M_PRELOCK_PARTY_OR_TERMS_INVALID"]);
});

Deno.test("pre-lock PREPARE rejects malformed numeric JSON instead of coercing it",async()=>{
 const result=await authorizePrelockSafePrepare(deps({policy:[{
  valid:"true",deal_amount:100,fee_percent:7.5,fee_amount:7.5,seller_net_amount:92.5,
 }]}),DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(result.authorized,false);
 assertEquals(result.issues,["W3M_PRELOCK_PREPARE_AUTHORIZATION_FAILED"]);
});

Deno.test("pre-lock PREPARE blocks on invalid canonical Safe facts before report gate",async()=>{
 const result=await authorizePrelockSafePrepare(deps({facts:{valid:false,issues:["SAFE_LIVE_NONCE_MISMATCH"]}}),DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(result.authorized,false);
 assertEquals(result.issues.includes("W3M_PRELOCK_SAFE_CONFIGURATION_INVALID"),true);
});

Deno.test("pre-lock PREPARE reaches persisted report gate and blocks when no signed report exists",async()=>{
 const base=deps();
 const database={...base.database,from(_table:string){
  return {select(_columns:string){
   const query={eq(){return query;},order(){return query;},limit(){return query;},
    maybeSingle(){return Promise.resolve({data:null,error:null});},
    then(onfulfilled?:((value:{data:unknown;error:unknown})=>unknown)|null,onrejected?:((reason:unknown)=>unknown)|null){
     return Promise.resolve({data:null,error:null}).then(onfulfilled??undefined,onrejected??undefined);
    }};
   return query as never;
  }};
 }} as unknown as PrelockPrepareDatabase;
 const result=await authorizePrelockSafePrepare({...base,database},DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(result.authorized,false);
 assertEquals(result.issues.length>0,true);
 assertEquals(result.safeNonce,undefined);
});
