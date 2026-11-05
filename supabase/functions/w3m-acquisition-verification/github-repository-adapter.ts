import type { AssetTransferEvent } from "./asset-transfer-orchestrator.ts";

// W3M Protocol V1 — read-only GitHub repository adapter.
// This adapter never initiates a transfer. It fetches authoritative repository
// metadata and evaluates exact immutable repository/account identities.
// Credentials must be supplied server-side and must never come from browser input.

export const GITHUB_ADAPTER_VERSION = "w3m-github-adapter-1.0.0";
const API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";

export interface GitHubAccountIdentity {
  id: number;
  login: string;
  type: "User" | "Organization";
}

export interface GitHubRepositorySnapshot {
  id: number;
  name: string;
  fullName: string;
  owner: GitHubAccountIdentity;
  private: boolean;
  fork: boolean;
  archived: boolean;
  disabled: boolean;
  visibility: string;
  defaultBranch: string;
  updatedAt: string;
  admin: boolean | null;
  etag: string | null;
  requestId: string | null;
  fetchedAt: string;
}

export interface GitHubRepositoryExpectation {
  repositoryId: number;
  sellerAccountId: number;
  buyerAccountId: number;
}

export interface GitHubAuthenticatedAccount {
  id: number;
  login: string;
  type: "User";
}

export interface GitHubOwnershipSnapshot {
  repository: GitHubRepositorySnapshot;
  authenticatedAccount: GitHubAuthenticatedAccount;
}

export type GitHubOwnershipResult =
  | { status: "SELLER_CONTROL_VERIFIED"; snapshot: GitHubRepositorySnapshot }
  | { status: "BUYER_CONTROL_VERIFIED"; snapshot: GitHubRepositorySnapshot }
  | { status: "OWNER_MISMATCH"; snapshot: GitHubRepositorySnapshot; expectedAccountId: number }
  | { status: "REPOSITORY_MISMATCH"; snapshot: GitHubRepositorySnapshot; expectedRepositoryId: number }
  | { status: "ADMIN_CONTROL_UNVERIFIED"; snapshot: GitHubRepositorySnapshot }
  | { status: "REVIEW_REQUIRED"; reason: string };

export interface GitHubTransferIntent {
  repositoryId: number;
  fromAccountId: number;
  toAccountId: number;
  fromLogin: string;
  toLogin: string;
  requestBody: { new_owner: string };
  requiresSellerApproval: true;
  requiresBuyerAcceptance: true;
  executionEnabled: false;
}

export class GitHubAdapterError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "GitHubAdapterError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeGitHubRepository(
  raw: unknown,
  headers: Headers,
  fetchedAt: string,
): GitHubRepositorySnapshot {
  if (!isRecord(raw) || !isRecord(raw.owner) || !isRecord(raw.permissions)) {
    throw new GitHubAdapterError("GitHub repository response is missing required owner or permission fields.");
  }

  const owner = raw.owner;
  if (!positiveInteger(raw.id) || !positiveInteger(owner.id) ||
      !nonEmpty(owner.login) || !["User", "Organization"].includes(String(owner.type)) ||
      !nonEmpty(raw.name) || !nonEmpty(raw.full_name) || !nonEmpty(raw.default_branch) ||
      !nonEmpty(raw.updated_at) || typeof raw.private !== "boolean" ||
      typeof raw.fork !== "boolean" || typeof raw.archived !== "boolean" ||
      typeof raw.disabled !== "boolean" || !nonEmpty(raw.visibility)) {
    throw new GitHubAdapterError("GitHub repository response contains invalid or incomplete identity metadata.");
  }

  const fetchedMs = Date.parse(fetchedAt);
  const updatedMs = Date.parse(raw.updated_at);
  if (!Number.isFinite(fetchedMs) || !Number.isFinite(updatedMs) || updatedMs > fetchedMs) {
    throw new GitHubAdapterError("GitHub repository timestamps are invalid or future-dated.");
  }

  const admin = typeof raw.permissions.admin === "boolean" ? raw.permissions.admin : null;
  return {
    id: raw.id,
    name: raw.name,
    fullName: raw.full_name,
    owner: {
      id: owner.id,
      login: owner.login,
      type: owner.type as GitHubAccountIdentity["type"],
    },
    private: raw.private,
    fork: raw.fork,
    archived: raw.archived,
    disabled: raw.disabled,
    visibility: raw.visibility,
    defaultBranch: raw.default_branch,
    updatedAt: raw.updated_at,
    admin,
    etag: headers.get("etag"),
    requestId: headers.get("x-github-request-id"),
    fetchedAt,
  };
}

