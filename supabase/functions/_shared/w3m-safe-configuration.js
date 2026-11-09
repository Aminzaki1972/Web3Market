// Server-side copy of the W3M V1 Safe configuration validator.
// Keep behavior aligned with js/w3m-safe-configuration.js; parity is covered by CI tests.
export function assessSafeConfiguration({ owners, threshold, code, expectedOwners }) {
  const result = {
    ok: false,
    ownerCount: Array.isArray(owners) ? owners.length : 0,
    threshold: null,
    reason: "invalid_configuration",
  };

  if (typeof code !== "string" || !/^0x[0-9a-f]*$/i.test(code) || !/[1-9a-f]/i.test(code.slice(2))) {
    result.reason = "safe_contract_not_found";
    return result;
  }
  if (!Array.isArray(owners) || owners.length === 0) {
    result.reason = "owners_missing";
    return result;
  }
  if (owners.length !== 3) {
    result.reason = "owner_count_must_be_three";
    return result;
  }

  const normalized = [];
  for (const owner of owners) {
    if (typeof owner !== "string" || !/^0x[0-9a-f]{40}$/i.test(owner)) {
      result.reason = "invalid_owner_address";
      return result;
    }
    if (/^0x0{40}$/i.test(owner)) {
      result.reason = "zero_owner_address";
      return result;
    }
    normalized.push(owner.toLowerCase());
  }
  if (new Set(normalized).size !== normalized.length) {
    result.reason = "duplicate_owners";
    return result;
  }

  if (!Array.isArray(expectedOwners) || expectedOwners.length !== 3) {
    result.reason = "expected_owner_set_unavailable";
    return result;
  }
  const normalizedExpected = [];
  for (const owner of expectedOwners) {
    if (typeof owner !== "string" || !/^0x[0-9a-f]{40}$/i.test(owner) || /^0x0{40}$/i.test(owner)) {
      result.reason = "expected_owner_set_invalid";
      return result;
    }
    normalizedExpected.push(owner.toLowerCase());
  }
  if (new Set(normalizedExpected).size !== 3) {
    result.reason = "expected_owner_set_invalid";
    return result;
  }
  if (normalized.slice().sort().join(":") !== normalizedExpected.slice().sort().join(":")) {
    result.reason = "owner_set_mismatch";
    return result;
  }

  let parsedThreshold;
  try {
    parsedThreshold = BigInt(threshold);
  } catch {
    result.reason = "invalid_threshold";
    return result;
  }
  if (parsedThreshold !== 2n) {
    result.reason = "threshold_must_be_two_of_three";
    return result;
  }

  result.ok = true;
  result.ownerCount = owners.length;
  result.threshold = parsedThreshold.toString();
  result.reason = "valid";
  return result;
}
