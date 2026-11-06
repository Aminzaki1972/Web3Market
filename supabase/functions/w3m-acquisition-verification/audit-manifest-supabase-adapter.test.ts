import { assertEquals } from "jsr:@std/assert@1";
import { createSupabaseAuditManifestSource } from "./audit-manifest-supabase-adapter.ts";
import type { W3MRegistryReadClient, W3MRegistrySelectQuery } from "./persisted-report-loader.ts";

Deno.test("finding pages use the manifest natural-key tuple before offset pagination", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const query: Record<string, unknown> = {};
  const chain = {
    eq(column: string, value: unknown) {
      calls.push({ method: "eq", column, value });
      return chain;
    },
    order(column: string, options: { ascending: boolean }) {
      calls.push({ method: "order", column, ...options });
      return chain;
    },
    range(from: number, to: number) {
      calls.push({ method: "range", from, to });
      return Promise.resolve({ data: [], error: null });
    },
    maybeSingle() {
      return Promise.resolve({ data: null, error: null });
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    },
  };
  const client = {
    from(table: string) {
      calls.push({ method: "from", table });
      return {
        select(columns: string) {
          calls.push({ method: "select", columns });
          return chain;
        },
      };
    },
  } as unknown as W3MRegistryReadClient;

  const source = createSupabaseAuditManifestSource(client);
  const result = await source.loadFindingsPage("audit-123", 100, 199);

  assertEquals(result.data, []);
  assertEquals(calls, [
    { method: "from", table: "code_audit_findings" },
    { method: "select", columns: "*" },
    { method: "eq", column: "audit_id", value: "audit-123" },
    { method: "order", column: "file_path", ascending: true },
    { method: "order", column: "line_start", ascending: true },
    { method: "order", column: "severity", ascending: true },
    { method: "order", column: "category", ascending: true },
    { method: "order", column: "title", ascending: true },
    { method: "range", from: 100, to: 199 },
  ]);
});
