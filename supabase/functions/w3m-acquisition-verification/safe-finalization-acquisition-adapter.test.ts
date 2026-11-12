import { assertRejects } from "jsr:@std/assert@1.0.14";
import { verifySafeFinalizationAcquisitionBundle } from "./safe-finalization-acquisition-adapter.ts";
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";
import type { W3MRegistryReadClient } from "./persisted-report-loader.ts";

const ATTEMPT_ID = "71000000-0000-4000-8000-000000000001";
const DEAL_ID = "72000000-0000-4000-8000-000000000002";
const PROJECT_ID = "73000000-0000-4000-8000-000000000003";
const BUYER_ID = "74000000-0000-4000-8000-000000000004";
const SELLER_ID = "75000000-0000-4000-8000-000000000005";
const REPORT_ID = "76000000-0000-4000-8000-000000000006";
const TERMS_VERSION_ID = "77000000-0000-4000-8000-000000000007";
const REPORT_HASH = "a".repeat(64);
const EVIDENCE_HASH = "b".repeat(64);
const TERMS_HASH = "c".repeat(64);
const SIGNER_KEY_ID = "w3m-v1-test-signer";
const NOW = "2026-11-12T05:00:00.000Z";

const baseBundle = {
  attempt: {
    id: ATTEMPT_ID,
    deal_id: DEAL_ID,
    report_id: REPORT_ID,
    report_version: 3,
    pinned_report_hash: REPORT_HASH,
    pinned_evidence_hash: EVIDENCE_HASH,
    pinned_signer_key_id: SIGNER_KEY_ID,
    pinned_terms_version_id: TERMS_VERSION_ID,
    pinned_terms_version: 4,
    pinned_terms_hash: TERMS_HASH,
  },
  deal: {
    id: DEAL_ID,
    project_id: PROJECT_ID,
    buyer_id: BUYER_ID,
    seller_id: SELLER_ID,
  },
  report_row: {
    id: REPORT_ID,
    deal_id: DEAL_ID,
    project_id: PROJECT_ID,
    buyer_id: BUYER_ID,
    seller_id: SELLER_ID,
    report_version: 3,
    status: "PASS",
    report_hash: REPORT_HASH,
    evidence_hash: EVIDENCE_HASH,
    signer_key_id: SIGNER_KEY_ID,
    report_signature: "0x" + "1".repeat(130),
    report_payload: {},
    issued_at: "2026-11-12T04:00:00.000Z",
    expires_at: "2026-11-12T06:00:00.000Z",
  },
  evidence_rows: [],
  trusted_signer_registry_rows: [],
  latest_report_version: 3,
  current_deal_terms_hash: TERMS_HASH,
};

function rpcClient(bundle: unknown = baseBundle) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    calls,
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: bundle, error: null };
    },
  };
  return client as unknown as W3MRpcClient & W3MRegistryReadClient & {
    calls: Array<{ name: string; args: Record<string, unknown> }>;
  };
}

Deno.test("finalization acquisition adapter rejects a report hash changed after attempt pinning", async () => {
  const db = rpcClient({
    ...baseBundle,
    report_row: { ...baseBundle.report_row, report_hash: "d".repeat(64) },
  });
  await assertRejects(
    () => verifySafeFinalizationAcquisitionBundle(db, ATTEMPT_ID, NOW),
    Error,
    "no longer matches",
  );
  if (db.calls.length !== 1 || db.calls[0].name !== "w3m_read_safe_finalization_acquisition_bundle") {
    throw new Error("Pin mismatch must fail before any Code Audit source query.");
  }
});

Deno.test("finalization acquisition adapter rejects a superseded report version", async () => {
  const db = rpcClient({
    ...baseBundle,
    latest_report_version: 4,
  });
  await assertRejects(
    () => verifySafeFinalizationAcquisitionBundle(db, ATTEMPT_ID, NOW),
    Error,
    "not the latest",
  );
  if (db.calls.length !== 1) throw new Error("Superseded report must fail before external source reads.");
});

Deno.test("finalization acquisition adapter requires exactly one mandatory Code Audit evidence row", async () => {
  const db = rpcClient({
    ...baseBundle,
    evidence_rows: [{
      id: "evidence-row-1",
      report_id: REPORT_ID,
      evidence_type: "PAYMENT",
      mandatory: true,
    }],
  });
  await assertRejects(
    () => verifySafeFinalizationAcquisitionBundle(db, ATTEMPT_ID, NOW),
    Error,
    "exactly one mandatory Code Audit",
  );
  if (db.calls.length !== 1) throw new Error("Missing Code Audit evidence must fail before manifest loading.");
});

Deno.test("finalization acquisition adapter rejects duplicate mandatory Code Audit evidence", async () => {
  const auditRow = {
    id: "evidence-row-1",
    report_id: REPORT_ID,
    evidence_type: "CODE_AUDIT",
    mandatory: true,
  };
  const db = rpcClient({
    ...baseBundle,
    evidence_rows: [auditRow, { ...auditRow, id: "evidence-row-2" }],
  });
  await assertRejects(
    () => verifySafeFinalizationAcquisitionBundle(db, ATTEMPT_ID, NOW),
    Error,
    "exactly one mandatory Code Audit",
  );
  if (db.calls.length !== 1) throw new Error("Duplicate Code Audit evidence must fail before manifest loading.");
});

Deno.test("finalization acquisition adapter rejects an invalid attempt identity", async () => {
  const db = rpcClient();
  await assertRejects(
    () => verifySafeFinalizationAcquisitionBundle(db, " ", NOW),
    Error,
    "attempt ID",
  );
  if (db.calls.length !== 0) throw new Error("Invalid attempt identity must not call the database.");
});

Deno.test("finalization acquisition adapter rejects cross-deal and cross-project report bindings", async () => {
  for (const changed of [
    { ...baseBundle.report_row, deal_id: "78000000-0000-4000-8000-000000000008" },
    { ...baseBundle.report_row, project_id: "79000000-0000-4000-8000-000000000009" },
    { ...baseBundle.report_row, buyer_id: SELLER_ID },
  ]) {
    const db = rpcClient({ ...baseBundle, report_row: changed });
    await assertRejects(
      () => verifySafeFinalizationAcquisitionBundle(db, ATTEMPT_ID, NOW),
      Error,
      "not bound to the exact deal",
    );
    if (db.calls.length !== 1) throw new Error("Misbound report must fail before external source reads.");
  }
});

Deno.test("finalization acquisition adapter rejects current deal-terms hash drift", async () => {
  const db = rpcClient({ ...baseBundle, current_deal_terms_hash: "d".repeat(64) });
  await assertRejects(
    () => verifySafeFinalizationAcquisitionBundle(db, ATTEMPT_ID, NOW),
    Error,
    "no longer matches",
  );
  if (db.calls.length !== 1) throw new Error("Terms drift must fail before external source reads.");
});
