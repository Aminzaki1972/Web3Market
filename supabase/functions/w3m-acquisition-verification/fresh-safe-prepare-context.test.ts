import { assertEquals } from "jsr:@std/assert@1";
import { computeAuditManifest } from "./audit-manifest.ts";
import {
  authorizeSafePrepareFromFreshSources,
  type FreshSafePrepareDependencies,
  type SafePrepareDatabase,
} from "./fresh-safe-prepare-context.ts";
import type { SafeConfigurationExpectation } from "./safe-live-configuration-facts.ts";

const DEAL="71000000-0000-4000-8000-000000000001";
const SAFE="0x1111111111111111111111111111111111111111";
const BUYER="0x2222222222222222222222222222222222222222";
const SELLER="0x3333333333333333333333333333333333333333";
const PLATFORM="0x2b15cc63ee3b833f502c065767695fa2b584f8c9";
const HASH="0x"+"a".repeat(64);

const AUDIT="75000000-0000-4000-8000-000000000005";
const COMMIT="c".repeat(40);
const auditRow={
 id:AUDIT,status:"completed",commit_sha:COMMIT,repo_owner:"example",repo_name:"project",
 completed_at:"2026-11-05T00:00:00.000Z",engine_version:"w3m-code-audit-2.0",
 files_scanned:1,critical_count:0,high_count:0,medium_count:0,low_count:0,info_count:0,
 analysis_progress:{evidence_version:"w3m-audit-evidence-v1",tree_truncated:false,persisted_file_count:1},
};
const auditFile={audit_id:AUDIT,path:"README.md",language:"markdown",line_count:1,selected_tier:"core"};
const auditManifest=await computeAuditManifest({audit:auditRow,files:[auditFile],findings:[]});
const codeAudit={auditId:AUDIT,repositoryOwner:"example",repositoryName:"project",
 repositoryUrl:"https://github.com/example/project",commitSha:COMMIT,auditType:"complete",
 completedAt:"2026-11-05T00:00:00.000Z",auditEvidenceHash:auditManifest.digest};

function row(overrides:Record<string,unknown>={}) {
 return {deal_id:DEAL,deal_status:"funded",deal_chain_id:"56",policy_deal_id:DEAL,buyer_id:"buyer",seller_id:"seller",
  project_owner_id:"seller",project_status:"active",buyer_wallet:BUYER,buyer_wallet_verified:"true",
  buyer_wallet_verified_at:"2026-11-05T00:00:00Z",seller_wallet:SELLER,seller_wallet_verified:"true",
  seller_wallet_verified_at:"2026-11-05T00:00:00Z",policy_seller_wallet:SELLER,policy_platform_wallet:PLATFORM,deal_safe_address:SAFE,
  policy_safe_address:SAFE,policy_safe_nonce:"7",...overrides};
}
function deps(snapshot:unknown, factsOverrides:Record<string,unknown>={}):FreshSafePrepareDependencies {
 const database={
  rpc:async()=>({data:snapshot,error:null}),
  from:(table:string)=>{
   const rows=table==="code_audits"?[auditRow]:table==="code_audit_files"?[auditFile]:[];
   const query:any={
    select:()=>query,eq:()=>query,order:()=>query,range:(from:number,to:number)=>{query.page=rows.slice(from,to+1);return query;},
    maybeSingle:async()=>({data:auditRow,error:null}),
    then:(resolve:any,reject:any)=>Promise.resolve({data:query.page??rows,error:null}).then(resolve,reject),
   };
   return query;
  },
 } as unknown as SafePrepareDatabase;
 return {database,readSafeConfiguration:async(expected:SafeConfigurationExpectation)=>{
  assertEquals(expected.expectedOwners,[BUYER,SELLER,PLATFORM]);
  return {valid:true,chainId:56,safeAddress:SAFE,owners:[BUYER,SELLER,PLATFORM],
   threshold:2,nonce:"7",version:"1.4.1",issues:[],readBlockNumber:"0x123",readBlockHash:HASH,
   ...factsOverrides};
 }};
}
const verifier={verify:async()=>({valid:false,issues:["unused"]})} as never;

