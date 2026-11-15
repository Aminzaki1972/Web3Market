/**
 * Fail-closed buyer acceptance gates for the isolated deal-management preview.
 * Evidence verification and approval authentication must be supplied by trusted server systems in production.
 */
export function canRecordBuyerAssetAcceptance({assetId,requiredAssetIds,evidenceStatuses,depositConfirmed,disputeActive,agreementApprovalsCurrent,agreementSnapshotCurrent}) {
  return typeof assetId === "string" &&
    Array.isArray(requiredAssetIds) && requiredAssetIds.includes(assetId) &&
    evidenceStatuses?.[assetId] === "verified" &&
    depositConfirmed === true &&
    disputeActive === false &&
    agreementApprovalsCurrent === true &&
    agreementSnapshotCurrent === true;
}

export function canRecordFinalBuyerAcceptance({requiredAssetIds,evidenceStatuses,acceptedAssetIds,rejectedAssetIds,depositConfirmed,disputeActive,agreementApprovalsCurrent,agreementSnapshotCurrent}) {
  if (!Array.isArray(requiredAssetIds) || requiredAssetIds.length === 0) return false;
  const accepted = new Set(Array.isArray(acceptedAssetIds) ? acceptedAssetIds : []);
  const rejected = new Set(Array.isArray(rejectedAssetIds) ? rejectedAssetIds : []);
  return depositConfirmed === true && disputeActive === false &&
    agreementApprovalsCurrent === true && agreementSnapshotCurrent === true &&
    requiredAssetIds.every(id => evidenceStatuses?.[id] === "verified" && accepted.has(id) && !rejected.has(id));
}
