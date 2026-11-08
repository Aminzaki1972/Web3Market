import { assertEquals } from "jsr:@std/assert@1.0.14";

const cases = [
  {
    file: "supabase/functions/create-safe/index.ts",
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
    const gateIndex = source.indexOf("assertW3MFinalizationReady(");
    assertEquals(/if\s*\(\s*!state\s*\)\s*return\s*["\x27]unknown["\x27]/.test(source), true, item.file + " must fail closed when dispute status is missing");
    assertEquals(/new Set\(\s*\[\s*["\x27]none["\x27]/.test(source), true, item.file + " must not treat an empty dispute status as terminal");
    const actionIndex = source.indexOf(item.action);
    assertEquals(importIndex >= 0, true, item.file + " must import the shared W3M gate");
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
  assertEquals(assetMigration.includes("not in ('funded','in_progress')"), true,
    "the final asset-aware Safe claim RPC must preserve the funded deal lifecycle gate");
});
