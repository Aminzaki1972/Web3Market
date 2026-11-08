import { assertEquals } from "jsr:@std/assert@1.0.14";
import { getW3MDealProtocolTrack, W3MProtocolTrackError } from "./w3m-deal-protocol-track.ts";

const cases = [
  {
    file: "supabase/functions/create-safe/index.ts",
    gate: "assertW3MAgreementReady(",
    action: "sendTransaction(",
  },
  {
    file: "supabase/functions/prepare-deal-release/index.ts",
    action: ".upsert(policyPayload",
  },
  {
    file: "supabase/functions/prepare-safe-release-tx/index.ts",
    action: 'stage="safe_rpc_init"',
  },
  {
    file: "supabase/functions/record-safe-release-signature/index.ts",
    action: ".upsert(row",
  },
  {
    file: "supabase/functions/execute-safe-release/index.ts",
    action: "execTransaction(...args,{gasLimit",
  },
  {
    file: "supabase/functions/finalize-safe-release/index.ts",
    action: '.update({tx_hash:txHash,status:"confirmed"',
  },
];

Deno.test("every Safe deployment, release, signature, execution and finalization path fails closed before its action", async () => {
  for (const item of cases) {
    const source = await Deno.readTextFile(item.file);
    const importIndex = source.indexOf('../_shared/w3m-v1-finalization-gate.ts');
    const trackImportIndex = source.indexOf('../_shared/w3m-deal-protocol-track.ts');
    const trackIndex = source.indexOf("await getW3MDealProtocolTrack(");
    const gateIndex = source.indexOf(item.gate || "assertW3MFinalizationReady(");
    assertEquals(/if\s*\(\s*!state\s*\)\s*return\s*["\x27]unknown["\x27]/.test(source), true, item.file + " must fail closed when dispute status is missing");
    assertEquals(/new Set\(\s*\[\s*["\x27]none["\x27]/.test(source), true, item.file + " must not treat an empty dispute status as terminal");
    const actionIndex = source.indexOf(item.action);
    assertEquals(importIndex >= 0, true, item.file + " must import the shared W3M gate");
    assertEquals(trackImportIndex >= 0, true, item.file + " must import the authoritative protocol-track reader");
    assertEquals(trackIndex >= 0, true, item.file + " must read the server-owned protocol track");
    assertEquals(trackIndex < actionIndex, true, item.file + " must classify the deal before any Safe action");
    assertEquals(/protocolTrack\s*===\s*"v1"/.test(source), true, item.file + " must apply the V1 evidence gate only to V1 deals");
    assertEquals(gateIndex >= 0, true, item.file + " must call the shared W3M gate");
    assertEquals(actionIndex >= 0, true, item.file + " action marker must exist");
    assertEquals(gateIndex < actionIndex, true, item.file + " must gate before its Safe action");
    if (item.file.endsWith("finalize-safe-release/index.ts") ||
      item.file.endsWith("create-safe/index.ts") ||
      item.file.endsWith("record-safe-release-signature/index.ts")) {
      const dbClient = item.file.endsWith("create-safe/index.ts") ? "db" : "sb";
      const disputeCheckIndex = source.indexOf("checkDisputeState(" + dbClient + ",deal,dealId)");
      assertEquals(disputeCheckIndex >= 0, true, item.file + " must verify dispute state");
      assertEquals(disputeCheckIndex < actionIndex, true, item.file + " must verify dispute state before the sensitive action");
    }
    if (item.file.endsWith("record-safe-release-signature/index.ts") ||
      item.file.endsWith("execute-safe-release/index.ts")) {
      const deliveryCheckIndex = source.indexOf('delivery_status||"").toLowerCase()!=="accepted"');
      const paymentCheckIndex = source.indexOf('payment_status||"").toLowerCase()!=="confirmed"');
      const policyCheckIndex = source.indexOf('String(policy.status||"").toLowerCase()!=="locked"');
      assertEquals(deliveryCheckIndex >= 0, true, item.file + " must require buyer-approved delivery");
      assertEquals(paymentCheckIndex >= 0, true, item.file + " must require confirmed buyer payment");
      assertEquals(policyCheckIndex >= 0, true, item.file + " must require a locked release policy");
      assertEquals(deliveryCheckIndex < actionIndex && paymentCheckIndex < actionIndex && policyCheckIndex < actionIndex, true, item.file + " must revalidate release prerequisites before the sensitive action");
    }
    if (item.file.endsWith("record-safe-release-signature/index.ts") ||
      item.file.endsWith("execute-safe-release/index.ts") ||
      item.file.endsWith("finalize-safe-release/index.ts")) {
      const safeBindingCheckIndex = source.indexOf("Prepared Safe transaction address does not match");
      assertEquals(safeBindingCheckIndex >= 0, true, item.file + " must bind the prepared Safe transaction to the locked policy");
      assertEquals(safeBindingCheckIndex < actionIndex, true, item.file + " must validate the Safe transaction address before the sensitive action");
      assertEquals(source.includes("policy.token_contract"), true, item.file + " must verify the configured settlement token");
      assertEquals(source.includes("USDT"), true, item.file + " must constrain the existing V1 settlement path to its configured BNB USDT asset");
    }
  }
});

Deno.test("Safe release execution is durably claimed before broadcast and never retries an uncertain attempt", async () => {
  const execute = await Deno.readTextFile("supabase/functions/execute-safe-release/index.ts");
  const claim = execute.indexOf('sb.rpc("w3m_claim_safe_release"');
  const broadcast = execute.indexOf("execTransaction(...args,{gasLimit");
  const submitted = execute.indexOf('sb.rpc("w3m_mark_safe_release_submitted"');
  const wait = execute.indexOf("sent.wait()");
  const failed = execute.indexOf('sb.rpc("w3m_mark_safe_release_failed"');
  assertEquals(claim >= 0, true, "execution must acquire a database release claim");
  assertEquals(broadcast >= 0, true, "Safe broadcast marker must exist");
  assertEquals(claim < broadcast, true, "claim must be committed before Safe broadcast");
  assertEquals(submitted > broadcast && submitted < wait, true, "broadcast hash must be persisted before waiting for the receipt");
  assertEquals(failed > wait, true, "a claim may be released only after a confirmed receipt failure");
  assertEquals(execute.includes("previous_attempt_may_have_broadcast"), true, "an existing uncertain claim must not be rebroadcast");
  assertEquals(execute.includes("releaseBroadcastAttempted"), true, "uncertain send outcomes must be reported as possibly broadcast");
});

Deno.test("Safe finalization reconciles durable release claims only after chain evidence", async () => {
  const finalize = await Deno.readTextFile("supabase/functions/finalize-safe-release/index.ts");
  const receiptCheck = finalize.indexOf("provider.getTransactionReceipt(txHash)");
  const safeHashCheck = finalize.indexOf("Stored Safe transaction payload does not match");
  const markSubmitted = finalize.indexOf('sb.rpc("w3m_mark_safe_release_submitted"');
  const senderCheck = finalize.indexOf('norm(onchainTx.from)!==norm(EXECUTOR)');
  const outerPayloadCheck = finalize.indexOf('Outer Safe execTransaction payload does not match');
  const evmRevert = finalize.indexOf('p_failure_code:"evm_revert"');
  const safeFailure = finalize.indexOf('p_failure_code:"safe_execution_failure"');
  const markFinalized = finalize.indexOf('sb.rpc("w3m_mark_safe_release_finalized"');
  assertEquals(receiptCheck >= 0 && safeHashCheck >= 0, true, "chain receipt and Safe payload must be verified");
  assertEquals(senderCheck > receiptCheck && outerPayloadCheck > senderCheck, true, "outer transaction sender and exact Safe calldata must be verified before claim transitions");
  assertEquals(evmRevert > outerPayloadCheck, true, "an arbitrary failed transaction to Safe must not release the active claim");
  assertEquals(markSubmitted > safeHashCheck, true, "mined transaction must be bound to the claim after Safe hash verification");
  assertEquals(safeFailure > markSubmitted, true, "Safe ExecutionFailure must close the claim only after the mined transaction is bound");
  assertEquals(markFinalized > safeFailure, true, "successful claim finalization must follow exact transfer and deal settlement checks");
});

Deno.test("all Safe endpoints recognize the database's resolved dispute states", async () => {
  const files = [
    "supabase/functions/create-safe/index.ts",
    "supabase/functions/prepare-deal-release/index.ts",
    "supabase/functions/prepare-safe-release-tx/index.ts",
    "supabase/functions/record-safe-release-signature/index.ts",
    "supabase/functions/execute-safe-release/index.ts",
    "supabase/functions/finalize-safe-release/index.ts",
  ];
  for (const file of files) {
    const source = await Deno.readTextFile(file);
    assertEquals(source.includes('"resolved_buyer"'), true, file + " must recognize resolved_buyer as terminal");
    assertEquals(source.includes('"resolved_seller"'), true, file + " must recognize resolved_seller as terminal");
  }
});

Deno.test("Safe release execution revalidates the exact configured 2-of-3 owner set", async () => {
  const execute = await Deno.readTextFile("supabase/functions/execute-safe-release/index.ts");
  assertEquals(execute.includes('const PLATFORM = "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9";'), true,
    "release execution must use the configured platform owner");
  assertEquals(execute.includes('(owners as string[]).length!==3'), true,
    "release execution must require exactly three Safe owners");
  assertEquals(execute.includes('select("id,wallet_address,wallet_verified").in("id",[deal.buyer_id,deal.seller_id])'), true,
    "release execution must reload verified buyer and seller wallets");
  assertEquals(execute.includes('expectedOwners.size!==3'), true,
    "release execution must require three distinct expected owners");
  assertEquals(execute.includes('some(owner=>!actualOwners.has(owner))'), true,
    "release execution must require the buyer, seller and platform to remain the exact owner set");
});


Deno.test("every release preparation and execution path requires a funded deal lifecycle state", async () => {
  const releaseFiles = [
    "supabase/functions/prepare-deal-release/index.ts",
    "supabase/functions/prepare-safe-release-tx/index.ts",
    "supabase/functions/record-safe-release-signature/index.ts",
    "supabase/functions/execute-safe-release/index.ts",
  ];
  for (const file of releaseFiles) {
    const source = await Deno.readTextFile(file);
    assertEquals(source.includes('["funded","in_progress"]'), true,
      file + " must reject release actions outside funded/in_progress");
  }
  const finalize = await Deno.readTextFile("supabase/functions/finalize-safe-release/index.ts");
  assertEquals(finalize.includes('["funded","in_progress"]'), true,
    "finalization must require a funded deal unless this exact release is already completed");
  assertEquals(finalize.includes("isSameCompletedRelease"), true,
    "only an idempotent retry for the same completed release may finalize an already-completed deal");

  const claimMigration = await Deno.readTextFile("supabase/migrations/20261108044500_w3m_v1_safe_release_claims.sql");
  const assetMigration = await Deno.readTextFile("supabase/migrations/20261108110000_w3m_v1_asset_delivery_evidence.sql");
  assertEquals(claimMigration.includes("not in ('funded','in_progress')"), true,
    "the first Safe claim RPC must enforce the funded deal lifecycle");
  assertEquals(claimMigration.includes("not in ('funded','in_progress','completed')"), true,
    "an active claim must prevent the deal from leaving the funded lifecycle before completion");
  assertEquals(assetMigration.includes("not in ('funded','in_progress')"), true,
    "the final asset-aware Safe claim RPC must preserve the funded deal lifecycle gate");
});

Deno.test("Safe deployment requires signed agreement but not pre-deployment asset delivery", async () => {
  const createSafe = await Deno.readTextFile("supabase/functions/create-safe/index.ts");
  assertEquals(createSafe.includes("assertW3MAgreementReady("), true,
    "Safe deployment must verify both parties' exact V1 agreement signatures");
  assertEquals(createSafe.includes("assertW3MFinalizationReady("), false,
    "Safe deployment must not require delivery completion before funding");
});


Deno.test("protocol track reader accepts only consistent immutable server assignments", async () => {
  const dealId = "71000000-0000-4000-8000-000000000001";
  const assignedAt = "2026-11-08T12:00:00.000Z";
  const validRows = [
    { deal_id: dealId, protocol_track: "legacy", assignment_source: "legacy_backfill", assigned_at: assignedAt },
    { deal_id: dealId, protocol_track: "legacy", assignment_source: "legacy_insert", assigned_at: assignedAt },
    { deal_id: dealId, protocol_track: "v1", assignment_source: "trusted_v1_creation", assigned_at: assignedAt },
  ];
  for (const row of validRows) {
    const track = await getW3MDealProtocolTrack({
      async rpc(name, args) {
        assertEquals(name, "w3m_get_deal_protocol_track");
        assertEquals(args.p_deal_id, dealId);
        return { data: row, error: null };
      },
    }, dealId);
    assertEquals(track, row.protocol_track);
  }
});

Deno.test("protocol track reader fails closed for missing, malformed, mismatched, or unreadable classification", async () => {
  const dealId = "71000000-0000-4000-8000-000000000001";
  const assignedAt = "2026-11-08T12:00:00.000Z";
  const invalidResults = [
    { data: null, error: null },
    { data: { deal_id: dealId, protocol_track: "unknown", assignment_source: "legacy_insert", assigned_at: assignedAt }, error: null },
    { data: { deal_id: dealId, protocol_track: "v1", assignment_source: "legacy_insert", assigned_at: assignedAt }, error: null },
    { data: { deal_id: "72000000-0000-4000-8000-000000000002", protocol_track: "legacy", assignment_source: "legacy_insert", assigned_at: assignedAt }, error: null },
    { data: { deal_id: dealId, protocol_track: "legacy", assignment_source: "legacy_backfill", assigned_at: "invalid" }, error: null },
    { data: null, error: { code: "55000", message: "deal_protocol_track_missing" } },
  ];
  for (const result of invalidResults) {
    let rejected = false;
    try {
      await getW3MDealProtocolTrack({ async rpc() { return result; } }, dealId);
    } catch (error) {
      rejected = error instanceof W3MProtocolTrackError;
    }
    assertEquals(rejected, true, "Invalid protocol-track evidence must be rejected");
  }
  let invalidIdRejected = false;
  try {
    await getW3MDealProtocolTrack({ async rpc() { throw new Error("must not be called"); } }, "not-a-uuid");
  } catch (error) {
    invalidIdRejected = error instanceof W3MProtocolTrackError;
  }
  assertEquals(invalidIdRejected, true, "Invalid deal IDs must be rejected before RPC");
});

Deno.test("historical completed legacy Safe releases remain idempotently verifiable without a V1 release claim", async () => {
  const finalize = await Deno.readTextFile("supabase/functions/finalize-safe-release/index.ts");
  assertEquals(finalize.includes('const historicalLegacyCompleted = protocolTrack === "legacy" && isSameCompletedRelease;'), true,
    "only an already-completed legacy deal with the exact same release transaction may use the historical path");
  assertEquals(finalize.includes('if(!historicalLegacyCompleted){\n  const {error:claimSubmitError}=await sb.rpc("w3m_mark_safe_release_submitted"'), true,
    "historical completed legacy releases must not require a claim row created after their original settlement");
  assertEquals(finalize.includes('if(!historicalLegacyCompleted){\n  const {error:claimFinalizedError}=await sb.rpc("w3m_mark_safe_release_finalized"'), true,
    "historical completed legacy releases must not create or finalize a retroactive claim");
  assertEquals(finalize.includes('if(historicalLegacyCompleted)return json(409,{ok:false,error:"A previously completed legacy release cannot be reclassified from a failed chain receipt"});'), true,
    "a failed receipt must never rewrite historical completed legacy settlement evidence");
  assertEquals(finalize.includes('if(historicalLegacyCompleted)return json(409,{ok:false,error:"A previously completed legacy release cannot be reclassified from a Safe ExecutionFailure event"});'), true,
    "a Safe ExecutionFailure event must not create a retroactive failed claim for a historical legacy deal");
  assertEquals(finalize.includes('if(historicalLegacyCompleted)return json(200,{ok:true,completed:true,already_finalized:true,release_tx_hash:txHash'), true,
    "a verified historical legacy release retry must return read-only success without rewriting settlement records");
  assertEquals(finalize.includes('protocolTrack === "v1"'), true,
    "the historical exception must not bypass the V1 finalization gate");
});


Deno.test("every V1 Safe release stage binds its locked policy to the exact current signed settlement snapshot", async () => {
  const cases = [
    { file: "supabase/functions/prepare-deal-release/index.ts", action: '.upsert(policyPayload' },
    { file: "supabase/functions/prepare-safe-release-tx/index.ts", action: 'stage="safe_rpc_init"' },
    { file: "supabase/functions/record-safe-release-signature/index.ts", action: '.upsert(row' },
    { file: "supabase/functions/execute-safe-release/index.ts", action: "execTransaction(...args,{gasLimit" },
    { file: "supabase/functions/finalize-safe-release/index.ts", action: '.update({tx_hash:txHash,status:"confirmed"' },
  ];
  for (const item of cases) {
    const source = await Deno.readTextFile(item.file);
    const snapshot = source.indexOf("getW3MCanonicalSettlement(");
    const policyMatch = source.indexOf("assertW3MSettlementPolicyMatches(");
    const action = source.indexOf(item.action);
    assertEquals(source.includes('../_shared/w3m-v1-settlement-evidence.ts'), true,
      item.file + " must import canonical settlement evidence");
    assertEquals(snapshot >= 0 && policyMatch >= 0, true,
      item.file + " must load and compare the current signed settlement");
    assertEquals(snapshot < action && policyMatch < action, true,
      item.file + " must verify the signed settlement before its Safe action");
  }
  const migration = await Deno.readTextFile("supabase/migrations/20261108190000_w3m_v1_canonical_settlement_evidence.sql");
  assertEquals(migration.includes("service_role_required"), true,
    "canonical settlement evidence RPC must require service_role");
  assertEquals(migration.includes("from public, anon, authenticated"), true,
    "canonical settlement evidence RPC must revoke client execution");
});


Deno.test("V1 Safe signature, execution, and finalization verify exact MultiSend transfers", async () => {
  const cases = [
    "supabase/functions/record-safe-release-signature/index.ts",
    "supabase/functions/execute-safe-release/index.ts",
    "supabase/functions/finalize-safe-release/index.ts",
  ];
  for (const file of cases) {
    const source = await Deno.readTextFile(file);
    const guard = source.indexOf("assertW3MV1SafeReleasePayloadMatchesPolicy(");
    const action = file.includes("record-safe-release-signature")
      ? source.indexOf("signTypedData(")
      : file.includes("execute-safe-release")
      ? source.indexOf("execTransaction(...args")
      : source.indexOf("const seller=norm(policy.seller_wallet)");
    assertEquals(source.includes("../_shared/w3m-v1-safe-payload.ts"), true,
      file + " must import the Safe payload verifier");
    assertEquals(guard >= 0 && action > guard, true,
      file + " must verify the exact token transfers before signing, broadcasting, or finalizing");
  }
});
