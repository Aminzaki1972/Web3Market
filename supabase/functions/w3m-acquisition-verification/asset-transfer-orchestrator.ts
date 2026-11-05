// W3M Protocol V1 — asset transfer orchestration state machine.
// Pure domain logic only. Provider adapters must authenticate source events server-side.
// This module does not call GitHub, registrars, RPC endpoints, databases, or wallets.

export const ASSET_TRANSFER_ENGINE_VERSION = "w3m-asset-transfer-1.0.0";

export type AssetKind =
  | "GITHUB_REPOSITORY"
  | "DOMAIN"
  | "BLOCKCHAIN_WALLET"
  | "SMART_CONTRACT"
  | "HOSTING_ACCOUNT"
  | "CLOUD_RESOURCE"
  | "OTHER";

export type AssetTransferStatus =
  | "DISCOVERED"
  | "SELLER_CONTROL_VERIFIED"
  | "TRANSFER_REQUESTED"
  | "TRANSFER_PENDING"
  | "TRANSFER_CONFIRMED"
  | "BUYER_CONTROL_VERIFIED"
  | "FAILED"
  | "REVIEW_REQUIRED";

export type AssetTransferEventType =
  | "SELLER_CONTROL_VERIFIED"
  | "TRANSFER_REQUESTED"
  | "TRANSFER_PENDING"
  | "TRANSFER_CONFIRMED"
  | "BUYER_CONTROL_VERIFIED"
  | "TRANSFER_FAILED"
  | "MANUAL_REVIEW_REQUIRED";

export interface AssetTransferDefinition {
  assetId: string;
  dealId: string;
  projectId: string;
  kind: AssetKind;
  sourceProvider: string;
  sourceAssetRef: string;
  sellerIdentity: string;
  buyerIdentity: string;
  mandatory: boolean;
}

export interface AssetTransferEvent {
  eventId: string;
  eventType: AssetTransferEventType;
  assetId: string;
  dealId: string;
  projectId: string;
  sourceProvider: string;
  sourceRecordId: string;
  sourceVersion: string;
  sourceEventId: string;
  proofHash: string;
  observedAt: string;
  validUntil: string;
  authoritative: boolean;
  currentOwnerIdentity?: string;
  fromIdentity?: string;
  toIdentity?: string;
  reasonCode?: string;
}

export interface AssetTransferState {
  definition: AssetTransferDefinition;
  status: AssetTransferStatus;
  events: AssetTransferEvent[];
  lastEventAt: string | null;
}

export interface AssetTransferIssue {
  code: string;
  message: string;
  eventId?: string;
}

export interface AssetTransferTransition {
  state: AssetTransferState;
  accepted: boolean;
  idempotent: boolean;
  issues: AssetTransferIssue[];
  engineVersion: string;
}

export interface AssetPortfolioDecision {
  status: "PASS" | "INCOMPLETE" | "BLOCKED" | "REVIEW_REQUIRED";
  requiredAssetCount: number;
  buyerVerifiedAssetCount: number;
  pendingAssetIds: string[];
  failedAssetIds: string[];
  reviewAssetIds: string[];
}

const SHA256 = /^[0-9a-f]{64}$/;
const IDENTITY_EVENT_TYPES = new Set<AssetTransferEventType>([
  "SELLER_CONTROL_VERIFIED",
  "TRANSFER_REQUESTED",
  "TRANSFER_PENDING",
  "TRANSFER_CONFIRMED",
  "BUYER_CONTROL_VERIFIED",
  "TRANSFER_FAILED",
  "MANUAL_REVIEW_REQUIRED",
]);

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function issue(code: string, message: string, event?: AssetTransferEvent): AssetTransferIssue {
  return { code, message, ...(event ? { eventId: event.eventId } : {}) };
}

export function createAssetTransferState(
  definition: AssetTransferDefinition,
): AssetTransferState {
  return { definition: { ...definition }, status: "DISCOVERED", events: [], lastEventAt: null };
}

