"use strict";

// Accept only the documented, verified create-safe success contract.
// A generic HTTP 200 or { ok: true } without verification metadata is insufficient.
export function isW3MSafeDeploymentSuccess(payload) {
  return Boolean(
    payload &&
    payload.ok === true &&
    payload.stage === "safe_deployed_and_verified" &&
    payload.usdt_moved === false &&
    /^0x[a-fA-F0-9]{40}$/.test(String(payload.safe_address || "")) &&
    Array.isArray(payload.owners) &&
    payload.owners.length === 3 &&
    String(payload.threshold) === "2"
  );
}
