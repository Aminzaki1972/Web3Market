import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { issueAndPersistAcquisitionReport } from "./protocol-service.ts";
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";
import type { W3MRegistryReadClient, W3MRegistrySelectQuery, W3MRegistryReadResult } from "./persisted-report-loader.ts";

const DEAL = "11111111-1111-4111-8111-111111111111";
const OTHER_DEAL = "33333333-3333-4333-8333-333333333333";
const REPORT = "22222222-2222-4222-8222-222222222222";

function clientForReport(row: Record<string, unknown>) {
  const reads: string[] = [];
  const writes: string[] = [];
  const readClient: W3MRegistryReadClient = {
    from(table: string) {
      reads.push(table);
      return {
        select() {
          const result: W3MRegistryReadResult = { data: row, error: null };
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
  const rpcClient: W3MRpcClient = {
    async rpc(name: string) {
      writes.push(name);
      return { data: null, error: new Error("write must not be reached in this test") };
    },
  };
  return {
    client: Object.assign({}, readClient, rpcClient) as W3MRpcClient & W3MRegistryReadClient,
    reads,
    writes,
  };
}

const deliberatelyIncompleteInput = {
  acquisition: { dealId: DEAL },
} as never;

Deno.test("protocol service rejects a latest report belonging to another deal before signing or persistence", async () => {
  const mock = clientForReport({
    id: REPORT,
    deal_id: OTHER_DEAL,
    report_version: 4,
  });
  let signerCalls = 0;
  await assertRejects(() => issueAndPersistAcquisitionReport(
    deliberatelyIncompleteInput,
    async () => {
      signerCalls++;
      return { signerKeyId: "test-key", signature: "0x" + "1".repeat(130) };
    },
    mock.client,
  ));
  assertEquals(mock.reads, ["w3m_acquisition_reports"]);
  assertEquals(mock.writes, []);
  assertEquals(signerCalls, 0);
});

Deno.test("protocol service rejects a malformed latest report identity before signing or persistence", async () => {
  const mock = clientForReport({
    id: "not-a-uuid",
    deal_id: DEAL,
    report_version: 4,
  });
  let signerCalls = 0;
  await assertRejects(() => issueAndPersistAcquisitionReport(
    deliberatelyIncompleteInput,
    async () => {
      signerCalls++;
      return { signerKeyId: "test-key", signature: "0x" + "1".repeat(130) };
    },
    mock.client,
  ));
  assertEquals(mock.reads, ["w3m_acquisition_reports"]);
  assertEquals(mock.writes, []);
  assertEquals(signerCalls, 0);
});

Deno.test("protocol service rejects an exhausted latest report version before signing or persistence", async () => {
  const mock = clientForReport({
    id: REPORT,
    deal_id: DEAL,
    report_version: 2147483647,
  });
  let signerCalls = 0;
  await assertRejects(() => issueAndPersistAcquisitionReport(
    deliberatelyIncompleteInput,
    async () => {
      signerCalls++;
      return { signerKeyId: "test-key", signature: "0x" + "1".repeat(130) };
    },
    mock.client,
  ));
  assertEquals(mock.reads, ["w3m_acquisition_reports"]);
  assertEquals(mock.writes, []);
  assertEquals(signerCalls, 0);
});
