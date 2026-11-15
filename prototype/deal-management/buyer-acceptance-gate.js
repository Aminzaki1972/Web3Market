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
  if (!Array.isArray(requiredAssetIds) || requiredAssetIds.length === 0 ||
      requiredAssetIds.some(id => typeof id !== "string" || !id.trim()) ||
      new Set(requiredAssetIds).size !== requiredAssetIds.length ||
      !Array.isArray(acceptedAssetIds) || !Array.isArray(rejectedAssetIds)) return false;
  const accepted = new Set(acceptedAssetIds);
  const rejected = new Set(rejectedAssetIds);
  return accepted.size === acceptedAssetIds.length &&
    rejected.size === rejectedAssetIds.length &&
    accepted.size === requiredAssetIds.length &&
    requiredAssetIds.every(id => evidenceStatuses?.[id] === "verified" && accepted.has(id) && !rejected.has(id)) &&
    rejectedAssetIds.every(id => !accepted.has(id) && requiredAssetIds.includes(id)) &&
    depositConfirmed === true && disputeActive === false &&
    agreementApprovalsCurrent === true && agreementSnapshotCurrent === true;
}
