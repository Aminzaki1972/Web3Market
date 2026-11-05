import type { AssetTransferEvent } from "./asset-transfer-orchestrator.ts";

// NiceNIC Domain API v2 — read-only domain/account adapter.
// No registrant/contact update, domain transfer, DNS change, or paid operation is issued.

export const NICENIC_ADAPTER_VERSION = "w3m-nicenic-domain-adapter-1.0.0";
const API_URL = "https://api.nicenic.net/v2/";
const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 20;

export interface NiceNicDomainSnapshot {
  domain: string;
  accountUsername: string;
  accountHasDomain: boolean;
  accountListComplete: boolean;
  status: "active" | "expired" | "stop" | "unknown";
  hold: boolean | null;
  createdDate: string | null;
  expiredDate: string | null;
  nameservers: string[];
  registrantContactPresent: boolean;
  observedAt: string;
}

export interface NiceNicDomainOwnershipResult {
  status:
    | "SELLER_CONTROL_VERIFIED"
    | "DOMAIN_NOT_IN_ACCOUNT"
    | "DOMAIN_INACTIVE"
    | "REGISTRANT_IDENTITY_UNVERIFIED"
    | "REVIEW_REQUIRED";
  snapshot: NiceNicDomainSnapshot;
  reason?: string;
}

export class NiceNicAdapterError extends Error {
  constructor(message: string, readonly httpStatus: number | null = null) {
    super(message);
    this.name = "NiceNicAdapterError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeDomain(value: string): string {
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  if (domain.length < 3 || domain.length > 253 ||
      !/^[a-z0-9.-]+$/.test(domain) || domain.includes("..") ||
      domain.startsWith(".") || domain.endsWith(".")) {
    throw new NiceNicAdapterError("Domain name is invalid.");
  }
  return domain;
}

function apiSuccess(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload) || ![0, 200].includes(Number(payload.code)) || !isRecord(payload.data)) {
    throw new NiceNicAdapterError("NiceNIC API returned an unsuccessful or malformed response.");
  }
  return payload.data;
}

