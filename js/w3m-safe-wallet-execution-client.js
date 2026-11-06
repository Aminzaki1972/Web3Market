// W3M Protocol V1 — non-custodial Safe wallet submission helper.
// Call submitSafeWalletExecutionPackage only from an explicit user gesture.
// It asks the connected owner wallet to submit execTransaction and never
// signs in JavaScript, stores keys, or treats the returned hash as settlement.
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const UINT = /^(0|[1-9][0-9]*)$/;
const SIGNATURE = /^0x[0-9a-f]{130}$/i;
const EXEC_TRANSACTION_SELECTOR = "6a761202";
const SAFE_NONCE_SELECTOR = "0xaffed0e0";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function hexBytes(value, label) {
  assert(typeof value === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(value), label + " is malformed.");
  return value.slice(2).toLowerCase();
}
function word(value, label) {
  const text = typeof value === "bigint" ? value.toString() : String(value);
  assert(UINT.test(text), label + " is not an exact unsigned integer.");
  const hex = BigInt(text).toString(16);
  assert(hex.length <= 64, label + " exceeds uint256.");
  return hex.padStart(64, "0");
}
function addressWord(value, label) {
  assert(typeof value === "string" && ADDRESS.test(value), label + " is not a valid address.");
  return value.slice(2).toLowerCase().padStart(64, "0");
}
function dynamicBytes(value, label) {
  const bytes = hexBytes(value, label);
  const padded = bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0");
  return word(bytes.length / 2, label + " length") + padded;
}
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalValue(value[key]);
    return result;
  }
  return value;
}
function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function validatePackage(pkg) {
  assert(pkg && typeof pkg === "object" && pkg.protocol === "W3M_PROTOCOL_V1", "W3M package is missing.");
  assert(pkg.chainId === 56, "W3M package is not for BNB Chain 56.");
  assert(ADDRESS.test(pkg.safeAddress || ""), "Safe address is invalid.");
  assert(HASH.test(pkg.safeTransactionHash || ""), "Safe transaction hash is invalid.");
  assert(typeof pkg.expiresAt === "string" && Date.parse(pkg.expiresAt) > Date.now(), "W3M package has expired.");
  assert(pkg.call && ADDRESS.test(pkg.call.to || ""), "Safe call target is invalid.");
  assert(UINT.test(pkg.call.value) && pkg.call.value === "0", "Safe call native value must be zero.");
  assert(UINT.test(pkg.call.nonce), "Safe nonce is invalid.");
  assert(pkg.call.operation === 0 || pkg.call.operation === 1, "Safe operation is invalid.");
  assert(Array.isArray(pkg.signatures) && pkg.signatures.length >= pkg.requiredSignatures,
    "Verified Safe signature threshold is not met.");
  let previous = "";
  const seen = new Set();
  for (const row of pkg.signatures) {
    assert(ADDRESS.test(row.signerAddress || "") && SIGNATURE.test(row.signature || ""),
      "Safe owner signature is malformed.");
    const current = row.signerAddress.toLowerCase();
    assert(!seen.has(current) && (!previous || previous < current),
      "Safe signatures must be unique and sorted by owner address.");
    seen.add(current);
    previous = current;
  }
}
export function encodeSafeExecTransactionCalldata(pkg) {
  validatePackage(pkg);
  const call = pkg.call;
  const data = hexBytes(call.data, "Safe inner calldata");
  const signatures = "0x" + pkg.signatures.map((row) => row.signature.slice(2).toLowerCase()).join("");
  const dataTail = dynamicBytes("0x" + data, "Safe inner calldata");
  const signatureTail = dynamicBytes(signatures, "Safe signatures");
  const headBytes = 10 * 32;
  const dataOffset = headBytes;
  const signatureOffset = headBytes + dataTail.length / 2;
  const head = [
    addressWord(call.to, "Safe call target"),
    word(call.value, "Safe call value"),
    word(dataOffset, "Safe calldata offset"),
    word(call.operation, "Safe operation"),
    word(call.safeTxGas, "Safe transaction gas"),
    word(call.baseGas, "Safe base gas"),
    word(call.gasPrice, "Safe gas price"),
    addressWord(call.gasToken, "Safe gas token"),
    addressWord(call.refundReceiver, "Safe refund receiver"),
    word(signatureOffset, "Safe signatures offset"),
  ].join("");
  return "0x" + EXEC_TRANSACTION_SELECTOR + head + dataTail + signatureTail;
}

/**
 * @param {{provider:{request:(args:{method:string;params?:unknown[]})=>Promise<unknown>}, package:object, expectedPackageHash:string, now?:()=>number}} options
 * EIP-1193 provider, exact server-issued package, and SHA-256 from the authenticated endpoint.
 */
