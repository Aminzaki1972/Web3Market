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
    assertEquals(/if\\s*\\(\\s*!state\\s*\\)\\s*return\\s*["\x27]unknown["\x27]/.test(source), true, item.file + " must fail closed when dispute status is missing");
    assertEquals(/new Set\\(\\s*\\[\\s*["\x27]none["\x27]/.test(source), true, item.file + " must not treat an empty dispute status as terminal");
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