async function niceNicRequest(input: {
  username: string;
  apiSecret: string;
  query: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  if (!nonEmpty(input.username) || !nonEmpty(input.apiSecret)) {
    throw new NiceNicAdapterError("NiceNIC API username and secret are required server-side.");
  }
  const url = new URL(API_URL);
  for (const [key, value] of Object.entries(input.query)) url.searchParams.set(key, value);

  const response = await (input.fetchImpl ?? fetch)(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `${input.username}:${input.apiSecret}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new NiceNicAdapterError(`NiceNIC API request failed with HTTP ${response.status}.`, response.status);
  }
  try {
    return await response.json();
  } catch {
    throw new NiceNicAdapterError("NiceNIC API returned unreadable JSON.", response.status);
  }
}

async function fetchAccountDomainList(input: {
  username: string;
  apiSecret: string;
  fetchImpl?: typeof fetch;
  maxPages?: number;
  targetDomain: string;
}): Promise<{ found: boolean; complete: boolean }> {
  const maxPages = input.maxPages ?? DEFAULT_MAX_PAGES;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) {
    throw new NiceNicAdapterError("NiceNIC domain-list page limit is invalid.");
  }

  let totalPages = 1;
  let found = false;
  for (let page = 1; page <= Math.min(totalPages, maxPages); page += 1) {
    const payload = await niceNicRequest({
      username: input.username,
      apiSecret: input.apiSecret,
      fetchImpl: input.fetchImpl,
      query: {
        category: "domain",
        action: "domain_list",
        sort: "name_asc",
        page_size: String(PAGE_SIZE),
        page_index: String(page),
        status: "all",
      },
    });
    const data = apiSuccess(payload);
    if (!Array.isArray(data.domain_list) || !isRecord(data.options)) {
      throw new NiceNicAdapterError("NiceNIC domain-list response is missing its list or pagination metadata.");
    }
    const pages = Number(data.options.total_pages);
    if (!Number.isSafeInteger(pages) || pages < 1) {
      throw new NiceNicAdapterError("NiceNIC domain-list pagination metadata is invalid.");
    }
    totalPages = pages;
    for (const item of data.domain_list) {
      if (!isRecord(item) || !nonEmpty(item.domain)) {
        throw new NiceNicAdapterError("NiceNIC domain-list entry is malformed.");
      }
      if (normalizeDomain(item.domain) === input.targetDomain) found = true;
    }
    if (found) return { found: true, complete: true };
  }
  return { found, complete: totalPages <= maxPages };
}

export async function fetchNiceNicDomainSnapshot(input: {
  username: string;
  apiSecret: string;
  domain: string;
  fetchImpl?: typeof fetch;
  now?: string;
  maxPages?: number;
}): Promise<NiceNicDomainSnapshot> {
  const domain = normalizeDomain(input.domain);
  const observedAt = input.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(observedAt))) {
    throw new NiceNicAdapterError("NiceNIC observation timestamp is invalid.");
  }

  const [infoPayload, accountList] = await Promise.all([
    niceNicRequest({
      username: input.username,
      apiSecret: input.apiSecret,
      fetchImpl: input.fetchImpl,
      query: { category: "domain", action: "info", domain },
    }),
    fetchAccountDomainList({
      username: input.username,
      apiSecret: input.apiSecret,
      fetchImpl: input.fetchImpl,
      maxPages: input.maxPages,
      targetDomain: domain,
    }),
  ]);

  const data = apiSuccess(infoPayload);
  if (!nonEmpty(data.domain) || normalizeDomain(data.domain) !== domain) {
    throw new NiceNicAdapterError("NiceNIC domain-details response does not match the requested domain.");
  }
  const nameservers = Array.isArray(data.nameservers)
    ? data.nameservers.filter((item): item is string => nonEmpty(item)).map((item) => item.toLowerCase())
    : [];
  const rawStatus = typeof data.status === "string" ? data.status.toLowerCase() : "unknown";
  const status: NiceNicDomainSnapshot["status"] =
    rawStatus === "active" || rawStatus === "expired" || rawStatus === "stop"
      ? rawStatus
      : "unknown";
  const hold = typeof data.hold === "number"
    ? data.hold === 1
    : typeof data.hold === "string" && ["0", "1"].includes(data.hold)
      ? data.hold === "1"
      : null;

  return {
    domain,
    accountUsername: input.username,
    accountHasDomain: accountList.found,
    accountListComplete: accountList.complete,
    status,
    hold,
    createdDate: nonEmpty(data.created_date) ? data.created_date : null,
    expiredDate: nonEmpty(data.expired_date) ? data.expired_date : null,
    nameservers,
    registrantContactPresent: data.contacts !== undefined && data.contacts !== null,
    observedAt,
  };
}

export function verifyNiceNicSellerControl(
  snapshot: NiceNicDomainSnapshot,
  expected: { domain: string; sellerAccountUsername: string },
  registrantIdentityMatched: boolean,
): NiceNicDomainOwnershipResult {
  const domain = normalizeDomain(expected.domain);
  if (snapshot.domain !== domain || snapshot.accountUsername !== expected.sellerAccountUsername) {
    return { status: "REVIEW_REQUIRED", snapshot, reason: "Domain or registrar account binding mismatch." };
  }
  if (!snapshot.accountHasDomain) {
    return {
      status: snapshot.accountListComplete ? "DOMAIN_NOT_IN_ACCOUNT" : "REVIEW_REQUIRED",
      snapshot,
      reason: "The domain was not found in the connected NiceNIC account, or the account listing is incomplete.",
    };
  }
  if (snapshot.status !== "active" || snapshot.hold !== false) {
    return { status: "DOMAIN_INACTIVE", snapshot, reason: "The domain is not confirmed active and free of registrar hold." };
  }
  if (!registrantIdentityMatched) {
    return {
      status: "REGISTRANT_IDENTITY_UNVERIFIED",
      snapshot,
      reason: "Registrar account control is visible, but registrant identity has not been independently matched to the seller.",
    };
  }
  return { status: "SELLER_CONTROL_VERIFIED", snapshot };
}

// This event proves seller control only when a trusted server-side identity
// verifier has matched the registrant to the seller. It does not alter the domain.
export async function createNiceNicSellerControlEvent(input: {
  snapshot: NiceNicDomainSnapshot;
  dealId: string;
  projectId: string;
  assetId: string;
  sellerIdentity: string;
  buyerIdentity: string;
  registrantIdentityMatched: boolean;
  now: string;
}): Promise<AssetTransferEvent> {
  const result = verifyNiceNicSellerControl(
    input.snapshot,
    { domain: input.snapshot.domain, sellerAccountUsername: input.snapshot.accountUsername },
    input.registrantIdentityMatched,
  );
  const observedMs = Date.parse(input.now);
  if (result.status !== "SELLER_CONTROL_VERIFIED" ||
      input.snapshot.observedAt !== input.now ||
      !Number.isFinite(observedMs) || !nonEmpty(input.dealId) ||
      !nonEmpty(input.projectId) || !nonEmpty(input.assetId) ||
      !nonEmpty(input.sellerIdentity) || !nonEmpty(input.buyerIdentity) ||
      input.sellerIdentity === input.buyerIdentity) {
    throw new NiceNicAdapterError("NiceNIC seller-control event requires a fresh account read and verified registrant identity.");
  }

  const proof = {
    schema: "w3m-nicenic-domain-control-v1",
    domain: input.snapshot.domain,
    accountUsername: input.snapshot.accountUsername,
    status: input.snapshot.status,
    hold: input.snapshot.hold,
    createdDate: input.snapshot.createdDate,
    expiredDate: input.snapshot.expiredDate,
    nameservers: input.snapshot.nameservers,
    accountHasDomain: input.snapshot.accountHasDomain,
    registrantIdentityMatched: true,
    dealId: input.dealId,
    projectId: input.projectId,
    assetId: input.assetId,
  };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(proof)));
  const proofHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const version = `${input.snapshot.accountUsername}:${input.snapshot.expiredDate ?? "unknown"}:${input.snapshot.status}`;
  const sourceEventId = `nicenic:${input.snapshot.domain}:SELLER_CONTROL_VERIFIED:${version}`;

  return {
    eventId: sourceEventId,
    eventType: "SELLER_CONTROL_VERIFIED",
    assetId: input.assetId,
    dealId: input.dealId,
    projectId: input.projectId,
    sourceProvider: "nicenic",
    sourceRecordId: input.snapshot.domain,
    sourceVersion: version,
    sourceEventId,
    proofHash,
    observedAt: input.now,
    validUntil: new Date(observedMs + 5 * 60 * 1000).toISOString(),
    authoritative: true,
    currentOwnerIdentity: input.sellerIdentity,
  };
}
