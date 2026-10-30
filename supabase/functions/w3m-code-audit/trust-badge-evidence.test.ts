import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { buildTrustBadgeCompletionEvidence } from "./trust-badge-evidence.ts";

Deno.test("aggregates every batch into structured completion evidence", () => {
  assertEquals(buildTrustBadgeCompletionEvidence({
    eligibleFiles: 205,
    persistedFileCount: 202,
    preSkippedOversized: 1,
    totalFileBatches: 3,
    batchStats: [
      { files_scanned: 100, oversized_files: 1, unreadable_files: 0 },
      { files_scanned: 100, oversized_files: 0, unreadable_files: 1 },
      { files_scanned: 2, oversized_files: 0, unreadable_files: 0 },
    ],
  }), {
    evidence_version: "w3m-audit-evidence-v1",
    tree_truncated: false,
    eligible_files: 205,
    files_scanned: 202,
    persisted_file_count: 202,
    oversized_files: 2,
    pre_skipped_oversized_files: 1,
    unreadable_files: 1,
    total_file_batches: 3,
  });
});

Deno.test("rejects missing batch checkpoints", () => {
  assertThrows(() => buildTrustBadgeCompletionEvidence({
    eligibleFiles: 10,
    persistedFileCount: 10,
    preSkippedOversized: 0,
    totalFileBatches: 2,
    batchStats: [{ files_scanned: 10, oversized_files: 0, unreadable_files: 0 }],
  }), Error, "Invalid trust badge completion evidence");
});

Deno.test("rejects scanned versus persisted count mismatch", () => {
  assertThrows(() => buildTrustBadgeCompletionEvidence({
    eligibleFiles: 10,
    persistedFileCount: 9,
    preSkippedOversized: 0,
    totalFileBatches: 1,
    batchStats: [{ files_scanned: 10, oversized_files: 0, unreadable_files: 0 }],
  }), Error, "Trust badge scanned and persisted file counts do not match");
});

Deno.test("rejects malformed, negative, or fractional batch counts", () => {
  for (const value of [-1, 0.5, Number.NaN]) {
    assertThrows(() => buildTrustBadgeCompletionEvidence({
      eligibleFiles: 10,
      persistedFileCount: 10,
      preSkippedOversized: 0,
      totalFileBatches: 1,
      batchStats: [{ files_scanned: 10, oversized_files: value, unreadable_files: 0 }],
    }), Error, "Invalid trust badge batch evidence");
  }
});

Deno.test("rejects more scanned files than eligible files", () => {
  assertThrows(() => buildTrustBadgeCompletionEvidence({
    eligibleFiles: 9,
    persistedFileCount: 10,
    preSkippedOversized: 0,
    totalFileBatches: 1,
    batchStats: [{ files_scanned: 10, oversized_files: 0, unreadable_files: 0 }],
  }), Error, "Trust badge scanned and persisted file counts do not match");
});
