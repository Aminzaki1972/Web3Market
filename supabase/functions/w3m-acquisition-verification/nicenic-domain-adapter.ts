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

export interface NiceNicDomainMembership {
  domain: string;
  accountUsername: string;
  accountHasDomain: boolean;
  accountListComplete: boolean;
  status: NiceNicDomainSnapshot["status"];
  hold: boolean | null;
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
}): Promise<{ found: boolean; complete: boolean; status: NiceNicDomainSnapshot["status"]; hold: boolean | null }> {
  const maxPages = input.maxPages ?? DEFAULT_MAX_PAGES;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) {
    throw new NiceNicAdapterError("NiceNIC domain-list page limit is invalid.");
  }

  let totalPages = 1;
  let matched: Record<string, unknown> | null = null;
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
      if (normalizeDomain(item.domain) === input.targetDomain) matched = item;
    }
    if (matched) {
      const rawStatus = typeof matched.status === "string" ? matched.status.toLowerCase() : "unknown";
      const status: NiceNicDomainSnapshot["status"] =
        rawStatus === "active" || rawStatus === "expired" || rawStatus === "stop"
          ? rawStatus
          : "unknown";
      const hold = typeof matched.hold === "number"
        ? matched.hold === 1
        : typeof matched.hold === "string" && ["0", "1"].includes(matched.hold)
          ? matched.hold === "1"
          : null;
      return { found: true, complete: true, status, hold };
    }
  }
  return { found: false, complete: totalPages <= maxPages, status: "unknown", hold: null };
}

export async function fetchNiceNicAccountDomainMembership(input: {
  username: string;
  apiSecret: string;
  domain: string;
  fetchImpl?: typeof fetch;
  now?: string;
  maxPages?: number;
}): Promise<NiceNicDomainMembership> {
  const domain = normalizeDomain(input.domain);
  const observedAt = input.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(observedAt))) {
    throw new NiceNicAdapterError("NiceNIC observation timestamp is invalid.");
  }
  const accountList = await fetchAccountDomainList({
    username: input.username,
    apiSecret: input.apiSecret,
    fetchImpl: input.fetchImpl,
    maxPages: input.maxPages,
    targetDomain: domain,
  });
  return {
    domain,
    accountUsername: input.username,
    accountHasDomain: accountList.found,
    accountListComplete: accountList.complete,
    status: accountList.status,
    hold: accountList.hold,
    observedAt,
  };
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

  const [infoPayload, membership] = await Promise.all([
    niceNicRequest({
      username: input.username,
      apiSecret: input.apiSecret,
      fetchImpl: input.fetchImpl,
      query: { category: "domain", action: "info", domain },
    }),
    fetchNiceNicAccountDomainMembership({
      username: input.username,
      apiSecret: input.apiSecret,
      fetchImpl: input.fetchImpl,
      maxPages: input.maxPages,
      domain,
      now: observedAt,
    }),
  ]);

  const data = apiSuccess(infoPayload);
  if (!nonEmpty(data.domain) || normalizeDomain(data.domain) !== domain) {
    throw new NiceNicAdapterError("NiceNIC domain-details response does not match the requested domain.");
  }
  const nameservers = Array.isArray(data.nameservers)
    ? data.nameservers.filter((item): item is string => nonEmpty(item)).map((item) => item.toLowerCase())
    : [];
  return {
    domain,
    accountUsername: input.username,
    accountHasDomain: membership.accountHasDomain,
    accountListComplete: membership.accountListComplete,
    status: membership.status,
    hold: membership.hold,
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
  if (!snapshot.registrantContactPresent || !registrantIdentityMatched) {
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
  expectedDomain: string;
  expectedSellerAccountUsername: string;
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
    { domain: input.expectedDomain, sellerAccountUsername: input.expectedSellerAccountUsername },
    input.registrantIdentityMatched,
  );
  const observedMs = Date.parse(input.now);
  if (result.status !== "SELLER_CONTROL_VERIFIED" ||
      input.snapshot.observedAt !== input.now ||
      input.snapshot.domain !== normalizeDomain(input.expectedDomain) ||
      input.snapshot.accountUsername !== input.expectedSellerAccountUsername ||
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
    expectedSellerAccountUsername: input.expectedSellerAccountUsername,
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


// Confirms account-level transfer only when a complete seller-account listing no
// longer contains the domain and a fresh buyer-account read contains it, with a
// separately trusted registrant identity match. It does not initiate a transfer.
export async function createNiceNicTransferConfirmedEvent(input: {
  sellerMembership: NiceNicDomainMembership;
  buyerSnapshot: NiceNicDomainSnapshot;
  expectedDomain: string;
  expectedSellerAccountUsername: string;
  expectedBuyerAccountUsername: string;
  dealId: string;
  projectId: string;
  assetId: string;
  sellerIdentity: string;
  buyerIdentity: string;
  buyerRegistrantIdentityMatched: boolean;
  now: string;
}): Promise<AssetTransferEvent> {
  const seller = input.sellerMembership;
  const buyer = input.buyerSnapshot;
  const observedMs = Date.parse(input.now);
  if (
    seller.domain !== buyer.domain ||
    seller.domain !== normalizeDomain(input.expectedDomain) ||
    seller.accountUsername !== input.expectedSellerAccountUsername ||
    buyer.accountUsername !== input.expectedBuyerAccountUsername ||
    seller.accountHasDomain ||
    !seller.accountListComplete ||
    !buyer.accountHasDomain ||
    buyer.status !== "active" ||
    buyer.hold !== false ||
    !buyer.registrantContactPresent ||
    !input.buyerRegistrantIdentityMatched ||
    seller.observedAt !== input.now ||
    buyer.observedAt !== input.now ||
    !Number.isFinite(observedMs) ||
    !nonEmpty(input.dealId) ||
    !nonEmpty(input.projectId) ||
    !nonEmpty(input.assetId) ||
    !nonEmpty(input.sellerIdentity) ||
    !nonEmpty(input.buyerIdentity) ||
    input.sellerIdentity === input.buyerIdentity
  ) {
    throw new NiceNicAdapterError("NiceNIC transfer confirmation requires complete seller-account absence and fresh buyer-account plus registrant verification.");
  }

  const proof = {
    schema: "w3m-nicenic-account-transfer-confirmation-v1",
    domain: buyer.domain,
    sellerAccountUsername: seller.accountUsername,
    sellerAccountHasDomain: seller.accountHasDomain,
    sellerAccountListComplete: seller.accountListComplete,
    buyerAccountUsername: buyer.accountUsername,
    buyerAccountHasDomain: buyer.accountHasDomain,
    buyerStatus: buyer.status,
    buyerHold: buyer.hold,
    buyerExpiredDate: buyer.expiredDate,
    buyerNameservers: buyer.nameservers,
    buyerRegistrantIdentityMatched: true,
    dealId: input.dealId,
    projectId: input.projectId,
    assetId: input.assetId,
  };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(proof)));
  const proofHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const version = `${seller.accountUsername}:${buyer.accountUsername}:${buyer.expiredDate ?? "unknown"}`;
  const sourceEventId = `nicenic:${buyer.domain}:TRANSFER_CONFIRMED:${version}`;

  return {
    eventId: sourceEventId,
    eventType: "TRANSFER_CONFIRMED",
    assetId: input.assetId,
    dealId: input.dealId,
    projectId: input.projectId,
    sourceProvider: "nicenic",
    sourceRecordId: buyer.domain,
    sourceVersion: version,
    sourceEventId,
    proofHash,
    observedAt: input.now,
    validUntil: new Date(observedMs + 5 * 60 * 1000).toISOString(),
    authoritative: true,
    fromIdentity: input.sellerIdentity,
    toIdentity: input.buyerIdentity,
  };
}

