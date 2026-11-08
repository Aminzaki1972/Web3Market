/**
 * Pure validation and deterministic hashing for the W3M acquisition terms V1.
 * This module does not load database rows, authorize users, persist terms, or sign.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMIT = /^[0-9a-f]{40}$/i;
const HEX_DIGEST = /^[0-9a-f]{64}$/i;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

function fail(message: string): never { throw new Error(message); }
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(label + " must be an object.");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(label + " must be a plain JSON object.");
  return value as Record<string, unknown>;
}
function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(label + " is required.");
  return value;
}
function requiredPolicyText(value: unknown, label: string): string {
  const text = requiredString(value, label).trim();
  const normalized = text.toLowerCase();
  const placeholders = new Set([
    "pending", "pending legal review", "tbd", "to be determined",
    "not defined", "not yet defined", "n/a", "na", "placeholder",
    "todo", "unknown", "draft",
  ]);
  if (placeholders.has(normalized) ||
    ["tbd", "to be determined", "pending legal review", "not yet defined", "placeholder"].some((term) => normalized.includes(term))) {
    fail(label + " must contain an approved, non-placeholder policy value.");
  }
  return text;
}
function requiredTextArray(value: unknown, label: string, minLength = 1): string[] {
  if (!Array.isArray(value) || value.length < minLength) fail(label + " must contain at least " + minLength + " item(s).");
  return value.map((item, index) => requiredString(item, label + "[" + index + "]").trim());
}
function uuid(value: unknown, label: string): string {
  const v = requiredString(value, label);
  if (!UUID.test(v)) fail(label + " must be a UUID.");
  return v.toLowerCase();
}
function decimal(value: unknown, label: string): string {
  const v = requiredString(value, label);
  if (!DECIMAL.test(v)) fail(label + " must be an exact decimal string (not a floating-point number).");
  const [whole, fraction = ""] = v.split(".");
  if (whole.length > 78 || fraction.length > 36) {
    fail(label + " exceeds the supported exact-decimal precision (78 integer digits, 36 fractional digits).");
  }
  return v;
}
function positiveDecimal(value: string, label: string): void {
  if (!/[1-9]/.test(value)) fail(label + " must be greater than zero.");
}
// Exact base-10 arithmetic for monetary invariants. No JS floating-point math.
function decimalToMinor(value: string, scale: number): bigint {
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale) fail("Monetary values must use the same declared precision.");
  return BigInt(whole) * (10n ** BigInt(scale)) + BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0");
}
function decimalScale(value: string): number {
  return value.split(".")[1]?.length ?? 0;
}
function decimalSumEquals(a: string, b: string, expected: string): boolean {
  const scale = Math.max(decimalScale(a), decimalScale(b), decimalScale(expected));
  return decimalToMinor(a, scale) + decimalToMinor(b, scale) === decimalToMinor(expected, scale);
}
function equalsDecimal(a: string, b: string): boolean {
  const scale = Math.max(decimalScale(a), decimalScale(b));
  return decimalToMinor(a, scale) === decimalToMinor(b, scale);
}
function feeAmountAtDeclaredPrecision(consideration: string, fee: string, net: string): boolean {
  const scale = Math.max(decimalScale(consideration), decimalScale(fee), decimalScale(net));
  const totalMinor = decimalToMinor(consideration, scale);
  const expectedFeeMinor = (totalMinor * 75n + 500n) / 1000n; // 7.5%, rounded half-up at the declared precision.
  return decimalToMinor(fee, scale) === expectedFeeMinor;
}
function iso(value: unknown, label: string): string {
  const v = requiredString(value, label);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(v);
  const parsed = new Date(v);
  if (
    !ISO_DATE.test(v) || !Number.isFinite(parsed.getTime()) || !match ||
    parsed.getUTCFullYear() !== Number(match[1]) ||
    parsed.getUTCMonth() + 1 !== Number(match[2]) ||
    parsed.getUTCDate() !== Number(match[3]) ||
    parsed.getUTCHours() !== Number(match[4]) ||
    parsed.getUTCMinutes() !== Number(match[5]) ||
    parsed.getUTCSeconds() !== Number(match[6])
  ) fail(label + " must be a real UTC ISO-8601 timestamp.");
  return v;
}

function canonical(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value) as string;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) fail("Terms JSON numbers must be finite safe integers; monetary values must be strings.");
    return JSON.stringify(value) as string;
  }
  if (typeof value !== "object") fail("Terms contain a non-JSON value.");
  if (seen.has(value)) fail("Terms contain a circular reference.");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const parts: string[] = [];
      for (let i = 0; i < value.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(value, i)) fail("Terms arrays must not be sparse.");
        parts.push(canonical(value[i], seen));
      }
      return "[" + parts.join(",") + "]";
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) fail("Terms objects must be plain JSON objects.");
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map((key) => {
      if (record[key] === undefined) fail("Terms must not contain undefined values.");
      return JSON.stringify(key) + ":" + canonical(record[key], seen);
    }).join(",") + "}";
  } finally { seen.delete(value); }
}

export function validateW3MAcquisitionTermsV1(input: unknown): asserts input is Record<string, unknown> {
  const root = object(input, "Terms");
  if (root.schema !== "w3m-acquisition-terms-v1") fail("Unsupported acquisition terms schema.");
  if (!Number.isSafeInteger(root.terms_version) || (root.terms_version as number) < 1) fail("Terms version must be a positive safe integer.");

  const deal = object(root.deal, "deal");
  uuid(deal.deal_id, "deal.deal_id"); uuid(deal.project_id, "deal.project_id");
  const buyerId = uuid(deal.buyer_id, "deal.buyer_id");
  const sellerId = uuid(deal.seller_id, "deal.seller_id");
  if (buyerId === sellerId) fail("Buyer and seller must be different accounts.");

  const project = object(root.project, "project");
  requiredString(project.title, "project.title"); requiredString(project.category, "project.category");

  const audit = object(root.audit, "audit");
  uuid(audit.audit_id, "audit.audit_id");
  const repository = requiredString(audit.repository, "audit.repository");
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\/[a-z0-9_.-]+$/i.test(repository)) fail("audit.repository must be owner/repository.");
  if (typeof audit.commit_sha !== "string" || !COMMIT.test(audit.commit_sha)) fail("audit.commit_sha must be a full 40-character commit SHA.");
  if (typeof audit.fingerprint_digest !== "string" || !HEX_DIGEST.test(audit.fingerprint_digest)) fail("audit.fingerprint_digest must be a 32-byte SHA-256 digest.");

  const consideration = object(root.consideration, "consideration");
  const amount = decimal(consideration.amount, "consideration.amount");
  positiveDecimal(amount, "consideration.amount");
  const considerationCurrency = requiredString(consideration.currency, "consideration.currency");

  // Signed commercial snapshot: asking price and any fixed-amount discount are historical deal inputs.
  // The final consideration remains independently agreed and is the sole platform-fee basis.
  const commercial = object(root.commercial_schedule, "commercial_schedule");
  const askingPrice = object(commercial.asking_price, "commercial_schedule.asking_price");
  const askingPriceAmount = decimal(askingPrice.amount, "commercial_schedule.asking_price.amount");
  positiveDecimal(askingPriceAmount, "commercial_schedule.asking_price.amount");
  if (requiredString(askingPrice.currency, "commercial_schedule.asking_price.currency") !== considerationCurrency) {
    fail("commercial_schedule.asking_price.currency must match consideration.currency.");
  }
  if (commercial.agreed_discount !== null) {
    const discount = object(commercial.agreed_discount, "commercial_schedule.agreed_discount");
    const discountAmount = decimal(discount.amount, "commercial_schedule.agreed_discount.amount");
    positiveDecimal(discountAmount, "commercial_schedule.agreed_discount.amount");
    requiredPolicyText(discount.description, "commercial_schedule.agreed_discount.description");
    if (requiredString(discount.currency, "commercial_schedule.agreed_discount.currency") !== considerationCurrency) {
      fail("commercial_schedule.agreed_discount.currency must match consideration.currency.");
    }
  }

  const fee = object(root.platform_fee, "platform_fee");
  const feePercent = decimal(fee.percent, "platform_fee.percent");
  if (!equalsDecimal(feePercent, "7.5")) fail("platform_fee.percent must be exactly 7.5 for W3M V1.");
  const feeAmount = decimal(fee.amount, "platform_fee.amount");

  const net = object(root.seller_net, "seller_net");
  const netAmount = decimal(net.amount, "seller_net.amount");
  const netCurrency = requiredString(net.currency, "seller_net.currency");
  if (netCurrency !== considerationCurrency) fail("seller_net.currency must match consideration.currency unless an explicit conversion schedule is added.");
  if (!decimalSumEquals(feeAmount, netAmount, amount)) {
    fail("platform_fee.amount plus seller_net.amount must equal consideration.amount exactly.");
  }
  if (!feeAmountAtDeclaredPrecision(amount, feeAmount, netAmount)) {
    fail("platform_fee.amount must equal 7.5% of consideration.amount, rounded half-up at the declared decimal precision.");
  }

  const payment = object(root.payment, "payment");
  if (payment.method !== "safe_multisig") fail("payment.method must explicitly identify the Safe multisig method.");
  if (payment.chain_id !== 56) fail("The W3M V1 signing/payment network must explicitly identify BNB Smart Chain (56).");
  requiredString(payment.asset, "payment.asset");
  if (payment.status_at_signing !== "configured_or_pending") fail("payment.status_at_signing is invalid.");
  if (payment.token_contract !== null && (typeof payment.token_contract !== "string" || !/^0x[0-9a-f]{40}$/i.test(payment.token_contract))) fail("payment.token_contract must be a valid address or null.");
  if (payment.safe_address !== null && (typeof payment.safe_address !== "string" || !/^0x[0-9a-f]{40}$/i.test(payment.safe_address))) fail("payment.safe_address must be a valid address or null.");

  const scope = object(root.transfer_scope, "transfer_scope");
  if (!Array.isArray(scope.included_assets) || scope.included_assets.length === 0) {
    fail("transfer_scope.included_assets must list at least one individually transferable asset.");
  }
  const includedAssetKeys = new Set<string>();
  scope.included_assets.forEach((rawAsset, index) => {
    const asset = object(rawAsset, "transfer_scope.included_assets[" + index + "]");
    const type = requiredString(asset.type, "transfer_scope.included_assets[" + index + "].type").trim();
    const description = requiredString(asset.description, "transfer_scope.included_assets[" + index + "].description").trim();
    requiredPolicyText(asset.transfer_method, "transfer_scope.included_assets[" + index + "].transfer_method");
    requiredPolicyText(asset.responsible_party, "transfer_scope.included_assets[" + index + "].responsible_party");
    requiredPolicyText(asset.expected_evidence, "transfer_scope.included_assets[" + index + "].expected_evidence");
    if (type.length > 100 || description.length > 300 ||
      String(asset.transfer_method).length > 500 ||
      String(asset.responsible_party).length > 200 ||
      String(asset.expected_evidence).length > 500) {
      fail("Included asset identity, transfer method, responsible party, or expected evidence exceeds the supported length.");
    }
    const key = (type + ": " + description).toLowerCase();
    if (includedAssetKeys.has(key)) fail("Included assets must not contain duplicate type and description pairs.");
    includedAssetKeys.add(key);
  });
  for (const key of ["excluded_assets", "third_party_dependencies"] as const) {
    if (!Array.isArray(scope[key])) fail("transfer_scope." + key + " must be an array.");
  }
  for (const key of ["access_and_credentials", "intellectual_property", "data_and_privacy"] as const) object(scope[key], "transfer_scope." + key);

  const delivery = object(root.delivery, "delivery");
  iso(delivery.deadline, "delivery.deadline");
  requiredTextArray(delivery.checklist, "delivery.checklist");

  const inspection = object(root.inspection, "inspection");
  if (typeof inspection.enabled !== "boolean") fail("inspection.enabled must be explicitly true or false.");
  if (inspection.enabled === true) {
    requiredPolicyText(inspection.window, "inspection.window");
    requiredTextArray(inspection.acceptance_criteria, "inspection.acceptance_criteria");
  } else {
    if (inspection.window !== null) fail("inspection.window must be null when inspection is disabled.");
    if (!Array.isArray(inspection.acceptance_criteria) || inspection.acceptance_criteria.length !== 0) {
      fail("inspection.acceptance_criteria must be an empty array when inspection is disabled.");
    }
  }

  const dispute = object(root.dispute, "dispute");
  requiredPolicyText(dispute.procedure_version, "dispute.procedure_version");
  requiredPolicyText(dispute.text, "dispute.text");

  // The canonical terms describe Safe multisig settlement only; no separate escrow contract or platform custody is implied.
  const safeSettlement = object(root.safe_settlement, "safe_settlement");
  if (safeSettlement.method !== "safe_multisig") fail("safe_settlement.method must explicitly identify Safe multisig settlement.");
  requiredPolicyText(safeSettlement.funding_condition, "safe_settlement.funding_condition");
  requiredPolicyText(safeSettlement.release_condition, "safe_settlement.release_condition");
  if (safeSettlement.dispute_hold !== true) fail("Safe settlement must enforce a dispute hold.");
  if (Object.prototype.hasOwnProperty.call(root, "escrow")) fail("The legacy escrow field is not accepted; use safe_settlement to describe the Safe-only workflow.");

  const governing = object(root.governing_terms, "governing_terms");
  requiredPolicyText(governing.governing_law, "governing_terms.governing_law");
  requiredPolicyText(governing.venue_or_process, "governing_terms.venue_or_process");
  requiredPolicyText(governing.language, "governing_terms.language");

  requiredTextArray(root.risk_acknowledgements, "risk_acknowledgements");
  if (!Array.isArray(root.disclosures)) fail("disclosures must be an array.");
  const created = iso(root.created_at, "created_at");
  const expires = iso(root.expires_at, "expires_at");
  if (Date.parse(expires) <= Date.parse(created)) fail("expires_at must be later than created_at.");

  // Validate the complete structure, including nested custom disclosures and evidence.
  canonical(root);
}

export function canonicalizeW3MAcquisitionTermsV1(input: unknown): string {
  validateW3MAcquisitionTermsV1(input);
  return canonical(input);
}

export async function hashW3MAcquisitionTermsV1(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode("w3m-acquisition-terms:v1\n" + canonicalizeW3MAcquisitionTermsV1(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
