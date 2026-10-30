export type TrustBadgeBatchStats = {
  files_scanned: number;
  oversized_files: number;
  unreadable_files: number;
};

export type TrustBadgeCompletionEvidence = {
  evidence_version: "w3m-audit-evidence-v1";
  tree_truncated: false;
  eligible_files: number;
  files_scanned: number;
  persisted_file_count: number;
  oversized_files: number;
  pre_skipped_oversized_files: number;
  unreadable_files: number;
  total_file_batches: number;
};

export function buildTrustBadgeCompletionEvidence(input: {
  eligibleFiles: number;
  persistedFileCount: number;
  preSkippedOversized: number;
  totalFileBatches: number;
  batchStats: TrustBadgeBatchStats[];
}): TrustBadgeCompletionEvidence {
  const { eligibleFiles, persistedFileCount, preSkippedOversized, totalFileBatches, batchStats } = input;
  const validCount = (value: number) => Number.isInteger(value) && value >= 0;
  if (!Number.isInteger(eligibleFiles) || eligibleFiles <= 0 ||
      !validCount(persistedFileCount) ||
      !validCount(preSkippedOversized) ||
      !Number.isInteger(totalFileBatches) || totalFileBatches <= 0 ||
      !Array.isArray(batchStats) || batchStats.length !== totalFileBatches) {
    throw new Error("Invalid trust badge completion evidence");
  }

  let filesScanned = 0;
  let oversizedFiles = preSkippedOversized;
  let unreadableFiles = 0;
  for (const batch of batchStats) {
    if (!batch ||
        !validCount(batch.files_scanned) ||
        !validCount(batch.oversized_files) ||
        !validCount(batch.unreadable_files)) {
      throw new Error("Invalid trust badge batch evidence");
    }
    filesScanned += batch.files_scanned;
    oversizedFiles += batch.oversized_files;
    unreadableFiles += batch.unreadable_files;
  }

  if (filesScanned !== persistedFileCount || filesScanned > eligibleFiles ||
      persistedFileCount > eligibleFiles) {
    throw new Error("Trust badge scanned and persisted file counts do not match");
  }

  return {
    evidence_version: "w3m-audit-evidence-v1",
    tree_truncated: false,
    eligible_files: eligibleFiles,
    files_scanned: filesScanned,
    persisted_file_count: persistedFileCount,
    oversized_files: oversizedFiles,
    pre_skipped_oversized_files: preSkippedOversized,
    unreadable_files: unreadableFiles,
    total_file_batches: totalFileBatches,
  };
}
