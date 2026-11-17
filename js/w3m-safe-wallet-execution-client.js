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
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert(uuid.test(pkg.agreementTermsVersionId || "") &&
    uuid.test(pkg.buyerAcceptanceId || "") &&
    uuid.test(pkg.sellerAcceptanceId || "") &&
    pkg.buyerAcceptanceId !== pkg.sellerAcceptanceId &&
    /^[1-9][0-9]*$/.test(pkg.agreementTermsVersion || "") &&
    /^[0-9a-f]{64}$/i.test(pkg.agreementTermsHash || "") &&
    HASH.test(pkg.buyerAcceptanceDigest || "") &&
    HASH.test(pkg.sellerAcceptanceDigest || "") &&
    pkg.buyerAcceptanceDigest.toLowerCase() !== pkg.sellerAcceptanceDigest.toLowerCase(),
  "Exact immutable buyer and seller EIP-712 acceptances are required.");
  assert(ADDRESS.test(pkg.safeAddress || ""), "Safe address is invalid.");
  assert(ADDRESS.test(pkg.executorWallet || ""), "Authenticated executor wallet is invalid.");
  assert(Array.isArray(pkg.safeOwners) && pkg.safeOwners.length > 0 &&
    pkg.safeOwners.every((owner) => ADDRESS.test(owner || "")) &&
    new Set(pkg.safeOwners.map((owner) => owner.toLowerCase())).size === pkg.safeOwners.length &&
    pkg.safeOwners.some((owner) => owner.toLowerCase() === pkg.executorWallet.toLowerCase()),
    "Authenticated executor wallet is not in the current Safe owner set.");
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
  assert(from.toLowerCase() === pkg.executorWallet.toLowerCase(),
    "Connected wallet does not match the authenticated participant's verified wallet.");
  assert(pkg.safeOwners.some((owner) => owner.toLowerCase() === from.toLowerCase()),
    "Connected wallet is not a current Safe owner.");

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
    executorWallet: pkg.executorWallet,
    safeOwners: pkg.safeOwners,
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
 * @param {{provider:object, dealId:string, accessToken:string, apiKey:string, supabaseUrl:string,
 *   fetchImpl?:typeof fetch, now?:()=>number}} options
 */
export async function executeW3MDealReleaseFromWallet({
  provider,
  dealId,
  accessToken,
  apiKey,
  supabaseUrl,
  fetchImpl = fetch,
  now = () => Date.now(),
}) {
  assert(typeof dealId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dealId),
    "A valid deal ID is required.");
  assert(typeof accessToken === "string" && accessToken.trim().length > 0,
    "An authenticated Supabase access token is required.");
  assert(typeof apiKey === "string" && apiKey.trim().length > 0,
    "A Supabase publishable API key is required.");
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
    "apikey": apiKey,
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

  return await recordW3MSafeWalletSubmission({
    attemptId: packageBody.attempt_id,
    packageHash: packageBody.package_hash,
    transactionHash: submitted.transactionHash,
    accessToken,
    apiKey,
    supabaseUrl,
    fetchImpl,
  });
}


/**
 * Retry persistence of an already-submitted outer transaction hash.
 * Use this after executeW3MDealReleaseFromWallet returns SUBMITTED_UNRECORDED.
 * It never asks the wallet to send again; it only retries the authenticated,
 * idempotent hash-recording endpoint for the original attempt/package/hash.
 *
 * @param {{attemptId:string, packageHash:string, transactionHash:string,
 *   accessToken:string, apiKey:string, supabaseUrl:string,
 *   fetchImpl?:typeof fetch}} options
 */
export async function recordW3MSafeWalletSubmission({
  attemptId,
  packageHash,
  transactionHash,
  accessToken,
  apiKey,
  supabaseUrl,
  fetchImpl = fetch,
}) {
  assert(typeof attemptId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId),
  "A valid W3M execution attempt ID is required.");
  assert(typeof packageHash === "string" && /^[0-9a-f]{64}$/i.test(packageHash),
    "A valid W3M package hash is required.");
  assert(typeof transactionHash === "string" && HASH.test(transactionHash),
    "A valid already-submitted BNB transaction hash is required.");
  assert(typeof accessToken === "string" && accessToken.trim().length > 0,
    "An authenticated Supabase access token is required.");
  assert(typeof apiKey === "string" && apiKey.trim().length > 0,
    "A Supabase publishable API key is required.");
  let base;
  try { base = new URL(supabaseUrl); } catch {
    throw new Error("Supabase URL is invalid.");
  }
  assert(base.protocol === "https:" && !base.username && !base.password && !base.search && !base.hash,
    "Supabase endpoint must be a clean HTTPS URL.");
  let response;
  let body;
  try {
    response = await fetchImpl(
      new URL("/functions/v1/w3m-protocol-v1-safe-wallet-submit", base.origin),
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + accessToken,
          "apikey": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          attempt_id: attemptId,
          package_hash: packageHash.toLowerCase(),
          transaction_hash: transactionHash.toLowerCase(),
        }),
      },
    );
    body = await response.json();
  } catch {
    return {
      state: "SUBMITTED_UNRECORDED",
      attemptId,
      packageHash: packageHash.toLowerCase(),
      transactionHash: transactionHash.toLowerCase(),
      receiptVerified: false,
      finalized: false,
    };
  }
  if (!response.ok || body?.ok !== true ||
      !["BROADCAST_UNVERIFIED", "RECONCILIATION_REQUIRED"].includes(body.state) ||
      body.attempt_id !== attemptId ||
      body.transaction_hash?.toLowerCase() !== transactionHash.toLowerCase()) {
    return {
      state: "SUBMITTED_UNRECORDED",
      attemptId,
      packageHash: packageHash.toLowerCase(),
      transactionHash: transactionHash.toLowerCase(),
      receiptVerified: false,
      finalized: false,
    };
  }
  return {
    state: body.state,
    attemptId,
    packageHash: packageHash.toLowerCase(),
    transactionHash: transactionHash.toLowerCase(),
    receiptVerified: false,
    finalized: false,
  };
}

