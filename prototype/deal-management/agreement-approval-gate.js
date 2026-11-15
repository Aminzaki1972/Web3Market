/**
 * Pure approval-gate helpers for the isolated deal-management preview.
 * This is not authentication, legal consent, or a trusted server approval.
 */
const ROLES = new Set(["buyer", "seller", "platform"]);

export function canRecordAgreementApproval(role, capturedVersion, capturedHash, currentVersion, currentHash) {
  return ROLES.has(role) &&
    Number.isSafeInteger(capturedVersion) &&
    capturedVersion > 0 &&
    capturedVersion === currentVersion &&
    typeof capturedHash === "string" &&
    /^0x[0-9a-f]{64}$/.test(capturedHash) &&
    capturedHash === currentHash;
}

export function haveAllCurrentAgreementApprovals(approvals, approvalHashes, approvalVersions, currentVersion, currentHash) {
  if (!currentHash || !Number.isSafeInteger(currentVersion) || currentVersion <= 0) return false;
  return [...ROLES].every(role =>
    approvals?.[role] === true &&
    approvalHashes?.[role] === currentHash &&
    approvalVersions?.[role] === currentVersion
  );
}