export async function fetchGitHubRepositorySnapshot(
  input: {
    ownerLogin: string;
    repositoryName: string;
    serverToken: string;
    fetchImpl?: typeof fetch;
    now?: string;
  },
): Promise<GitHubRepositorySnapshot> {
  if (!nonEmpty(input.ownerLogin) || !nonEmpty(input.repositoryName) ||
      !nonEmpty(input.serverToken)) {
    throw new GitHubAdapterError("Owner, repository name, and server-side token are required.");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const url = `${API_BASE}/repos/${encodeURIComponent(input.ownerLogin)}/${encodeURIComponent(input.repositoryName)}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.serverToken}`,
      "X-GitHub-Api-Version": API_VERSION,
    },
  });

  const requestId = response.headers.get("x-github-request-id");
  if (!response.ok) {
    // Do not include response bodies: provider error bodies can contain user-controlled data.
    throw new GitHubAdapterError(
      `GitHub repository read failed with HTTP ${response.status}.`,
      response.status,
      requestId,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GitHubAdapterError("GitHub returned an unreadable repository response.", response.status, requestId);
  }

  return normalizeGitHubRepository(
    payload,
    response.headers,
    input.now ?? new Date().toISOString(),
  );
}

export async function fetchGitHubAuthenticatedAccount(
  input: { serverToken: string; fetchImpl?: typeof fetch },
): Promise<GitHubAuthenticatedAccount> {
  if (!nonEmpty(input.serverToken)) {
    throw new GitHubAdapterError("A server-side GitHub token is required.");
  }
  const response = await (input.fetchImpl ?? fetch)(`${API_BASE}/user`, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.serverToken}`,
      "X-GitHub-Api-Version": API_VERSION,
    },
  });
  if (!response.ok) {
    throw new GitHubAdapterError(
      `GitHub authenticated-user read failed with HTTP ${response.status}.`,
      response.status,
      response.headers.get("x-github-request-id"),
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GitHubAdapterError("GitHub returned an unreadable authenticated-user response.");
  }
  if (!isRecord(payload) || !positiveInteger(payload.id) ||
      !nonEmpty(payload.login) || payload.type !== "User") {
    throw new GitHubAdapterError("The GitHub token did not resolve to a verified personal user identity.");
  }
  return { id: payload.id, login: payload.login, type: "User" };
}

export async function fetchGitHubOwnershipSnapshot(input: {
  ownerLogin: string;
  repositoryName: string;
  serverToken: string;
  fetchImpl?: typeof fetch;
  now?: string;
}): Promise<GitHubOwnershipSnapshot> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const [repository, authenticatedAccount] = await Promise.all([
    fetchGitHubRepositorySnapshot({ ...input, fetchImpl }),
    fetchGitHubAuthenticatedAccount({ serverToken: input.serverToken, fetchImpl }),
  ]);
  return { repository, authenticatedAccount };
}

export function verifyGitHubRepositoryOwner(
  snapshot: GitHubRepositorySnapshot,
  expectation: GitHubRepositoryExpectation,
  phase: "SELLER" | "BUYER",
  authenticatedAccount: GitHubAuthenticatedAccount,
): GitHubOwnershipResult {
  if (!positiveInteger(expectation.repositoryId) ||
      !positiveInteger(expectation.sellerAccountId) ||
      !positiveInteger(expectation.buyerAccountId) ||
      expectation.sellerAccountId === expectation.buyerAccountId) {
    return { status: "REVIEW_REQUIRED", reason: "The deal's immutable GitHub identity bindings are invalid." };
  }

  if (snapshot.id !== expectation.repositoryId) {
    return {
      status: "REPOSITORY_MISMATCH",
      snapshot,
      expectedRepositoryId: expectation.repositoryId,
    };
  }

  // V1 intentionally supports personal-user repositories only. Organization
  // repositories need a separate verified organization-owner/member adapter.
  if (snapshot.owner.type !== "User") {
    return { status: "REVIEW_REQUIRED", reason: "Organization-owned repositories require a separate organization authority verification adapter." };
  }

  const expectedOwner = phase === "SELLER"
    ? expectation.sellerAccountId
    : expectation.buyerAccountId;

  if (authenticatedAccount.type !== "User" || authenticatedAccount.id !== expectedOwner) {
    return { status: "REVIEW_REQUIRED", reason: "The authenticated GitHub user is not the exact expected seller or buyer account." };
  }

  if (snapshot.owner.id !== expectedOwner) {
    return { status: "OWNER_MISMATCH", snapshot, expectedAccountId: expectedOwner };
  }

  if (phase === "SELLER" && snapshot.admin !== true) {
    return { status: "ADMIN_CONTROL_UNVERIFIED", snapshot };
  }

  return {
    status: phase === "SELLER" ? "SELLER_CONTROL_VERIFIED" : "BUYER_CONTROL_VERIFIED",
    snapshot,
  };
}

// This produces a reviewable intent only. It deliberately does not POST to GitHub.
// A separate, explicitly authorized server workflow must re-read the repository,
// verify both parties' consent and then decide whether to call the transfer endpoint.
export function prepareGitHubTransferIntent(input: {
  sellerSnapshot: GitHubRepositorySnapshot;
  expectation: GitHubRepositoryExpectation;
  buyer: GitHubAccountIdentity;
  sellerAuthenticatedAccount: GitHubAuthenticatedAccount;
  sellerConsentRecorded: boolean;
  buyerConsentRecorded: boolean;
}): GitHubTransferIntent {
  if (input.sellerSnapshot.owner.type !== "User") {
    throw new GitHubAdapterError("Organization-owned repositories require organization authority verification before transfer.");
  }
  const sellerCheck = verifyGitHubRepositoryOwner(
    input.sellerSnapshot,
    input.expectation,
    "SELLER",
    input.sellerAuthenticatedAccount,
  );
  if (sellerCheck.status !== "SELLER_CONTROL_VERIFIED") {
    throw new GitHubAdapterError("Cannot prepare transfer: seller ownership or administrator control is not verified.");
  }
  if (!input.sellerConsentRecorded || !input.buyerConsentRecorded) {
    throw new GitHubAdapterError("Both seller and buyer must consent to the exact repository transfer.");
  }
  if (!positiveInteger(input.buyer.id) ||
      input.buyer.id !== input.expectation.buyerAccountId ||
      !nonEmpty(input.buyer.login) ||
      input.buyer.type !== "User") {
    throw new GitHubAdapterError("Buyer GitHub account identity does not match the deal's pre-verified account ID.");
  }
  if (input.sellerSnapshot.fork || input.sellerSnapshot.disabled) {
    throw new GitHubAdapterError("Forked or disabled repositories require provider-specific review before transfer.");
  }

  return {
    repositoryId: input.sellerSnapshot.id,
    fromAccountId: input.sellerSnapshot.owner.id,
    toAccountId: input.buyer.id,
    fromLogin: input.sellerSnapshot.owner.login,
    toLogin: input.buyer.login,
    requestBody: { new_owner: input.buyer.login },
    requiresSellerApproval: true,
    requiresBuyerAcceptance: true,
    executionEnabled: false,
  };
}


// Converts a freshly fetched and authenticated GitHub ownership read into the
// normalized W3M event consumed by the asset-transfer orchestrator.
// The caller must persist the event server-side; never accept it from a browser.
export async function createGitHubOwnershipVerifiedEvent(input: {
  ownership: GitHubOwnershipSnapshot;
  expectation: GitHubRepositoryExpectation;
  phase: "SELLER" | "BUYER";
  dealId: string;
  projectId: string;
  assetId: string;
  sellerIdentity: string;
  buyerIdentity: string;
  now: string;
}): Promise<AssetTransferEvent> {
  const verification = verifyGitHubRepositoryOwner(
    input.ownership.repository,
    input.expectation,
    input.phase,
    input.ownership.authenticatedAccount,
  );
  const expectedStatus = input.phase === "SELLER"
    ? "SELLER_CONTROL_VERIFIED"
    : "BUYER_CONTROL_VERIFIED";
  if (verification.status !== expectedStatus) {
    throw new GitHubAdapterError("GitHub ownership evidence cannot be emitted because the exact owner and authenticated actor were not verified.");
  }
  const observedMs = Date.parse(input.now);
  if (!Number.isFinite(observedMs) || !nonEmpty(input.dealId) ||
      !nonEmpty(input.projectId) || !nonEmpty(input.assetId) ||
      !nonEmpty(input.sellerIdentity) || !nonEmpty(input.buyerIdentity) ||
      input.sellerIdentity === input.buyerIdentity) {
    throw new GitHubAdapterError("Deal binding, identities, or observation time are invalid.");
  }

  const repository = input.ownership.repository;
  const proof = {
    schema: "w3m-github-ownership-proof-v1",
    phase: input.phase,
    dealId: input.dealId,
    projectId: input.projectId,
    assetId: input.assetId,
    repositoryId: repository.id,
    ownerId: repository.owner.id,
    ownerLogin: repository.owner.login,
    authenticatedActorId: input.ownership.authenticatedAccount.id,
    authenticatedActorLogin: input.ownership.authenticatedAccount.login,
    admin: repository.admin,
    visibility: repository.visibility,
    fork: repository.fork,
    archived: repository.archived,
    disabled: repository.disabled,
    defaultBranch: repository.defaultBranch,
    updatedAt: repository.updatedAt,
    etag: repository.etag,
    requestId: repository.requestId,
    observedAt: input.now,
  };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(proof)),
  );
  const proofHash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const version = repository.etag ?? repository.updatedAt;
  const sourceEventId = `github:${repository.id}:${input.phase}:${version}`;
  const eventType = input.phase === "SELLER"
    ? "SELLER_CONTROL_VERIFIED"
    : "BUYER_CONTROL_VERIFIED";

  return {
    eventId: sourceEventId,
    eventType,
    assetId: input.assetId,
    dealId: input.dealId,
    projectId: input.projectId,
    sourceProvider: "github",
    sourceRecordId: String(repository.id),
    sourceVersion: version,
    sourceEventId,
    proofHash,
    observedAt: input.now,
    validUntil: new Date(observedMs + 5 * 60 * 1000).toISOString(),
    authoritative: true,
    currentOwnerIdentity: input.phase === "SELLER"
      ? input.sellerIdentity
      : input.buyerIdentity,
  };
}
