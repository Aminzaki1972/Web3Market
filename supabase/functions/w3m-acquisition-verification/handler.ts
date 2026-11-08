import {
  buildW3MAgreementTypedData,
  verifyW3MAgreementSignature,
  type W3MAgreementTypedData,
} from "./agreement-signature.ts";
import { buildW3MAuditManifest, type PersistedAudit, type PersistedAuditFile, type PersistedAuditFinding } from "./audit-manifest.ts";
import { computeW3MAuditFingerprint, deriveW3MAuditFingerprintId } from "./audit-fingerprint.ts";
import { createW3MDealAuditBinding } from "./deal-audit-binding.ts";
import { hashW3MAcquisitionTermsV1 } from "./acquisition-terms.ts";

type W3MQuery = {
  select(columns: string): W3MQuery;
  eq(column: string, value: unknown): W3MQuery;
  order(column: string, options?: { ascending?: boolean }): W3MQuery;
  range(from: number, to: number): Promise<{ data: unknown[] | null; error: unknown }>;
  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
};

export type W3MAdminClient = {
  auth: {
    getUser(token: string): Promise<{
      data?: { user?: { id: string } | null };
      error?: unknown;
    }>;
  };
  rpc(name: string, args: Record<string, unknown>): Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
  from?(table: string): W3MQuery;
};

type ChallengeRow = {
  id: string;
  deal_id: string;
  project_id: string;
  audit_id: string;
  fingerprint_id: string;
  fingerprint_digest: string;
  binding_hash: string;
  terms_hash: string;
  terms_version: number | string;
  party_role: "buyer" | "seller";
  user_id: string;
  wallet_address: string;
  nonce: string;
  signature_deadline: number | string;
  created_at: string;
  consumed_at: string | null;
};

