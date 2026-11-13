// Server-backed rollout gate. Only an authoritative protocol-track value
// returned by the authenticated server may select a deal's acceptance path.
// Missing, malformed, or failed responses always fail closed.
export function classifyW3MAgreementGate(httpStatus, payload) {
  if (httpStatus !== 200 || !payload || payload.ok !== true ||
      !payload.result || typeof payload.result !== "object" ||
      Array.isArray(payload.result)) return "blocked";
  const track = payload.result.protocol_track;
  if (track === "legacy" || track === "v1") return track;
  return "blocked";
}
