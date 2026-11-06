import { assertEquals } from "jsr:@std/assert@1";
import { handleW3MPrelockPrepareRequest } from "./prelock-safe-prepare-request-handler.ts";
const ACTOR="82000000-0000-4000-8000-000000000002";
const DEAL="82000000-0000-4000-8000-000000000001";
function req(body:unknown,token="valid") {
 return new Request("https://example.test/prepare",{method:"POST",
  headers:{authorization:"Bearer "+token,"content-type":"application/json"},
  body:JSON.stringify(body)});
}
Deno.test("PREPARE HTTP boundary authenticates and derives actor from session",async()=>{
 let captured:{actorId:string;dealId:string}|null=null;
 const response=await handleW3MPrelockPrepareRequest(req({
  deal_id:DEAL,actor_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  authorization:{decision:"PASS"},policy:{feePercent:"0"},safe_facts:{chainId:1},
 }),{
  async authenticate(token){assertEquals(token,"valid");return ACTOR;},
  async buildServerContext(input){
   captured=input;
   throw new Error("stop after verifying server context inputs");
  },
  now(){return "2026-11-06T00:00:00Z";},
 });
 assertEquals(response.status,409);
 assertEquals(captured,{actorId:ACTOR,dealId:DEAL});
});
Deno.test("PREPARE HTTP boundary rejects unauthenticated or malformed requests before context",async()=>{
 let contexts=0;
 const deps={
  async authenticate(){return null;},
  async buildServerContext(){contexts++;throw new Error("must not run");},
  now(){return "2026-11-06T00:00:00Z";},
 };
 const denied=await handleW3MPrelockPrepareRequest(req({deal_id:DEAL}),deps);
 assertEquals(denied.status,401);
 const malformed=await handleW3MPrelockPrepareRequest(req({deal_id:"not-a-uuid"}),{
  ...deps,async authenticate(){return ACTOR;},
 });
 assertEquals(malformed.status,400);
 assertEquals(contexts,0);
});
Deno.test("PREPARE HTTP boundary permits only POST",async()=>{
 const response=await handleW3MPrelockPrepareRequest(new Request("https://example.test/prepare"),{
  async authenticate(){return ACTOR;},
  async buildServerContext(){throw new Error("must not run");},
  now(){return "2026-11-06T00:00:00Z";},
 });
 assertEquals(response.status,405);
});
