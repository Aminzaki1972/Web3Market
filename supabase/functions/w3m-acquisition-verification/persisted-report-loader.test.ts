import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  loadCurrentW3MReportBundle,
  type W3MRegistryReadClient,
  type W3MRegistrySelectQuery,
  type W3MRegistryReadResult,
} from "./persisted-report-loader.ts";

function mockClient(results: Record<string, W3MRegistryReadResult>, calls: string[]): W3MRegistryReadClient {
  return {
    from(table: string) {
      calls.push(table);
      return {
        select() {
          const result = results[table];
          const query = {
            eq() { return query; },
            order() { return query; },
            limit() { return query; },
            maybeSingle() { return Promise.resolve(result); },
            then(onfulfilled?: ((value: W3MRegistryReadResult) => unknown) | null,
              onrejected?: ((reason: unknown) => unknown) | null) {
              return Promise.resolve(result).then(onfulfilled ?? undefined, onrejected ?? undefined);
            },
          };
          return query as unknown as W3MRegistrySelectQuery;
        },
      };
    },
  };
}

Deno.test("loads only the latest report and its evidence and signer rows", async () => {
  const calls: string[] = [];
  const bundle = await loadCurrentW3MReportBundle(mockClient({
    w3m_acquisition_reports: { data: { id: "report-1", report_version: 3, signer_key_id: "key-1" }, error: null },
    w3m_acquisition_evidence: { data: [{ id: "evidence-1" }], error: null },
    w3m_trusted_signer_key_status: { data: [{ key_id: "key-1", status: "ACTIVE" }], error: null },
  }, calls), "deal-1");
  assertEquals(bundle.latestReportVersion, 3);
  assertEquals(bundle.evidenceRows.length, 1);
  assertEquals(bundle.trustedSignerRegistryRows.length, 1);
  assertEquals(calls, [
    "w3m_acquisition_reports",
    "w3m_acquisition_evidence",
    "w3m_trusted_signer_key_status",
  ]);
});

Deno.test("missing report returns an empty fail-closed bundle without extra queries", async () => {
  const calls: string[] = [];
  const bundle = await loadCurrentW3MReportBundle(mockClient({
    w3m_acquisition_reports: { data: null, error: null },
  }, calls), "deal-1");
  assertEquals(bundle.reportRow, null);
  assertEquals(bundle.latestReportVersion, null);
  assertEquals(bundle.evidenceRows, []);
  assertEquals(calls, ["w3m_acquisition_reports"]);
});

Deno.test("registry query errors fail closed", async () => {
  const calls: string[] = [];
  await assertRejects(() => loadCurrentW3MReportBundle(mockClient({
    w3m_acquisition_reports: { data: null, error: new Error("database unavailable") },
  }, calls), "deal-1"));
});
