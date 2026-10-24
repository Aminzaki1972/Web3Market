export type AuditBatchStats = {
  files_scanned?: number;
  lines_scanned?: number;
  bytes_analyzed?: number;
  oversized_files?: number;
  unreadable_files?: number;
};

export function queuedNextBatchProgress(
  progress: Record<string, unknown>,
  nextBatchIndex: number,
  totalFileBatches: number,
  eligibleFiles: number,
  batchStats: AuditBatchStats[],
  updatedAt = new Date().toISOString(),
): Record<string, unknown> {
  if (!Number.isInteger(nextBatchIndex) || nextBatchIndex < 0 ||
      !Number.isInteger(totalFileBatches) || totalFileBatches < 1 ||
      nextBatchIndex >= totalFileBatches ||
      !Number.isInteger(eligibleFiles) || eligibleFiles < 0) {
    throw new Error("Invalid audit batch checkpoint");
  }
  return {
    ...progress,
    status: "queued",
    file_batch_index: nextBatchIndex,
    total_file_batches: totalFileBatches,
    eligible_files: eligibleFiles,
    batch_stats: batchStats,
    current_chunk: 0,
    total_chunks: 0,
    updated_at: updatedAt,
  };
}