Deno.test("PREPARE rejects missing or ambiguous exact Deal Room snapshot",async()=>{
 const missing=await authorizeSafePrepareFromFreshSources(deps([],{}),DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(missing.authorized,false);
 assertEquals(missing.issues,["W3M_PREPARE_SNAPSHOT_UNAVAILABLE"]);
 const ambiguous=await authorizeSafePrepareFromFreshSources(deps([row(),row()],{}),DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(ambiguous.authorized,false);
 assertEquals(ambiguous.issues,["W3M_PREPARE_SNAPSHOT_UNAVAILABLE"]);
});

Deno.test("PREPARE rejects party, seller-policy or platform-wallet drift before BNB reads",async()=>{
 let reads=0;
 const d=deps([row({policy_seller_wallet:BUYER})]);
 d.readSafeConfiguration=async()=>{reads++;throw new Error("must not read");};
 const result=await authorizeSafePrepareFromFreshSources(d,DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(result.authorized,false);
 assertEquals(result.issues,["W3M_PREPARE_PARTY_OR_SAFE_BINDING_INVALID"]);
 assertEquals(reads,0);
});

Deno.test("PREPARE rejects invalid canonical Safe configuration and returns its issues",async()=>{
 const result=await authorizeSafePrepareFromFreshSources(
  deps([row()],{valid:false,issues:["SAFE_LIVE_NONCE_MISMATCH"]}),
  DEAL,"2026-11-06T00:00:00Z",verifier,
 );
 assertEquals(result.authorized,false);
 assertEquals(result.issues,["W3M_PREPARE_SAFE_CONFIGURATION_INVALID","SAFE_LIVE_NONCE_MISMATCH"]);
});

Deno.test("PREPARE rejects a malformed canonical block binding",async()=>{
 const result=await authorizeSafePrepareFromFreshSources(
  deps([row()],{readBlockHash:"0x12"}),
  DEAL,"2026-11-06T00:00:00Z",verifier,
 );
 assertEquals(result.authorized,false);
 assertEquals(result.issues.includes("W3M_PREPARE_SAFE_CONFIGURATION_INVALID"),true);
});


Deno.test("PREPARE rejects unverified wallets, future verification time and seller ownership drift",async()=>{
 const unverified=await authorizeSafePrepareFromFreshSources(
  deps([row({buyer_wallet_verified:"false"})]),DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(unverified.authorized,false);
 assertEquals(unverified.issues,["W3M_PREPARE_PROJECT_OR_WALLET_VERIFICATION_INVALID"]);
 const future=await authorizeSafePrepareFromFreshSources(
  deps([row({seller_wallet_verified_at:"2026-11-07T00:00:00Z"})]),DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(future.authorized,false);
 assertEquals(future.issues,["W3M_PREPARE_PROJECT_OR_WALLET_VERIFICATION_INVALID"]);
 const owner=await authorizeSafePrepareFromFreshSources(
  deps([row({project_owner_id:"different-seller"})]),DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(owner.authorized,false);
 assertEquals(owner.issues,["W3M_PREPARE_PROJECT_OR_WALLET_VERIFICATION_INVALID"]);
});


Deno.test("PREPARE rejects internally inconsistent Safe fact acknowledgements",async()=>{
 const issues=await authorizeSafePrepareFromFreshSources(
  deps([row()],{issues:["unexpected"],valid:true}),DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(issues.authorized,false);
 assertEquals(issues.issues.includes("W3M_PREPARE_SAFE_CONFIGURATION_INVALID"),true);
 const owners=await authorizeSafePrepareFromFreshSources(
  deps([row()],{owners:[BUYER,BUYER,PLATFORM]}),DEAL,"2026-11-06T00:00:00Z",verifier);
 assertEquals(owners.authorized,false);
 assertEquals(owners.issues.includes("W3M_PREPARE_SAFE_CONFIGURATION_INVALID"),true);
});

Deno.test("PREPARE rejects invalid deal identifiers and timestamps before database reads",async()=>{
 let reads=0;
 const d=deps([row()]);
 d.database={rpc:async()=>{reads++;return {data:[row()],error:null};}} as unknown as SafePrepareDatabase;
 const result=await authorizeSafePrepareFromFreshSources(d,"not-a-uuid","not-a-date",verifier);
 assertEquals(result.authorized,false);
 assertEquals(result.issues,["W3M_PREPARE_INPUT_INVALID"]);
 assertEquals(reads,0);
});