export async function createNiceNicBuyerControlEvent(input: {
  snapshot: NiceNicDomainSnapshot;
  expectedDomain: string;
  expectedBuyerAccountUsername: string;
  dealId: string;
  projectId: string;
  assetId: string;
  sellerIdentity: string;
  buyerIdentity: string;
  registrantIdentityMatched: boolean;
  now: string;
}): Promise<AssetTransferEvent> {
  const snapshot = input.snapshot;
  const observedMs = Date.parse(input.now);
  if (
    snapshot.domain !== normalizeDomain(input.expectedDomain) ||
    snapshot.accountUsername !== input.expectedBuyerAccountUsername ||
    !snapshot.accountHasDomain ||
    snapshot.status !== "active" ||
    snapshot.hold !== false ||
    !snapshot.registrantContactPresent ||
    !input.registrantIdentityMatched ||
    snapshot.observedAt !== input.now ||
    !Number.isFinite(observedMs) ||
    !nonEmpty(input.dealId) ||
    !nonEmpty(input.projectId) ||
    !nonEmpty(input.assetId) ||
    !nonEmpty(input.sellerIdentity) ||
    !nonEmpty(input.buyerIdentity) ||
    input.sellerIdentity === input.buyerIdentity
  ) {
    throw new NiceNicAdapterError("NiceNIC buyer-control evidence requires a fresh active buyer-account read and registrant identity match.");
  }

  const proof = {
    schema: "w3m-nicenic-buyer-control-v1",
    domain: snapshot.domain,
    buyerAccountUsername: snapshot.accountUsername,
    status: snapshot.status,
    hold: snapshot.hold,
    expiredDate: snapshot.expiredDate,
    nameservers: snapshot.nameservers,
    registrantIdentityMatched: true,
    dealId: input.dealId,
    projectId: input.projectId,
    assetId: input.assetId,
  };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(proof)));
  const proofHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const version = `${snapshot.accountUsername}:${snapshot.expiredDate ?? "unknown"}:${snapshot.status}`;
  const sourceEventId = `nicenic:${snapshot.domain}:BUYER_CONTROL_VERIFIED:${version}`;

  return {
    eventId: sourceEventId,
    eventType: "BUYER_CONTROL_VERIFIED",
    assetId: input.assetId,
    dealId: input.dealId,
    projectId: input.projectId,
    sourceProvider: "nicenic",
    sourceRecordId: snapshot.domain,
    sourceVersion: version,
    sourceEventId,
    proofHash,
    observedAt: input.now,
    validUntil: new Date(observedMs + 5 * 60 * 1000).toISOString(),
    authoritative: true,
    currentOwnerIdentity: input.buyerIdentity,
  };
}
