// Validate the live Safe multisig configuration without assuming a fixed owner count or threshold.
export function assessSafeConfiguration({ owners, threshold, code }) {
  const result = {
    ok: false,
    ownerCount: Array.isArray(owners) ? owners.length : 0,
    threshold: null,
    reason: "invalid_configuration",
  };

  if (typeof code !== "string" || !/^0x[0-9a-f]*$/i.test(code) || code === "0x" || code === "0x0") {
    result.reason = "safe_contract_not_found";
    return result;
  }
  if (!Array.isArray(owners) || owners.length === 0) {
    result.reason = "owners_missing";
    return result;
  }

  const normalized = [];
  for (const owner of owners) {
    if (typeof owner !== "string" || !/^0x[0-9a-f]{40}$/i.test(owner)) {
      result.reason = "invalid_owner_address";
      return result;
    }
    normalized.push(owner.toLowerCase());
  }
  if (new Set(normalized).size !== normalized.length) {
    result.reason = "duplicate_owners";
    return result;
  }

  let parsedThreshold;
  try {
    parsedThreshold = BigInt(threshold);
  } catch {
    result.reason = "invalid_threshold";
    return result;
  }
  if (parsedThreshold <= 0n || parsedThreshold > BigInt(owners.length)) {
    result.reason = "threshold_out_of_range";
    return result;
  }

  result.ok = true;
  result.ownerCount = owners.length;
  result.threshold = parsedThreshold.toString();
  result.reason = "valid";
  return result;
}
