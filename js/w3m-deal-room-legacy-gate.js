// Server-backed rollout gate for the legacy Deal Room acceptance button.
// Only a confirmed "function not found" response or a valid status with no
// published V1 terms permits the legacy path. All ambiguous failures fail closed.
export function classifyW3MAgreementGate(httpStatus, payload) {
  if (httpStatus === 404) {
    const message = String(payload?.message || payload?.error || "");
    return /function not found/i.test(message) ? "legacy" : "blocked";
  }
  if (httpStatus === 400) {
    const message = String(payload?.message || payload?.error || "");
    return /unknown action|unsupported action/i.test(message) ? "legacy" : "blocked";
  }
  if (httpStatus !== 200 || !payload || payload.ok !== true ||
      !payload.result || typeof payload.result !== "object" ||
      Array.isArray(payload.result) ||
      !Object.prototype.hasOwnProperty.call(payload.result, "current_terms")) {
    return "blocked";
  }
  if (payload.result.current_terms === null) return "legacy";
  const terms = payload.result.current_terms;
  if (terms && typeof terms === "object" && !Array.isArray(terms) &&
      typeof terms.terms_version === "string" &&
      /^[1-9][0-9]*$/.test(terms.terms_version) &&
      typeof terms.terms_hash === "string" &&
      /^[0-9a-f]{64}$/i.test(terms.terms_hash) &&
      terms.canonical_terms && typeof terms.canonical_terms === "object" &&
      !Array.isArray(terms.canonical_terms)) {
    return "v1";
  }
  return "blocked";
}