function validateEnvelope(
  state: AssetTransferState,
  event: AssetTransferEvent,
  now: string,
): AssetTransferIssue[] {
  const issues: AssetTransferIssue[] = [];
  const definition = state.definition;
  const requiredStrings: Array<[string, unknown]> = [
    ["eventId", event.eventId],
    ["assetId", event.assetId],
    ["dealId", event.dealId],
    ["projectId", event.projectId],
    ["sourceProvider", event.sourceProvider],
    ["sourceRecordId", event.sourceRecordId],
    ["sourceVersion", event.sourceVersion],
    ["sourceEventId", event.sourceEventId],
    ["proofHash", event.proofHash],
    ["observedAt", event.observedAt],
    ["validUntil", event.validUntil],
  ];
  for (const [field, value] of requiredStrings) {
    if (!nonEmpty(value)) issues.push(issue("EVENT_FIELD_MISSING", `Required event field ${field} is missing.`, event));
  }
  if (event.assetId !== definition.assetId || event.dealId !== definition.dealId ||
      event.projectId !== definition.projectId) {
    issues.push(issue("ASSET_BINDING_MISMATCH", "Event is not bound to this exact asset, deal, and project.", event));
  }
  if (event.sourceProvider !== definition.sourceProvider) {
    issues.push(issue("SOURCE_PROVIDER_MISMATCH", "Event source provider does not match the registered asset provider.", event));
  }
  if (!SHA256.test(event.proofHash || "")) {
    issues.push(issue("PROOF_HASH_INVALID", "A valid SHA-256 proof hash is required.", event));
  }
  if (event.authoritative !== true) {
    issues.push(issue("SOURCE_NOT_AUTHORITATIVE", "Only a trusted server-side adapter may assert an authoritative source event.", event));
  }
  if (!IDENTITY_EVENT_TYPES.has(event.eventType)) {
    issues.push(issue("EVENT_TYPE_INVALID", "Unrecognized asset transfer event type.", event));
  }

  const nowMs = timestamp(now);
  const observedMs = timestamp(event.observedAt);
  const expiryMs = timestamp(event.validUntil);
  if (nowMs === null || observedMs === null || expiryMs === null ||
      observedMs > nowMs || expiryMs <= nowMs || expiryMs <= observedMs) {
    issues.push(issue("EVENT_TIME_INVALID", "Event timestamps are invalid, future-dated, or expired.", event));
  }
  return issues;
}

function validateTransition(
  state: AssetTransferState,
  event: AssetTransferEvent,
): AssetTransferIssue[] {
  const issues: AssetTransferIssue[] = [];
  const status = state.status;
  const definition = state.definition;

  if (state.lastEventAt !== null) {
    const previousEventMs = timestamp(state.lastEventAt);
    const incomingEventMs = timestamp(event.observedAt);
    if (previousEventMs !== null && incomingEventMs !== null && incomingEventMs <= previousEventMs) {
      issues.push(issue("EVENT_OUT_OF_ORDER", "Provider events must be applied in strictly increasing observation-time order.", event));
      return issues;
    }
  }

  if (status === "FAILED" || status === "REVIEW_REQUIRED") {
    return [issue("ASSET_STATE_TERMINAL", "A failed or review-required asset needs an authorized new workflow; it cannot silently continue.", event)];
  }

  switch (event.eventType) {
    case "SELLER_CONTROL_VERIFIED":
      if (status !== "DISCOVERED" || event.currentOwnerIdentity !== definition.sellerIdentity) {
        issues.push(issue("SELLER_CONTROL_NOT_PROVEN", "Seller control must be confirmed by the source before transfer preparation.", event));
      }
      break;
    case "TRANSFER_REQUESTED":
      if (status !== "SELLER_CONTROL_VERIFIED" ||
          event.fromIdentity !== definition.sellerIdentity ||
          event.toIdentity !== definition.buyerIdentity) {
        issues.push(issue("TRANSFER_REQUEST_INVALID", "Transfer request must follow seller verification and target the exact buyer.", event));
      }
      break;
    case "TRANSFER_PENDING":
      if (status !== "TRANSFER_REQUESTED" && status !== "TRANSFER_PENDING") {
        issues.push(issue("TRANSFER_PENDING_OUT_OF_ORDER", "A transfer can become pending only after a valid transfer request.", event));
      }
      if (event.fromIdentity !== definition.sellerIdentity || event.toIdentity !== definition.buyerIdentity) {
        issues.push(issue("TRANSFER_PARTIES_MISMATCH", "Pending transfer parties do not match the deal.", event));
      }
      break;
    case "TRANSFER_CONFIRMED":
      if (status !== "TRANSFER_REQUESTED" && status !== "TRANSFER_PENDING") {
        issues.push(issue("TRANSFER_CONFIRMATION_OUT_OF_ORDER", "Transfer confirmation requires a previously requested transfer.", event));
      }
      if (event.fromIdentity !== definition.sellerIdentity || event.toIdentity !== definition.buyerIdentity) {
        issues.push(issue("TRANSFER_PARTIES_MISMATCH", "Confirmed transfer parties do not match the deal.", event));
      }
      break;
    case "BUYER_CONTROL_VERIFIED":
      if (status !== "TRANSFER_CONFIRMED" || event.currentOwnerIdentity !== definition.buyerIdentity) {
        issues.push(issue("BUYER_CONTROL_NOT_PROVEN", "Buyer control can be accepted only after transfer confirmation and source verification of the buyer as owner.", event));
      }
      break;
    case "TRANSFER_FAILED":
      if (status !== "TRANSFER_REQUESTED" && status !== "TRANSFER_PENDING") {
        issues.push(issue("TRANSFER_FAILURE_OUT_OF_ORDER", "Only an active transfer request can be marked failed.", event));
      }
      if (event.fromIdentity !== definition.sellerIdentity || event.toIdentity !== definition.buyerIdentity) {
        issues.push(issue("TRANSFER_PARTIES_MISMATCH", "Failed transfer parties do not match the deal.", event));
      }
      if (!nonEmpty(event.reasonCode)) {
        issues.push(issue("FAILURE_REASON_MISSING", "A provider failure reason is required.", event));
      }
      break;
    case "MANUAL_REVIEW_REQUIRED":
      if (!nonEmpty(event.reasonCode)) {
        issues.push(issue("REVIEW_REASON_MISSING", "A review reason code is required.", event));
      }
      break;
  }
  return issues;
}