/**
 * Ask the isolated server to independently verify the canonical BNB receipt
 * and run atomic FINALIZE. The browser supplies only the attempt ID; no
 * receipt, transfer amounts, or "success" claim is accepted from the client.
 *
 * @param {{attemptId:string, accessToken:string, apiKey:string, supabaseUrl:string,
 *   fetchImpl?:typeof fetch}} options
 */
export async function verifyW3MDealReleaseFromServer({
  attemptId,
  accessToken,
  apiKey,
  supabaseUrl,
  fetchImpl = fetch,
}) {
  assert(typeof attemptId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId),
  "A valid W3M execution attempt ID is required.");
  assert(typeof accessToken === "string" && accessToken.trim().length > 0,
    "An authenticated Supabase access token is required.");
  assert(typeof apiKey === "string" && apiKey.trim().length > 0,
    "A Supabase publishable API key is required.");
  let base;
  try { base = new URL(supabaseUrl); } catch {
    throw new Error("Supabase URL is invalid.");
  }
  assert(base.protocol === "https:" && !base.username && !base.password && !base.search && !base.hash,
    "Supabase endpoint must be a clean HTTPS URL.");
  const response = await fetchImpl(
    new URL("/functions/v1/w3m-protocol-v1-finalize-safe-release", base.origin),
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "apikey": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ attempt_id: attemptId }),
    },
  );
  let body;
  try { body = await response.json(); } catch {
    throw new Error("W3M finalization endpoint returned invalid JSON.");
  }
  if (response.status === 409 && body?.ok === false) {
    return { state: "VERIFICATION_PENDING_OR_BLOCKED", attemptId, finalized: false };
  }
  assert(response.ok && body?.ok === true && body.result?.state === "CONFIRMED" &&
    body.result?.attemptId === attemptId,
  body?.error || "W3M server has not confirmed this exact execution attempt.");
  return {
    state: "CONFIRMED",
    attemptId,
    transactionHash: body.result.broadcastTxHash,
    idempotentReplay: body.result.idempotentReplay === true,
    finalized: true,
  };
}



/**
 * Sign the exact already-prepared Safe EIP-712 transaction and submit that
 * signature to the isolated W3M SIGN endpoint. The server independently
 * reloads W3M PASS, party agreement, profile wallet, and Safe state before
 * atomically storing the signature.
 *
 * @param {{signer:object, ethers:object, dealId:string, safeAddress:string,
 *   safeTransactionHash:string, transaction:object, expectedWallet:string,
 *   accessToken:string, apiKey:string, supabaseUrl:string,
 *   fetchImpl?:typeof fetch}} options
 */
