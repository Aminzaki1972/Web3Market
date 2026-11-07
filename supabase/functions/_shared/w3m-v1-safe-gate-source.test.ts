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
    const actionIndex = source.indexOf(item.action);
    assertEquals(importIndex >= 0, true, item.file + " must import the shared W3M gate");
    assertEquals(gateIndex >= 0, true, item.file + " must call the shared W3M gate");
    assertEquals(actionIndex >= 0, true, item.file + " action marker must exist");
    assertEquals(gateIndex < actionIndex, true, item.file + " must gate before its Safe action");
    if (item.file.endsWith("finalize-safe-release/index.ts")) {
      const disputeCheckIndex = source.indexOf("checkDisputeState(sb,deal,dealId)");
      assertEquals(disputeCheckIndex >= 0, true, "finalization must verify dispute state");
      assertEquals(disputeCheckIndex < actionIndex, true, "finalization must verify dispute state before writes");
    }
  }
});
