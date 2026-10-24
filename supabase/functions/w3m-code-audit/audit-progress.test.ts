import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { queuedNextBatchProgress } from "./audit-progress.ts";

Deno.test("next-batch checkpoint preserves prior metadata but resets per-batch chunk cursor", () => {
  const prior = {
    status: "scanning",
    file_batch_index: 0,
    current_chunk: 4,
    total_chunks: 7,
    updated_at: "old",
    custom_marker: "preserve",
  };
  const stats = [{ files_scanned: 100, lines_scanned: 5000, bytes_analyzed: 400000, oversized_files: 1, unreadable_files: 2 }];
  const next = queuedNextBatchProgress(prior, 1, 3, 257, stats, "fixed-time");
  assertEquals(next, {
    status: "queued",
    file_batch_index: 1,
    total_file_batches: 3,
    eligible_files: 257,
    batch_stats: stats,
    current_chunk: 0,
    total_chunks: 0,
    updated_at: "fixed-time",
    custom_marker: "preserve",
  });
});

Deno.test("next-batch checkpoint rejects impossible cursors", () => {
  assertThrows(() => queuedNextBatchProgress({}, -1, 3, 257, []), Error, "Invalid audit batch checkpoint");
  assertThrows(() => queuedNextBatchProgress({}, 3, 3, 257, []), Error, "Invalid audit batch checkpoint");
  assertThrows(() => queuedNextBatchProgress({}, 0, 0, 257, []), Error, "Invalid audit batch checkpoint");
});
