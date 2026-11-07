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
function exceedsOneHundred(value: string): boolean {
  const [whole, fraction = ""] = value.split(".");
  const integer = BigInt(whole);
  return integer > 100n || (integer === 100n && /[1-9]/.test(fraction));
}

// Exact base-10 arithmetic for monetary invariants. No JS floating-point math.
function decimalToMinor(value: string, scale: number): bigint {
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale) fail("Monetary values must use the same declared precision.");
  return BigInt(whole) * (10n ** BigInt(scale)) + BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0");
}
function decimalSumEquals(a: string, b: string, expected: string): boolean {
  const scale = Math.max(a.split(".")[1]?.length ?? 0, b.split(".")[1]?.length ?? 0, expected.split(".")[1]?.length ?? 0);
  return decimalToMinor(a, scale) + decimalToMinor(b, scale) === decimalToMinor(expected, scale);
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
  requiredString(consideration.currency, "consideration.currency");

  const fee = object(root.platform_fee, "platform_fee");
  const feePercent = decimal(fee.percent, "platform_fee.percent");
  if (exceedsOneHundred(feePercent)) fail("platform_fee.percent cannot exceed 100.");
  const feeAmount = decimal(fee.amount, "platform_fee.amount");

  const net = object(root.seller_net, "seller_net");
  const netAmount = decimal(net.amount, "seller_net.amount");
  const netCurrency = requiredString(net.currency, "seller_net.currency");
  const considerationCurrency = requiredString(consideration.currency, "consideration.currency");
  if (netCurrency !== considerationCurrency) fail("seller_net.currency must match consideration.currency unless an explicit conversion schedule is added.");
  if (!decimalSumEquals(feeAmount, netAmount, amount)) {
    fail("platform_fee.amount plus seller_net.amount must equal consideration.amount exactly.");
  }

  const payment = object(root.payment, "payment");
  if (payment.method !== "safe_multisig") fail("payment.method must explicitly identify the Safe multisig method.");
  if (payment.chain_id !== 56) fail("The W3M V1 signing/payment network must explicitly identify BNB Smart Chain (56).");
  requiredString(payment.asset, "payment.asset");
  if (payment.status_at_signing !== "configured_or_pending") fail("payment.status_at_signing is invalid.");
  if (payment.token_contract !== null && (typeof payment.token_contract !== "string" || !/^0x[0-9a-f]{40}$/i.test(payment.token_contract))) fail("payment.token_contract must be a valid address or null.");
  if (payment.safe_address !== null && (typeof payment.safe_address !== "string" || !/^0x[0-9a-f]{40}$/i.test(payment.safe_address))) fail("payment.safe_address must be a valid address or null.");

  const scope = object(root.transfer_scope, "transfer_scope");
  for (const key of ["included_assets", "excluded_assets", "third_party_dependencies"] as const) {
    if (!Array.isArray(scope[key])) fail("transfer_scope." + key + " must be an array.");
  }
  for (const key of ["access_and_credentials", "intellectual_property", "data_and_privacy"] as const) object(scope[key], "transfer_scope." + key);

  const delivery = object(root.delivery, "delivery");
  iso(delivery.deadline, "delivery.deadline");
  requiredTextArray(delivery.checklist, "delivery.checklist");

  const inspection = object(root.inspection, "inspection");
  requiredPolicyText(inspection.window, "inspection.window");
  requiredTextArray(inspection.acceptance_criteria, "inspection.acceptance_criteria");

  const dispute = object(root.dispute, "dispute");
  requiredPolicyText(dispute.procedure_version, "dispute.procedure_version");
  requiredPolicyText(dispute.text, "dispute.text");

  const escrow = object(root.escrow, "escrow");
  requiredPolicyText(escrow.funding_condition, "escrow.funding_condition");
  requiredPolicyText(escrow.release_condition, "escrow.release_condition");
  if (escrow.dispute_hold !== true) fail("Escrow must enforce a dispute hold.");

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
