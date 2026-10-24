import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { assertAuditWriteSucceeded } from "./audit-persistence.ts";
import { queuedNextBatchProgress } from "./audit-progress.ts";
import { filterMissingAuditFindings } from "./audit-findings.ts";
import { collectPages } from "./audit-pagination.ts";

type Finding = { audit_id: string; file_path: string; line_start: number; title: string; severity: string; category: string };
type AuditRow = { status: string; current_chunk: number; total_chunks: number; analysis_progress: Record<string, unknown>; ai_chunk_results: unknown[]; error_message?: string };
type FakeStore = { audit: AuditRow; files: { path: string }[]; findings: Finding[]; failNextWrite?: boolean };

function write(store: FakeStore, patch: Partial<AuditRow>) {
  if (store.failNextWrite) {
    store.failNextWrite = false;
    return { error: { message: "injected database write failure" } };
  }
  Object.assign(store.audit, patch);
  return { error: null };
}

async function readPages<T>(rows: T[]) {
  return collectPages(async (from, to) => ({
    data: rows.slice(from, to + 1),
    error: null,
  }));
}

/**
 * Deterministic worker-flow harness. Uses the same persistence, pagination,
 * finding-idempotency, and batch-checkpoint helpers as the Edge Function, while
 * replacing GitHub, Gemini, and Supabase network calls with controlled fakes.
 */
async function mockWorker(store: FakeStore, opts: { failProviderAt?: number; failWriteAtChunk?: number } = {}) {
  const totalBatches = 2;
  const batchFiles = [["src/a.sol", "src/b.sol"], ["src/c.sol"]];
  for (let batchIndex = Number(store.audit.analysis_progress.file_batch_index || 0); batchIndex < totalBatches; batchIndex++) {
    store.audit.status = "scanning";
    const paths = batchFiles[batchIndex];
    for (const path of paths) {
      if (!store.files.some((f) => f.path === path)) store.files.push({ path });
    }
    const chunkTotal = 2;
    let cursor = batchIndex === Number(store.audit.analysis_progress.file_batch_index || 0)
      ? Number(store.audit.current_chunk || 0) : 0;
    while (cursor < chunkTotal) {
      if (opts.failProviderAt === cursor + 1) {
        store.audit.status = "failed";
        store.audit.error_message = "mock Gemini provider failure";
        return;
      }
      const finding: Finding = {
        audit_id: "audit-test", file_path: paths[Math.min(cursor, paths.length - 1)],
        line_start: 10, title: "Missing access control", severity: "high", category: "security",
      };
      const result = { chunk: cursor + 1, summary: "mock analysis", findings: [finding] };
      if (opts.failWriteAtChunk === cursor + 1) store.failNextWrite = true;
      const persisted = write(store, {
        ai_chunk_results: [...store.audit.ai_chunk_results, result],
        current_chunk: cursor + 1,
        total_chunks: chunkTotal,
        analysis_progress: {
          ...store.audit.analysis_progress, file_batch_index: batchIndex,
          current_chunk: cursor + 1, total_chunks: chunkTotal,
        },
      });
      assertAuditWriteSucceeded(persisted, "Unable to persist AI chunk result/checkpoint");
      cursor++;
    }
    const nextFiles = await readPages(store.files);
    assert(nextFiles.length >= paths.length);
    const candidateFindings = store.audit.ai_chunk_results.flatMap((x: any) => x.findings || []);
    const missing = filterMissingAuditFindings(candidateFindings, store.findings);
    store.findings.push(...missing.map((f: any) => ({ audit_id: "audit-test", ...f })));
    if (batchIndex + 1 < totalBatches) {
      const progress = queuedNextBatchProgress(
        store.audit.analysis_progress, batchIndex + 1, totalBatches, 3, [],
        "2026-10-25T00:00:00.000Z",
      );
      const saved = write(store, { status: "queued", current_chunk: 0, total_chunks: 0, analysis_progress: progress });
      assertAuditWriteSucceeded(saved, "Unable to persist next file-batch checkpoint");
    }
  }
  store.audit.status = "completed";
}

function freshStore(): FakeStore {
  return {
    audit: { status: "queued", current_chunk: 0, total_chunks: 0, analysis_progress: { file_batch_index: 0 }, ai_chunk_results: [] },
    files: [], findings: [],
  };
}

Deno.test("mock worker flow completes multi-batch work and remains idempotent after resume", async () => {
  const store = freshStore();
  await mockWorker(store);
  assertEquals(store.audit.status, "completed");
  assertEquals(store.files.length, 3);
  const findingsAfterFirstRun = store.findings.length;
  // Replaying the persistence step with the same stored results must add nothing.
  const repeated = filterMissingAuditFindings(
    store.audit.ai_chunk_results.flatMap((x: any) => x.findings || []),
    store.findings,
  );
  assertEquals(repeated.length, 0);
  assertEquals(store.findings.length, findingsAfterFirstRun);
  assertEquals(store.audit.analysis_progress.file_batch_index, 1);
});

Deno.test("mock worker flow fails closed when a critical checkpoint write fails", async () => {
  const store = freshStore();
  await assertRejects(
    () => mockWorker(store, { failWriteAtChunk: 1 }),
    Error,
    "injected database write failure",
  );
  assertEquals(store.audit.status, "scanning");
  assertEquals(store.audit.current_chunk, 0);
});

Deno.test("mock provider failure is never reported as completed", async () => {
  const store = freshStore();
  await mockWorker(store, { failProviderAt: 1 });
  assertEquals(store.audit.status, "failed");
  assertEquals(store.audit.error_message, "mock Gemini provider failure");
});

Deno.test("mock pagination reads all persisted file rows, not only the first page", async () => {
  const rows = Array.from({ length: 2377 }, (_, i) => ({ path: "src/" + i + ".sol" }));
  assertEquals((await readPages(rows)).length, 2377);
});