export async function signW3MSafeRelease({
  signer,
  ethers,
  dealId,
  safeAddress,
  safeTransactionHash,
  transaction,
  expectedWallet,
  accessToken,
  apiKey,
  supabaseUrl,
  fetchImpl = fetch,
}) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert(typeof dealId === "string" && uuid.test(dealId), "A valid deal ID is required.");
  assert(ADDRESS.test(safeAddress || ""), "Safe address is invalid.");
  assert(HASH.test(safeTransactionHash || ""), "Safe transaction hash is invalid.");
  assert(ADDRESS.test(expectedWallet || ""), "Verified participant wallet is invalid.");
  assert(signer && typeof signer.getAddress === "function" &&
    typeof signer.signTypedData === "function" && signer.provider &&
    typeof signer.provider.getNetwork === "function",
  "A connected ethers signer is required.");
  assert(ethers?.TypedDataEncoder && typeof ethers.TypedDataEncoder.hash === "function",
    "Ethers TypedDataEncoder is required.");
  const network = await signer.provider.getNetwork();
  assert(BigInt(network.chainId) === 56n, "Connected wallet must be on BNB Chain 56.");
  const signerAddress = await signer.getAddress();
  assert(ADDRESS.test(signerAddress) &&
    signerAddress.toLowerCase() === expectedWallet.toLowerCase(),
  "Connected signer does not match the verified participant wallet.");

  const UINT = /^(0|[1-9][0-9]*)$/;
  assert(transaction && ADDRESS.test(transaction.to || "") &&
    typeof transaction.data === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(transaction.data) &&
    (transaction.operation === 0 || transaction.operation === 1) &&
    [transaction.value, transaction.safeTxGas, transaction.baseGas,
      transaction.gasPrice, transaction.nonce].every((value) =>
        typeof value === "string" && UINT.test(value)) &&
    ADDRESS.test(transaction.gasToken || "") &&
    ADDRESS.test(transaction.refundReceiver || ""),
  "Safe EIP-712 transaction fields are invalid.");

  const domain = { chainId: 56, verifyingContract: safeAddress };
  const types = {
    SafeTx: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "nonce", type: "uint256" },
    ],
  };
  const message = {
    to: transaction.to,
    value: transaction.value,
    data: transaction.data,
    operation: transaction.operation,
    safeTxGas: transaction.safeTxGas,
    baseGas: transaction.baseGas,
    gasPrice: transaction.gasPrice,
    gasToken: transaction.gasToken,
    refundReceiver: transaction.refundReceiver,
    nonce: transaction.nonce,
  };
  const digest = ethers.TypedDataEncoder.hash(domain, types, message);
  assert(typeof digest === "string" &&
    digest.toLowerCase() === safeTransactionHash.toLowerCase(),
  "Safe EIP-712 digest does not match the prepared Safe transaction hash.");

  const signature = await signer.signTypedData(domain, types, message);
  assert(typeof signature === "string" && /^0x[0-9a-f]{130}$/i.test(signature),
    "Wallet returned an invalid Safe EIP-712 signature.");
  assert(typeof accessToken === "string" && accessToken.trim().length > 0,
    "An authenticated Supabase access token is required.");
  assert(typeof apiKey === "string" && apiKey.trim().length > 0,
    "A Supabase publishable API key is required.");
  let base;
  try { base = new URL(supabaseUrl); } catch {
    throw new Error("Supabase URL is invalid.");
  }
  assert(base.protocol === "https:" && !base.username && !base.password && !base.search && !base.hash,
    "Supabase endpoint must be a clean HTTPS URL.");
  const response = await fetchImpl(
    new URL("/functions/v1/w3m-protocol-v1-safe-sign", base.origin),
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "apikey": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deal_id: dealId,
        safe_tx_hash: safeTransactionHash.toLowerCase(),
        signature,
      }),
    },
  );
  let body;
  try { body = await response.json(); } catch {
    throw new Error("W3M Safe SIGN endpoint returned invalid JSON.");
  }
  if (!response.ok || body?.ok !== true ||
      (body.recorded !== true && body.idempotent_replay !== true) ||
      body.required_signatures !== 2 ||
      !Number.isInteger(body.confirmations_count) ||
      body.confirmations_count < 0 || body.confirmations_count > 2 ||
      !["awaiting_signatures", "signed"].includes(body.status)) {
    throw new Error(body?.error || "W3M Safe signature was not atomically recorded.");
  }
  return {
    recorded: body.recorded === true,
    idempotentReplay: body.idempotent_replay === true,
    confirmationsCount: body.confirmations_count,
    requiredSignatures: 2,
    status: body.status,
    signerAddress,
    safeTransactionHash: safeTransactionHash.toLowerCase(),
  };
}


/**
 * Request the single atomic W3M PREPARE operation. Browser input is only the
 * deal ID; the server reloads report, deal, wallets, policy, and canonical Safe
 * facts and commits policy + release transaction + audit atomically.
 */
export async function prepareW3MSafeRelease({
  dealId,
  accessToken,
  apiKey,
  supabaseUrl,
  fetchImpl = fetch,
}) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert(typeof dealId === "string" && uuid.test(dealId), "A valid deal ID is required.");
  assert(typeof accessToken === "string" && accessToken.trim().length > 0,
    "An authenticated Supabase access token is required.");
  assert(typeof apiKey === "string" && apiKey.trim().length > 0,
    "A Supabase publishable API key is required.");
  let base;
  try { base = new URL(supabaseUrl); } catch {
    throw new Error("Supabase URL is invalid.");
  }
  assert(base.protocol === "https:" && !base.username && !base.password && !base.search && !base.hash,
    "Supabase endpoint must be a clean HTTPS URL.");
  const response = await fetchImpl(
    new URL("/functions/v1/w3m-protocol-v1-prepare-deal-release", base.origin),
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "apikey": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ deal_id: dealId }),
    },
  );
  let body;
  try { body = await response.json(); } catch {
    throw new Error("W3M PREPARE endpoint returned invalid JSON.");
  }
  const result = body?.result;
  if (!response.ok || body?.ok !== true ||
      !result || typeof result.policyId !== "string" || !uuid.test(result.policyId) ||
      typeof result.transactionId !== "string" || !uuid.test(result.transactionId) ||
      typeof result.status !== "string" || typeof result.idempotentReplay !== "boolean") {
    throw new Error(body?.error || "W3M PREPARE did not commit an atomic release transaction.");
  }
  return {
    dealId,
    policyId: result.policyId,
    transactionId: result.transactionId,
    status: result.status,
    idempotentReplay: result.idempotentReplay,
  };
}