function nextStatus(type: AssetTransferEventType): AssetTransferStatus {
  switch (type) {
    case "SELLER_CONTROL_VERIFIED": return "SELLER_CONTROL_VERIFIED";
    case "TRANSFER_REQUESTED": return "TRANSFER_REQUESTED";
    case "TRANSFER_PENDING": return "TRANSFER_PENDING";
    case "TRANSFER_CONFIRMED": return "TRANSFER_CONFIRMED";
    case "BUYER_CONTROL_VERIFIED": return "BUYER_CONTROL_VERIFIED";
    case "TRANSFER_FAILED": return "FAILED";
    case "MANUAL_REVIEW_REQUIRED": return "REVIEW_REQUIRED";
  }
}

export function applyAssetTransferEvent(
  state: AssetTransferState,
  event: AssetTransferEvent,
  now: string,
): AssetTransferTransition {
  const prior = state.events.find((item) => item.eventId === event.eventId);
  if (prior) {
    if (prior.proofHash === event.proofHash && prior.eventType === event.eventType) {
      return { state, accepted: true, idempotent: true, issues: [], engineVersion: ASSET_TRANSFER_ENGINE_VERSION };
    }
    return {
      state,
      accepted: false,
      idempotent: false,
      issues: [issue("EVENT_ID_COLLISION", "An existing event ID was reused with different event content.", event)],
      engineVersion: ASSET_TRANSFER_ENGINE_VERSION,
    };
  }

  const issues = [
    ...validateEnvelope(state, event, now),
    ...validateTransition(state, event),
  ];
  if (issues.length > 0) {
    return { state, accepted: false, idempotent: false, issues, engineVersion: ASSET_TRANSFER_ENGINE_VERSION };
  }

  const nextState: AssetTransferState = {
    definition: state.definition,
    status: nextStatus(event.eventType),
    events: [...state.events, { ...event }],
    lastEventAt: event.observedAt,
  };
  return { state: nextState, accepted: true, idempotent: false, issues: [], engineVersion: ASSET_TRANSFER_ENGINE_VERSION };
}

export function evaluateAssetPortfolio(states: AssetTransferState[]): AssetPortfolioDecision {
  const required = states.filter((state) => state.definition.mandatory);
  const failedAssetIds = required.filter((state) => state.status === "FAILED").map((state) => state.definition.assetId);
  const reviewAssetIds = required.filter((state) => state.status === "REVIEW_REQUIRED").map((state) => state.definition.assetId);
  const pendingAssetIds = required
    .filter((state) => state.status !== "BUYER_CONTROL_VERIFIED" &&
      state.status !== "FAILED" && state.status !== "REVIEW_REQUIRED")
    .map((state) => state.definition.assetId);
  const buyerVerifiedAssetCount = required.filter((state) => state.status === "BUYER_CONTROL_VERIFIED").length;

  let status: AssetPortfolioDecision["status"] = required.length === 0 ? "INCOMPLETE" : "PASS";
  if (failedAssetIds.length > 0) status = "BLOCKED";
  else if (reviewAssetIds.length > 0) status = "REVIEW_REQUIRED";
  else if (pendingAssetIds.length > 0) status = "INCOMPLETE";

  return {
    status,
    requiredAssetCount: required.length,
    buyerVerifiedAssetCount,
    pendingAssetIds,
    failedAssetIds,
    reviewAssetIds,
  };
}