type HandlerDependencies = {
  createAdminClient(url: string, serviceKey: string): W3MAdminClient;
  getEnv(name: string): string | undefined;
  nowSeconds?: () => number;
  randomBytes?: (length: number) => Uint8Array;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_32 = /^[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const SIGNATURE = /^0x[0-9a-f]{130}$/i;
const ORIGINS = new Set(["https://web3market.xyz", "https://www.web3market.xyz"]);

function allowedOrigin(origin: string | null): boolean {
  if (!origin) return true;
  if (ORIGINS.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" &&
      (parsed.hostname === "web3market.pages.dev" ||
        parsed.hostname.endsWith(".web3market.pages.dev"));
  } catch {
    return false;
  }
}

function headers(origin: string | null): HeadersInit {
  const result: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
  if (origin && allowedOrigin(origin)) result["Access-Control-Allow-Origin"] = origin;
  return result;
}

function reply(origin: string | null, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

function bearerToken(value: string | null): string | null {
  const match = /^Bearer\s+(.+)$/i.exec((value || "").trim());
  return match?.[1]?.trim() || null;
}

function uuidBytes32(value: string): string {
  if (!UUID.test(value)) throw new Error("Invalid UUID in trusted challenge evidence.");
  return "0x" + value.replaceAll("-", "").toLowerCase().padStart(64, "0");
}

function typedDataFromRow(row: ChallengeRow, now: number): W3MAgreementTypedData {
  const deadline = Number(row.signature_deadline);
  if (!Number.isSafeInteger(deadline)) throw new Error("Invalid challenge deadline.");
  return buildW3MAgreementTypedData({
    dealId: uuidBytes32(row.deal_id),
    fingerprintId: uuidBytes32(row.fingerprint_id),
    fingerprintDigest: "0x" + row.fingerprint_digest,
    bindingHash: "0x" + row.binding_hash,
    termsHash: "0x" + row.terms_hash,
    termsVersion: String(row.terms_version),
    partyRole: row.party_role,
    walletAddress: row.wallet_address,
    nonce: row.nonce,
    deadline,
  }, now);
}

function challengeInput(body: Record<string, unknown>): {
  dealId: string;
  projectId: string;
  auditId: string;
  fingerprintId: string;
  fingerprintDigest: string;
  bindingHash: string;
  termsHash: string;
  termsVersion: number;
  partyRole: "buyer" | "seller";
  walletAddress: string;
} | null {
  const dealId = String(body.deal_id || "");
  const projectId = String(body.project_id || "");
  const auditId = String(body.audit_id || "");
  const fingerprintId = String(body.fingerprint_id || "");
  const fingerprintDigest = String(body.fingerprint_digest || "");
  const bindingHash = String(body.binding_hash || "");
  const termsHash = String(body.terms_hash || "");
  const termsVersionText = String(body.terms_version || "");
  const walletAddress = String(body.wallet_address || "");
  const partyRole = body.party_role;
  const termsVersion = Number(termsVersionText);
  if (
    !UUID.test(dealId) || !UUID.test(projectId) || !UUID.test(auditId) ||
    !UUID.test(fingerprintId) || !HEX_32.test(fingerprintDigest) ||
    !HEX_32.test(bindingHash) || !HEX_32.test(termsHash) ||
    !/^[1-9][0-9]*$/.test(termsVersionText) ||
    !Number.isSafeInteger(termsVersion) ||
    (partyRole !== "buyer" && partyRole !== "seller") ||
    !ADDRESS.test(walletAddress)
  ) return null;
  return {
    dealId, projectId, auditId, fingerprintId,
    fingerprintDigest: fingerprintDigest.toLowerCase(),
    bindingHash: bindingHash.toLowerCase(),
    termsHash: termsHash.toLowerCase(),
    termsVersion, partyRole, walletAddress,
  };
}

function oneChallenge(data: unknown): ChallengeRow | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row = data[0] as ChallengeRow;
  if (!row || typeof row !== "object") return null;
  return row;
}

async function loadOne<T>(
  admin: W3MAdminClient,
  table: string,
  columns: string,
  id: string,
): Promise<T | null> {
  if (!admin.from) throw new Error("Database query support is unavailable.");
  const { data, error } = await admin.from(table).select(columns).eq("id", id).maybeSingle();
  if (error) throw error;
  return data as T | null;
}

async function loadAuditRows<T>(
  admin: W3MAdminClient,
  table: string,
  columns: string,
  auditId: string,
  orderBy: string,
): Promise<T[]> {
  if (!admin.from) throw new Error("Database query support is unavailable.");
  const rows: T[] = [];
  const pageSize = 1000;
  const maximumRows = 20_000;
  for (let offset = 0; offset < maximumRows; offset += pageSize) {
    const { data, error } = await admin.from(table)
      .select(columns)
      .eq("audit_id", auditId)
      .order(orderBy, { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = Array.isArray(data) ? data as T[] : [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
  throw new Error("Audit evidence exceeds the safe manifest publication limit.");
}

async function publishFingerprintBinding(
  admin: W3MAdminClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<{ fingerprintId: string; digest: string; bindingHash: string; fileCount: number }> {
  const dealId = String(body.deal_id || "");
  const auditId = String(body.audit_id || "");
  if (!UUID.test(dealId) || !UUID.test(auditId)) {
    throw new Error("A valid deal_id and audit_id are required.");
  }

  const deal = await loadOne<{
    id: string; project_id: string; buyer_id: string; seller_id: string;
    status: string; dispute_status: string;
  }>(admin, "deals", "id,project_id,buyer_id,seller_id,status,dispute_status", dealId);
  if (!deal || deal.seller_id !== userId) {
    throw Object.assign(new Error("Caller is not the deal seller."), { status: 403 });
  }
  if (!["pending", "accepted"].includes(deal.status) || deal.dispute_status !== "none") {
    throw Object.assign(new Error("Deal is not eligible for audit binding."), { status: 409 });
  }

  const project = await loadOne<{ id: string; owner_id: string }>(
    admin, "projects", "id,owner_id", deal.project_id,
  );
  if (!project || project.owner_id !== userId) {
    throw Object.assign(new Error("Caller does not own the listed project."), { status: 403 });
  }

  const audit = await loadOne<PersistedAudit & { project_id: string | null }>(
    admin,
    "code_audits",
    "id,project_id,status,repo_owner,repo_name,commit_sha,engine_version,audit_type,files_scanned,lines_scanned,overall_score,security_score,architecture_score,code_quality_score,dependency_score,testing_score,documentation_score,web3_score,scalability_score,ai_fit_score,risk_level,summary",
    auditId,
  );
  if (!audit || audit.project_id !== deal.project_id || audit.status !== "completed") {
    throw Object.assign(new Error("Completed audit does not belong to this marketplace project."), { status: 409 });
  }

  const [files, findings] = await Promise.all([
    loadAuditRows<PersistedAuditFile>(
      admin, "code_audit_files",
      "path,sha,language,size_bytes,line_count,selected_tier,scanned",
      auditId, "path",
    ),
    loadAuditRows<PersistedAuditFinding>(
      admin, "code_audit_findings",
      "severity,category,title,status,file_path,line_start,line_end,evidence,description,recommendation,confidence",
      auditId, "title",
    ),
  ]);

  const manifest = buildW3MAuditManifest(audit, files, findings);
  const repository = String(audit.repo_owner) + "/" + String(audit.repo_name);
  const commitSha = String(audit.commit_sha);
  const fingerprint = await computeW3MAuditFingerprint({
    auditId: audit.id,
    repository,
    commitSha,
    schemaVersion: "w3m.persisted-audit-manifest.v1",
    manifest,
  });
  const fingerprintId = await deriveW3MAuditFingerprintId(audit.id);
  const binding = await createW3MDealAuditBinding({
    dealId,
    projectId: deal.project_id,
    auditId: audit.id,
    fingerprintId,
    fingerprintDigest: fingerprint.digest,
    repository,
    commitSha,
  });

  const { data, error } = await admin.rpc("w3m_publish_audit_fingerprint_and_binding", {
    p_deal_id: dealId,
    p_project_id: deal.project_id,
    p_audit_id: audit.id,
    p_fingerprint_id: fingerprintId,
    p_user_id: userId,
    p_repository: repository.toLowerCase(),
    p_commit_sha: commitSha.toLowerCase(),
    p_fingerprint_digest: fingerprint.digest,
    p_manifest: manifest,
    p_binding_hash: binding.binding_hash,
  });
  if (error) {
    const status = rpcStatus(error);
    throw Object.assign(new Error("Trusted fingerprint publication was rejected."), { status });
  }
  if (!Array.isArray(data) || data.length !== 1 ||
    data[0]?.fingerprint_id !== fingerprintId ||
    data[0]?.binding_hash !== binding.binding_hash) {
    throw new Error("Fingerprint and deal binding persistence could not be confirmed.");
  }
  return {
    fingerprintId,
    digest: fingerprint.digest,
    bindingHash: binding.binding_hash,
    fileCount: files.filter((file) => file.scanned === true).length,
  };
}


async function publishAcquisitionTerms(
  admin: W3MAdminClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<{ termsVersion: number; termsHash: string; termsRecordId: string }> {
  const dealId = String(body.deal_id || "");
  const terms = body.terms;
  if (!UUID.test(dealId) || !terms || typeof terms !== "object" || Array.isArray(terms)) {
    throw Object.assign(new Error("A valid deal_id and terms object are required."), { status: 400 });
  }

  const deal = await loadOne<{
    id: string; project_id: string; buyer_id: string; seller_id: string;
    status: string; dispute_status: string;
  }>(admin, "deals", "id,project_id,buyer_id,seller_id,status,dispute_status", dealId);
  if (!deal || deal.seller_id !== userId) {
    throw Object.assign(new Error("Caller is not the deal seller."), { status: 403 });
  }
  if (!["pending", "accepted"].includes(deal.status) || deal.dispute_status !== "none") {
    throw Object.assign(new Error("Deal is not eligible for terms publication."), { status: 409 });
  }

  const termsRecord = terms as Record<string, unknown>;
  const termsDeal = termsRecord.deal as Record<string, unknown> | undefined;
  if (!termsDeal || termsDeal.deal_id !== deal.id ||
    termsDeal.project_id !== deal.project_id ||
    termsDeal.buyer_id !== deal.buyer_id ||
    termsDeal.seller_id !== deal.seller_id) {
    throw Object.assign(new Error("Terms do not match the authenticated deal context."), { status: 409 });
  }
  const termsVersion = termsRecord.terms_version;
  if (!Number.isSafeInteger(termsVersion) || Number(termsVersion) < 1) {
    throw Object.assign(new Error("A positive integer terms_version is required."), { status: 400 });
  }

  const termsHash = await hashW3MAcquisitionTermsV1(terms);
  const { data, error } = await admin.rpc("w3m_publish_acquisition_terms_version", {
    p_deal_id: deal.id,
    p_terms_version: Number(termsVersion),
    p_terms_hash: termsHash,
    p_canonical_terms_json: terms,
  });
  if (error) {
    const status = rpcStatus(error);
    throw Object.assign(new Error("Trusted acquisition terms publication was rejected."), { status });
  }
  if (typeof data !== "string" || !UUID.test(data)) {
    throw new Error("Acquisition terms persistence could not be confirmed.");
  }

  const transferScope = termsRecord.transfer_scope as Record<string, unknown> | undefined;
  const includedAssets = transferScope?.included_assets;
  if (!Array.isArray(includedAssets) || includedAssets.length === 0) {
    throw Object.assign(new Error("At least one individually listed included asset is required."), { status: 400 });
  }
  const { data: syncedAssetCount, error: syncError } = await admin.rpc(
    "w3m_sync_deal_assets_from_published_terms",
    { p_deal_id: deal.id },
  );
  if (syncError || Number(syncedAssetCount) !== includedAssets.length) {
    const status = syncError ? rpcStatus(syncError) : 409;
    throw Object.assign(
      new Error("Published included assets could not be synchronized with the per-asset delivery checklist."),
      { status },
    );
  }
  return { termsVersion: Number(termsVersion), termsHash, termsRecordId: data };
}

async function prepareAgreement(
  admin: W3MAdminClient,
  userId: string,
  body: Record<string, unknown>,
  now: number,
  randomBytes: (length: number) => Uint8Array,
): Promise<Record<string, unknown>> {
  const dealId = String(body.deal_id || "");
  const requestedWallet = String(body.wallet_address || "");
  if (!UUID.test(dealId) || !ADDRESS.test(requestedWallet)) {
    throw Object.assign(new Error("A valid deal_id and connected wallet are required."), { status: 400 });
  }
  const deal = await loadOne<{
    id: string; project_id: string; buyer_id: string; seller_id: string;
    status: string; dispute_status: string;
  }>(admin, "deals", "id,project_id,buyer_id,seller_id,status,dispute_status", dealId);
  if (!deal) throw Object.assign(new Error("Deal was not found."), { status: 404 });
  const partyRole = deal.buyer_id === userId ? "buyer" : deal.seller_id === userId ? "seller" : null;
  if (!partyRole) throw Object.assign(new Error("Only a deal participant can prepare its agreement."), { status: 403 });
  if (!deal.status || !["pending", "accepted"].includes(deal.status) || deal.dispute_status !== "none") {
    throw Object.assign(new Error("Deal is not eligible for agreement acceptance."), { status: 409 });
  }

  const profile = await loadOne<{ id: string; wallet_address: string | null; wallet_verified: boolean }>(
    admin, "profiles", "id,wallet_address,wallet_verified", userId,
  );
  const walletAddress = String(profile?.wallet_address || "");
  if (!profile || profile.wallet_verified !== true || !ADDRESS.test(walletAddress) ||
    walletAddress.toLowerCase() !== requestedWallet.toLowerCase()) {
    throw Object.assign(new Error("Connected wallet does not match the verified profile wallet."), { status: 403 });
  }

  const { data: contextData, error: contextError } = await admin.rpc(
    "w3m_get_deal_agreement_context",
    { p_deal_id: dealId },
  );
  if (contextError) throw contextError;
  const context = contextData && typeof contextData === "object" && !Array.isArray(contextData)
    ? contextData as Record<string, unknown> : {};
  const binding = context.binding as {
    deal_id: string; project_id: string; audit_id: string; fingerprint_id: string;
    fingerprint_digest: string; repository: string; commit_sha: string; binding_hash: string;
  } | null;
  if (!binding || binding.project_id !== deal.project_id || binding.deal_id !== dealId) {
    throw Object.assign(new Error("Immutable deal audit binding is not available."), { status: 409 });
  }

  const terms = context.terms as {
    id: string; terms_version: number | string; terms_hash: string;
    canonical_terms_json: Record<string, unknown>; status: string;
  } | null;
  if (!terms || terms.status !== "published") {
    throw Object.assign(new Error("No published V1 acquisition terms exist for this deal."), { status: 409 });
  }
  const version = Number(terms.terms_version);
  if (!Number.isSafeInteger(version) || version < 1 ||
    Number(terms.canonical_terms_json?.terms_version) !== version ||
    terms.canonical_terms_json?.deal === undefined ||
    terms.canonical_terms_json?.audit === undefined) {
    throw Object.assign(new Error("Published terms record is malformed."), { status: 409 });
  }
  const computedTermsHash = await hashW3MAcquisitionTermsV1(terms.canonical_terms_json);
  if (computedTermsHash !== terms.terms_hash ||
    String((terms.canonical_terms_json.audit as Record<string, unknown>).audit_id).toLowerCase() !== binding.audit_id.toLowerCase() ||
    String((terms.canonical_terms_json.audit as Record<string, unknown>).fingerprint_digest).toLowerCase() !== binding.fingerprint_digest.toLowerCase() ||
    String((terms.canonical_terms_json.audit as Record<string, unknown>).repository).toLowerCase() !== binding.repository.toLowerCase() ||
    String((terms.canonical_terms_json.audit as Record<string, unknown>).commit_sha).toLowerCase() !== binding.commit_sha.toLowerCase()) {
    throw Object.assign(new Error("Published terms hash or audit evidence does not match trusted records."), { status: 409 });
  }

  const random = randomBytes(32);
  if (!(random instanceof Uint8Array) || random.length !== 32) {
    throw new Error("Secure nonce generation failed.");
  }
  const nonce = "0x" + Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const deadline = now + 600;
  const { data: challengeId, error: issueError } = await admin.rpc("w3m_issue_agreement_challenge", {
    p_deal_id: deal.id,
    p_project_id: deal.project_id,
    p_audit_id: binding.audit_id,
    p_fingerprint_id: binding.fingerprint_id,
    p_fingerprint_digest: binding.fingerprint_digest,
    p_binding_hash: binding.binding_hash,
    p_terms_hash: terms.terms_hash,
    p_terms_version: version,
    p_party_role: partyRole,
    p_user_id: userId,
    p_wallet_address: walletAddress,
    p_nonce: nonce,
    p_signature_deadline: deadline,
  });
  if (issueError) throw Object.assign(new Error("Agreement challenge issuance was rejected."), { status: rpcStatus(issueError) });
  if (typeof challengeId !== "string" || !UUID.test(challengeId)) {
    throw new Error("Agreement challenge persistence could not be confirmed.");
  }
  const { data: challengeData, error: readError } = await admin.rpc(
    "w3m_get_agreement_challenge_for_verification", { p_challenge_id: challengeId },
  );
  if (readError) throw readError;
  const row = oneChallenge(challengeData);
  if (!row || row.user_id !== userId || row.deal_id.toLowerCase() !== dealId.toLowerCase() ||
    row.project_id.toLowerCase() !== deal.project_id.toLowerCase() ||
    row.audit_id.toLowerCase() !== binding.audit_id.toLowerCase() ||
    row.fingerprint_id.toLowerCase() !== binding.fingerprint_id.toLowerCase() ||
    row.fingerprint_digest.toLowerCase() !== binding.fingerprint_digest.toLowerCase() ||
    row.binding_hash.toLowerCase() !== binding.binding_hash.toLowerCase() ||
    row.party_role !== partyRole ||
    row.wallet_address.toLowerCase() !== walletAddress.toLowerCase() || row.nonce !== nonce ||
    row.terms_hash.toLowerCase() !== terms.terms_hash.toLowerCase() ||
    Number(row.terms_version) !== version ||
    Number(row.signature_deadline) !== deadline || row.consumed_at !== null) {
    throw new Error("Persisted challenge does not match trusted preparation context.");
  }
  return {
    dealId: deal.id,
    partyRole,
    partyId: userId,
    walletAddress,
    fingerprintId: binding.fingerprint_id,
    fingerprintDigest: binding.fingerprint_digest,
    bindingHash: binding.binding_hash,
    termsHash: terms.terms_hash,
    termsVersion: String(version),
    termsVersionId: terms.id,
    challengeId,
    typedData: typedDataFromRow(row, now),
  };
}

async function getAgreementStatus(
  admin: W3MAdminClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const dealId = String(body.deal_id || "");
  if (!UUID.test(dealId)) {
    throw Object.assign(new Error("A valid deal_id is required."), { status: 400 });
  }
  const deal = await loadOne<{
    id: string; buyer_id: string; seller_id: string; project_id: string;
    status: string; dispute_status: string;
  }>(admin, "deals", "id,buyer_id,seller_id,project_id,status,dispute_status", dealId);
  if (!deal) throw Object.assign(new Error("Deal was not found."), { status: 404 });
  if (deal.buyer_id !== userId && deal.seller_id !== userId) {
    throw Object.assign(new Error("Only deal participants can view agreement status."), { status: 403 });
  }

  const { data: contextData, error: contextError } = await admin.rpc(
    "w3m_get_deal_agreement_context",
    { p_deal_id: dealId },
  );
  if (contextError) throw contextError;
  const context = contextData && typeof contextData === "object" && !Array.isArray(contextData)
    ? contextData as Record<string, unknown> : {};
  const terms = context.terms as {
    id: string; terms_version: number | string; terms_hash: string;
    canonical_terms_json: Record<string, unknown>; status: string; published_at: string;
  } | null;
  const acceptanceRows = Array.isArray(context.acceptances)
    ? context.acceptances as Array<Record<string, unknown>> : [];

  if (terms) {
    const computedHash = await hashW3MAcquisitionTermsV1(terms.canonical_terms_json);
    if (computedHash !== terms.terms_hash ||
      String(terms.canonical_terms_json?.deal && (terms.canonical_terms_json.deal as Record<string, unknown>).deal_id) !== dealId) {
      throw Object.assign(new Error("Published terms integrity check failed."), { status: 409 });
    }
  }

  const readAcceptance = async (role: "buyer" | "seller", expectedUserId: string) => {
    const roleRows = acceptanceRows.filter((item) => item.party_role === role);
    const current = roleRows.find((row) =>
      row.user_id === expectedUserId &&
      row.terms_hash === terms?.terms_hash &&
      String(row.terms_version) === String(terms?.terms_version)
    ) as {
      party_role: string; user_id: string; terms_version: number | string;
      terms_hash: string; accepted_at: string;
    } | undefined;
    if (current) return { accepted: true, accepted_at: current.accepted_at };
    // Historical acceptance for an older terms version must never shadow a
    // matching current acceptance, regardless of aggregate row order.
    return roleRows.length ? { accepted: false, stale: true } : { accepted: false };
  };

  const [buyer, seller] = await Promise.all([
    readAcceptance("buyer", deal.buyer_id), readAcceptance("seller", deal.seller_id),
  ]);

  // Read the private append-only evidence through its service-role-only
  // SECURITY DEFINER RPC. The event table itself intentionally grants no
  // direct SELECT privilege, including to service_role.
  const { data: deliveryEvidence, error: deliveryError } = await admin.rpc(
    "w3m_get_deal_asset_finalization_evidence",
    { p_deal_id: dealId },
  );
  if (deliveryError) throw deliveryError;
  const deliveryRows = Array.isArray(deliveryEvidence) ? deliveryEvidence : [];
  const deliveryRow = deliveryRows[0] as Record<string, unknown> | undefined;
  const rawAssets = Array.isArray(deliveryRow?.asset_rows) ? deliveryRow.asset_rows : [];
  const assets = rawAssets.map((raw) => {
    const asset = raw as Record<string, unknown>;
    return {
      asset_id: asset.asset_id,
      asset_name: asset.asset_name,
      status: asset.status,
      delivery_url: asset.delivery_url,
      delivered_by: asset.delivered_by,
      delivered_at: asset.delivered_at,
      accepted_by: asset.accepted_by,
      accepted_at: asset.accepted_at,
      events: Array.isArray(asset.events) ? asset.events : [],
    };
  });

  const { data: finalConfirmationData, error: finalConfirmationError } = await admin.rpc(
    "w3m_get_deal_delivery_confirmation_status",
    { p_deal_id: dealId },
  );
  if (finalConfirmationError) throw finalConfirmationError;
  const finalConfirmation = finalConfirmationData && typeof finalConfirmationData === "object" &&
    !Array.isArray(finalConfirmationData)
    ? finalConfirmationData as Record<string, unknown> : null;
  if (!finalConfirmation || typeof finalConfirmation.confirmed !== "boolean" ||
      typeof finalConfirmation.stale !== "boolean") {
    throw Object.assign(new Error("Final delivery confirmation status is malformed."), { status: 503 });
  }

  return {
    deal_id: deal.id,
    viewer_role: deal.buyer_id === userId ? "buyer" : "seller",
    current_terms: terms ? {
      terms_version: String(terms.terms_version),
      terms_hash: terms.terms_hash,
      published_at: terms.published_at,
      canonical_terms: terms.canonical_terms_json,
    } : null,
    acceptances: { buyer, seller },
    assets,
    final_delivery_confirmation: finalConfirmation,
    both_accepted: buyer.accepted === true && seller.accepted === true,
    deal_eligible: ["pending", "accepted"].includes(deal.status) && deal.dispute_status === "none",
  };
}


async function confirmDealDelivery(
  admin: W3MAdminClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const dealId = String(body.deal_id || "");
  if (!UUID.test(dealId)) {
    throw Object.assign(new Error("A valid deal_id is required."), { status: 400 });
  }
  const deal = await loadOne<{ id: string; buyer_id: string; seller_id: string }>(
    admin, "deals", "id,buyer_id,seller_id", dealId,
  );
  if (!deal) throw Object.assign(new Error("Deal was not found."), { status: 404 });
  if (deal.buyer_id !== userId) {
    throw Object.assign(new Error("Only the buyer can confirm final delivery."), { status: 403 });
  }

  const { data, error } = await admin.rpc("w3m_confirm_deal_delivery_v1", {
    p_deal_id: dealId,
    p_buyer_user_id: userId,
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row || !UUID.test(String(row.confirmation_id || "")) ||
      !/^[1-9][0-9]*$/.test(String(row.terms_version || "")) ||
      !/^[0-9a-f]{64}$/.test(String(row.terms_hash || "")) ||
      !/^[0-9a-f]{64}$/.test(String(row.asset_set_digest || "")) ||
      !Number.isSafeInteger(Number(row.asset_count)) || Number(row.asset_count) < 1 ||
      typeof row.confirmed_at !== "string" || typeof row.created !== "boolean") {
    throw Object.assign(new Error("Final delivery confirmation RPC returned an invalid record."), { status: 503 });
  }
  return {
    confirmation_id: row.confirmation_id,
    terms_version: String(row.terms_version),
    terms_hash: row.terms_hash,
    asset_set_digest: row.asset_set_digest,
    asset_count: Number(row.asset_count),
    confirmed_at: row.confirmed_at,
    created: row.created === true,
  };
}


async function transitionDealAsset(
  admin: W3MAdminClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const dealId = String(body.deal_id || "");
  const assetId = String(body.asset_id || "");
  const action = body.asset_action;
  if (!UUID.test(dealId) || !UUID.test(assetId) ||
      (action !== "deliver" && action !== "accept" && action !== "reject")) {
    throw Object.assign(new Error("Invalid asset transition request."), { status: 400 });
  }
  let deliveryUrl: string | null = null;
  let evidence: string | null = null;
  if (action === "deliver") {
    deliveryUrl = String(body.delivery_url || "");
    evidence = String(body.evidence || "");
    let parsed: URL;
    try { parsed = new URL(deliveryUrl); } catch {
      throw Object.assign(new Error("A valid HTTPS delivery URL is required."), { status: 400 });
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
        deliveryUrl.length > 2048 || !evidence.trim() || evidence.length > 16000) {
      throw Object.assign(new Error("Delivery requires an HTTPS reference and bounded non-empty evidence."), { status: 400 });
    }
  } else if (body.delivery_url !== undefined || body.evidence !== undefined) {
    throw Object.assign(new Error("Buyer response cannot include delivery evidence fields."), { status: 400 });
  }
  const { data, error } = await admin.rpc("w3m_transition_deal_asset_v1", {
    p_deal_id: dealId,
    p_asset_id: assetId,
    p_actor_user_id: userId,
    p_action: action,
    p_delivery_url: deliveryUrl,
    p_evidence: evidence,
  });
  if (error) {
    const status = rpcStatus(error);
    throw Object.assign(new Error("Per-asset transition was rejected."), { status });
  }
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      (data as Record<string, unknown>).asset_id !== assetId ||
      (data as Record<string, unknown>).status !== (action === "deliver" ? "delivered" : action === "accept" ? "accepted" : "rejected")) {
    throw Object.assign(new Error("Per-asset transition persistence could not be confirmed."), { status: 503 });
  }
  return data as Record<string, unknown>;
}

function rpcStatus(error: { code?: string; message?: string } | null): number {
  const code = error?.code || "";
  if (code === "42501") return 403;
  if (code === "22023" || code === "23503" || code === "23505" || code === "P0002" || code === "55000") return 409;
  return 500;
}

export function createW3MAcquisitionHandler(deps: HandlerDependencies) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("Origin");
    if (!allowedOrigin(origin)) return reply(null, { ok: false, error: "Origin not allowed" }, 403);
    if (req.method === "OPTIONS") return new Response("ok", { status: 204, headers: headers(origin) });
    if (req.method !== "POST") return reply(origin, { ok: false, error: "POST required" }, 405);
    const token = bearerToken(req.headers.get("Authorization"));
    if (!token) return reply(origin, { ok: false, error: "Sign in required" }, 401);
    let body: Record<string, unknown>;
    try {
      const rawBody = await req.text();
      if (new TextEncoder().encode(rawBody).byteLength > 16_384) {
        return reply(origin, { ok: false, error: "Request too large" }, 413);
      }
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return reply(origin, { ok: false, error: "JSON object required" }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return reply(origin, { ok: false, error: "Valid JSON body required" }, 400);
    }

    const url = deps.getEnv("SUPABASE_URL");
    const serviceKey = deps.getEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) {
      return reply(origin, { ok: false, error: "W3M verification service is not configured" }, 503);
    }

    try {
      const admin = deps.createAdminClient(url, serviceKey);
      const { data: authData, error: authError } = await admin.auth.getUser(token);
      const user = authData?.user;
      if (authError || !user?.id) return reply(origin, { ok: false, error: "Unauthorized" }, 401);

      const now = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
      if (!Number.isSafeInteger(now) || now < 0) {
        return reply(origin, { ok: false, error: "Verification clock unavailable" }, 503);
      }

      if (body.action === "asset_transition") {
        try {
          const result = await transitionDealAsset(admin, user.id, body);
          return reply(origin, { ok: true, result });
        } catch (error) {
          const status = typeof (error as { status?: unknown })?.status === "number"
            ? (error as { status: number }).status : 500;
          if (status >= 500) console.error("w3m asset transition failed", error instanceof Error ? error.message : "unknown error");
          return reply(origin, { ok: false, error: status === 400 ? "Invalid asset transition request" :
            status === 403 ? "Only the authorized deal participant can perform this action" :
              status === 404 ? "Deal asset not found" : status === 409 ? "Asset transition is not currently allowed" :
                "Unable to record asset transition" }, status);
        }
      }

      if (body.action === "confirm_delivery") {
        try {
          const result = await confirmDealDelivery(admin, user.id, body);
          return reply(origin, { ok: true, result });
        } catch (error) {
          const status = typeof (error as { status?: unknown })?.status === "number"
            ? (error as { status: number }).status : rpcStatus(error as { code?: string; message?: string } | null);
          if (status >= 500) console.error("w3m final delivery confirmation failed", error instanceof Error ? error.message : "unknown error");
          return reply(origin, { ok: false, error: status === 400 ? "Invalid final delivery confirmation request" :
            status === 403 ? "Only the buyer can confirm final delivery" :
              status === 404 ? "Deal not found" : status === 409 ? "All included assets must be accepted and the deal must be eligible" :
                "Unable to record final delivery confirmation" }, status);
        }
      }

      if (body.action === "status") {
        try {
          const status = await getAgreementStatus(admin, user.id, body);
          return reply(origin, { ok: true, result: status });
        } catch (error) {
          const status = typeof (error as { status?: unknown })?.status === "number"
            ? (error as { status: number }).status : 500;
          if (status >= 500) console.error("w3m agreement status failed", error instanceof Error ? error.message : "unknown error");
          return reply(origin, { ok: false, error: status === 400 ? "Invalid agreement status request" :
            status === 403 ? "Only deal participants can view agreement status" :
              status === 404 ? "Deal not found" : "Unable to load agreement status" }, status);
        }
      }

      if (body.action === "prepare") {
        try {
          const prepared = await prepareAgreement(
            admin, user.id, body, now,
            deps.randomBytes || ((length) => crypto.getRandomValues(new Uint8Array(length))),
          );
          return reply(origin, { ok: true, result: prepared });
        } catch (error) {
          const status = typeof (error as { status?: unknown })?.status === "number"
            ? (error as { status: number }).status : 500;
          if (status >= 500) console.error("w3m agreement preparation failed", error instanceof Error ? error.message : "unknown error");
          return reply(origin, { ok: false, error: status === 400 ? "Invalid agreement preparation request" :
            status === 403 ? "Only the verified deal participant wallet can prepare acceptance" :
              status === 404 ? "Deal not found" : status === 409 ? "Deal, audit binding, or published terms are not eligible" :
                "Unable to prepare agreement acceptance" }, status);
        }
      }

      if (body.action === "publish_fingerprint_binding") {
        try {
          const published = await publishFingerprintBinding(admin, user.id, body);
          return reply(origin, {
            ok: true,
            audit_id: String(body.audit_id),
            fingerprint_id: published.fingerprintId,
            fingerprint_digest: published.digest,
            binding_hash: published.bindingHash,
            files_fingerprinted: published.fileCount,
          }, 201);
        } catch (error) {
          const status = typeof (error as { status?: unknown })?.status === "number"
            ? (error as { status: number }).status : 500;
          if (status >= 500) {
            console.error("w3m fingerprint publication failed", error instanceof Error ? error.message : "unknown error");
          }
          return reply(origin, {
            ok: false,
            error: status === 403 ? "Only the verified project seller can bind this audit" :
              status === 409 ? "Deal, project, or completed audit is not eligible for binding" :
                "Unable to publish trusted audit fingerprint",
          }, status);
        }
      }


      if (body.action === "publish_terms") {
        try {
          const published = await publishAcquisitionTerms(admin, user.id, body);
          return reply(origin, {
            ok: true,
            deal_id: String(body.deal_id),
            terms_version: published.termsVersion,
            terms_hash: published.termsHash,
            terms_record_id: published.termsRecordId,
          }, 201);
        } catch (error) {
          const status = typeof (error as { status?: unknown })?.status === "number"
            ? (error as { status: number }).status : 500;
          if (status >= 500) {
            console.error("w3m acquisition terms publication failed", error instanceof Error ? error.message : "unknown error");
          }
          return reply(origin, {
            ok: false,
            error: status === 400 ? "Invalid acquisition terms payload" :
              status === 403 ? "Only the deal seller can publish acquisition terms" :
                status === 409 ? "Deal or terms are not eligible for publication" :
                  "Unable to publish acquisition terms",
          }, status);
        }
      }

      // V1 accepts agreement preparation only from trusted server-side deal,
      // verified-wallet, immutable audit-binding, and published-terms records.
      // The legacy caller-supplied challenge action is intentionally retired.
      if (body.action === "challenge") {
        return reply(origin, { ok: false, error: "Legacy challenge action retired; use prepare" }, 410);
      }

      if (body.action === "accept") {
        const challengeId = String(body.challenge_id || "");
        const signature = String(body.signature || "");
        if (!UUID.test(challengeId) || !SIGNATURE.test(signature)) {
          return reply(origin, { ok: false, error: "Valid challenge_id and 65-byte signature are required" }, 400);
        }
        const { data: challengeData, error: readError } = await admin.rpc(
          "w3m_get_agreement_challenge_for_verification",
          { p_challenge_id: challengeId },
        );
        if (readError) throw readError;
        const row = oneChallenge(challengeData);
        if (!row) return reply(origin, { ok: false, error: "Agreement challenge not found" }, 404);
        if (row.user_id !== user.id) return reply(origin, { ok: false, error: "Challenge belongs to another account" }, 403);
        if (row.consumed_at !== null) return reply(origin, { ok: false, error: "Challenge has already been used" }, 409);

        let verified: ReturnType<typeof verifyW3MAgreementSignature>;
        try {
          const typedData = typedDataFromRow(row, now);
          verified = verifyW3MAgreementSignature({
            dealId: typedData.message.dealId,
            fingerprintId: typedData.message.fingerprintId,
            fingerprintDigest: typedData.message.fingerprintDigest,
            bindingHash: typedData.message.bindingHash,
            termsHash: typedData.message.termsHash,
            termsVersion: typedData.message.termsVersion,
            partyRole: row.party_role,
            walletAddress: row.wallet_address,
            nonce: typedData.message.nonce,
            deadline: Number(typedData.message.deadline),
          }, signature, now);
        } catch {
          return reply(origin, { ok: false, error: "Agreement signature is invalid, expired, or from the wrong wallet" }, 422);
        }

        const { data: acceptanceId, error: acceptError } = await admin.rpc(
          "w3m_record_agreement_acceptance",
          {
            p_challenge_id: challengeId,
            p_user_id: user.id,
            p_party_role: row.party_role,
            p_wallet_address: row.wallet_address,
            p_recovered_signer: verified.recoveredAddress,
            p_signature: signature,
            p_accepted_at: new Date(now * 1000).toISOString(),
          },
        );
        if (acceptError) {
          const status = rpcStatus(acceptError);
          return reply(origin, {
            ok: false,
            error: status === 403 ? "Deal, wallet, or participant state changed" :
              status === 409 ? "Challenge expired, was consumed, or its terms are no longer current" :
                "Unable to record agreement acceptance",
          }, status);
        }
        if (typeof acceptanceId !== "string" || !UUID.test(acceptanceId)) {
          return reply(origin, { ok: false, error: "Acceptance persistence could not be confirmed" }, 503);
        }
        return reply(origin, {
          ok: true,
          acceptance_id: acceptanceId,
          result: {
            dealId: row.deal_id,
            partyRole: row.party_role,
            termsVersion: String(row.terms_version),
            acceptanceId,
            idempotentReplay: false,
          },
        });
      }

      return reply(origin, { ok: false, error: "Unknown action" }, 400);
    } catch (error) {
      console.error("w3m-acquisition-verification failed", error instanceof Error ? error.message : "unknown error");
      return reply(origin, { ok: false, error: "W3M verification request failed" }, 500);
    }
  };
}