export async function submitSafeWalletExecutionPackage({
  provider,
  package: pkg,
  expectedPackageHash,
  now = () => Date.now(),
}) {
  assert(provider && typeof provider.request === "function", "A connected EIP-1193 wallet is required.");
  validatePackage(pkg);
  assert(HASH.test("0x" + String(expectedPackageHash || "")), "Server package hash is invalid.");
  assert(Date.parse(pkg.expiresAt) > now(), "W3M package has expired.");
  const actualHash = await sha256Hex(canonicalJson(pkg));
  assert(actualHash.toLowerCase() === expectedPackageHash.toLowerCase(),
    "W3M package hash does not match the server-issued package.");

  const chain = await provider.request({ method: "eth_chainId" });
  assert(typeof chain === "string" && BigInt(chain) === 56n, "Switch the connected wallet to BNB Chain 56.");
  let accounts = await provider.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts) || accounts.length === 0) {
    accounts = await provider.request({ method: "eth_requestAccounts" });
  }
  assert(Array.isArray(accounts) && accounts.length > 0 && ADDRESS.test(accounts[0]),
    "No connected wallet account is available.");
  const from = accounts[0];
  assert(pkg.signatures.some((row) => row.signerAddress.toLowerCase() === from.toLowerCase()),
    "Connected wallet is not one of the verified Safe signers.");

  const nonceResult = await provider.request({
    method: "eth_call",
    params: [{ to: pkg.safeAddress, data: SAFE_NONCE_SELECTOR }, "latest"],
  });
  assert(typeof nonceResult === "string" && /^0x[0-9a-f]{64}$/i.test(nonceResult),
    "Could not read the current Safe nonce.");
  assert(BigInt(nonceResult) === BigInt(pkg.call.nonce), "Safe nonce changed; request a fresh W3M package.");

  const data = encodeSafeExecTransactionCalldata(pkg);
  const transactionHash = await provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to: pkg.safeAddress, data, value: "0x0" }],
  });
  assert(typeof transactionHash === "string" && HASH.test(transactionHash),
    "Wallet did not return a valid BNB transaction hash.");
  return {
    transactionHash,
    from,
    safeAddress: pkg.safeAddress,
    safeTransactionHash: pkg.safeTransactionHash,
    state: "SUBMITTED_UNVERIFIED",
  };
}


/**
 * Complete browser handoff: request a one-use package, ask the connected owner
 * wallet to submit Safe.execTransaction, then persist the returned outer hash.
 * Must be called from an explicit user gesture. A returned hash is never proof
 * of execution; server receipt verification and FINALIZE remain separate.
 *
 * @param {{provider:object, dealId:string, accessToken:string, supabaseUrl:string,
 *   fetchImpl?:typeof fetch, now?:()=>number}} options
 */
export async function executeW3MDealReleaseFromWallet({
  provider,
  dealId,
  accessToken,
  supabaseUrl,
  fetchImpl = fetch,
  now = () => Date.now(),
}) {
  assert(typeof dealId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dealId),
    "A valid deal ID is required.");
  assert(typeof accessToken === "string" && accessToken.trim().length > 0,
    "An authenticated Supabase access token is required.");
  let base;
  try {
    base = new URL(supabaseUrl);
  } catch {
    throw new Error("Supabase URL is invalid.");
  }
  assert(base.protocol === "https:" && !base.username && !base.password && !base.search && !base.hash,
    "Supabase endpoint must be a clean HTTPS URL.");
  const headers = {
    "Authorization": "Bearer " + accessToken,
    "Content-Type": "application/json",
  };
  const packageResponse = await fetchImpl(
    new URL("/functions/v1/w3m-protocol-v1-safe-wallet-package", base.origin),
    { method: "POST", headers, body: JSON.stringify({ deal_id: dealId }) },
  );
  let packageBody;
  try { packageBody = await packageResponse.json(); } catch {
    throw new Error("W3M package endpoint returned invalid JSON.");
  }
  assert(packageResponse.ok && packageBody?.ok === true &&
    packageBody.state === "PACKAGE_ISSUED" &&
    typeof packageBody.attempt_id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(packageBody.attempt_id) &&
    typeof packageBody.package_hash === "string" &&
    /^[0-9a-f]{64}$/i.test(packageBody.package_hash) &&
    packageBody.package?.dealId === dealId,
  packageBody?.error || "W3M did not issue a valid execution package.");

  const submitted = await submitSafeWalletExecutionPackage({
    provider,
    package: packageBody.package,
    expectedPackageHash: packageBody.package_hash,
    now,
  });

  let persistenceResponse;
  let persistenceBody;
  try {
    persistenceResponse = await fetchImpl(
      new URL("/functions/v1/w3m-protocol-v1-safe-wallet-submit", base.origin),
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          attempt_id: packageBody.attempt_id,
          package_hash: packageBody.package_hash,
          transaction_hash: submitted.transactionHash,
        }),
      },
    );
    persistenceBody = await persistenceResponse.json();
  } catch {
    return {
      state: "SUBMITTED_UNRECORDED",
      attemptId: packageBody.attempt_id,
      packageHash: packageBody.package_hash,
      transactionHash: submitted.transactionHash,
      receiptVerified: false,
      finalized: false,
    };
  }

  if (!persistenceResponse.ok || persistenceBody?.ok !== true ||
      !["BROADCAST_UNVERIFIED", "RECONCILIATION_REQUIRED"].includes(persistenceBody.state) ||
      persistenceBody.transaction_hash?.toLowerCase() !== submitted.transactionHash.toLowerCase()) {
    return {
      state: "SUBMITTED_UNRECORDED",
      attemptId: packageBody.attempt_id,
      packageHash: packageBody.package_hash,
      transactionHash: submitted.transactionHash,
      receiptVerified: false,
      finalized: false,
    };
  }
  return {
    state: persistenceBody.state,
    attemptId: packageBody.attempt_id,
    packageHash: packageBody.package_hash,
    transactionHash: submitted.transactionHash,
    receiptVerified: false,
    finalized: false,
  };
}
