import { assertEquals } from "jsr:@std/assert@1.0.14";
import { canRecordBuyerAssetAcceptance, canRecordFinalBuyerAcceptance } from "./buyer-acceptance-gate.js";

const base={requiredAssetIds:["repo","domain"],evidenceStatuses:{repo:"verified",domain:"verified"},depositConfirmed:true,disputeActive:false,agreementApprovalsCurrent:true,agreementSnapshotCurrent:true};
Deno.test("individual acceptance requires verified evidence and every deal gate",()=>{
  assertEquals(canRecordBuyerAssetAcceptance({...base,assetId:"repo"}),true);
  for(const patch of [
    {evidenceStatuses:{repo:"needs_review",domain:"verified"}},
    {depositConfirmed:false},
    {disputeActive:true},
    {agreementApprovalsCurrent:false},
    {agreementSnapshotCurrent:false},
  ]) assertEquals(canRecordBuyerAssetAcceptance({...base,...patch,assetId:"repo"}),false);
  assertEquals(canRecordBuyerAssetAcceptance({...base,assetId:"unknown"}),false);
});
Deno.test("final acceptance requires all selected assets accepted and evidence verified",()=>{
  const valid={...base,acceptedAssetIds:["repo","domain"],rejectedAssetIds:[]};
  assertEquals(canRecordFinalBuyerAcceptance(valid),true);
  for(const patch of [
    {acceptedAssetIds:["repo"]},
    {rejectedAssetIds:["domain"]},
    {evidenceStatuses:{repo:"verified",domain:"needs_review"}},
    {depositConfirmed:false},
    {disputeActive:true},
    {agreementApprovalsCurrent:false},
    {agreementSnapshotCurrent:false},
    {requiredAssetIds:[]},
  ]) assertEquals(canRecordFinalBuyerAcceptance({...valid,...patch}),false);
});


Deno.test("final acceptance rejects duplicate, extra and conflicting asset IDs",()=>{
 const valid={...base,acceptedAssetIds:["repo","domain"],rejectedAssetIds:[]};
 for(const patch of [
  {acceptedAssetIds:["repo","domain","repo"]},
  {acceptedAssetIds:["repo","domain","unlisted"]},
  {rejectedAssetIds:["unlisted"]},
  {acceptedAssetIds:["repo","domain"],rejectedAssetIds:["repo"]},
  {requiredAssetIds:["repo","repo"]},
 ]) assertEquals(canRecordFinalBuyerAcceptance({...valid,...patch}),false);
});
