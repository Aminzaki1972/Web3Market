import {
  applyAssetTransferEvent,
  createAssetTransferState,
  evaluateAssetPortfolio,
  type AssetTransferDefinition,
  type AssetTransferEvent,
  type AssetTransferState,
} from "./asset-transfer-orchestrator.ts";

const NOW = "2026-11-05T18:00:00.000Z";
const EXPIRY = "2026-11-06T18:00:00.000Z";
const HASH = "a".repeat(64);

const DEFINITION: AssetTransferDefinition = {
  assetId: "asset-github-1",
  dealId: "deal-1",
  projectId: "project-1",
  kind: "GITHUB_REPOSITORY",
  sourceProvider: "github",
  sourceAssetRef: "owner/repository",
  sellerIdentity: "seller-account",
  buyerIdentity: "buyer-account",
  mandatory: true,
};

function event(
  eventType: AssetTransferEvent["eventType"],
  overrides: Partial<AssetTransferEvent> = {},
): AssetTransferEvent {
  const common: AssetTransferEvent = {
    eventId: "event-" + eventType,
    eventType,
    assetId: DEFINITION.assetId,
    dealId: DEFINITION.dealId,
    projectId: DEFINITION.projectId,
    sourceProvider: DEFINITION.sourceProvider,
    sourceRecordId: "provider-record-1",
    sourceVersion: "v1",
    sourceEventId: "provider-event-" + eventType,
    proofHash: HASH,
    observedAt: "2026-11-05T17:00:00.000Z",
    validUntil: EXPIRY,
    authoritative: true,
    ...overrides,
  };

  if (eventType === "SELLER_CONTROL_VERIFIED") common.currentOwnerIdentity = DEFINITION.sellerIdentity;
  if (eventType === "TRANSFER_REQUESTED" || eventType === "TRANSFER_PENDING" ||
      eventType === "TRANSFER_CONFIRMED" || eventType === "TRANSFER_FAILED") {
    common.fromIdentity = DEFINITION.sellerIdentity;
    common.toIdentity = DEFINITION.buyerIdentity;
  }
  if (eventType === "BUYER_CONTROL_VERIFIED") common.currentOwnerIdentity = DEFINITION.buyerIdentity;
  if (eventType === "TRANSFER_FAILED" || eventType === "MANUAL_REVIEW_REQUIRED") {
    common.reasonCode = "PROVIDER_REJECTED";
  }
  return common;
}

function apply(state: AssetTransferState, item: AssetTransferEvent) {
  const result = applyAssetTransferEvent(state, item, NOW);
  if (!result.accepted) throw new Error(JSON.stringify(result.issues));
  return result.state;
}

function completeTransfer(): AssetTransferState {
  let state = createAssetTransferState(DEFINITION);
  state = apply(state, event("SELLER_CONTROL_VERIFIED"));
  state = apply(state, event("TRANSFER_REQUESTED"));
  state = apply(state, event("TRANSFER_PENDING"));
  state = apply(state, event("TRANSFER_CONFIRMED"));
  state = apply(state, event("BUYER_CONTROL_VERIFIED"));
  return state;
}

Deno.test("asset transfer requires seller verification before transfer request", () => {
  const state = createAssetTransferState(DEFINITION);
  const result = applyAssetTransferEvent(state, event("TRANSFER_REQUESTED"), NOW);
  if (result.accepted || result.issues[0]?.code !== "TRANSFER_REQUEST_INVALID") {
    throw new Error("Transfer request must not bypass seller control verification.");
  }
});

Deno.test("asset transfer completes only after buyer ownership is independently verified", () => {
  const state = completeTransfer();
  if (state.status !== "BUYER_CONTROL_VERIFIED" || state.events.length !== 5) {
    throw new Error("Expected complete five-event ownership transfer lifecycle.");
  }
});

Deno.test("buyer control cannot be asserted before transfer confirmation", () => {
  let state = createAssetTransferState(DEFINITION);
  state = apply(state, event("SELLER_CONTROL_VERIFIED"));
  state = apply(state, event("TRANSFER_REQUESTED"));
  const result = applyAssetTransferEvent(state, event("BUYER_CONTROL_VERIFIED"), NOW);
  if (result.accepted || !result.issues.some((item) => item.code === "BUYER_CONTROL_NOT_PROVEN")) {
    throw new Error("Buyer ownership must follow transfer confirmation.");
  }
});

Deno.test("provider event must match exact deal, project, asset and provider", () => {
  const state = createAssetTransferState(DEFINITION);
  const result = applyAssetTransferEvent(
    state,
    event("SELLER_CONTROL_VERIFIED", { projectId: "another-project" }),
    NOW,
  );
  if (result.accepted || !result.issues.some((item) => item.code === "ASSET_BINDING_MISMATCH")) {
    throw new Error("Cross-project evidence must be rejected.");
  }
});

Deno.test("untrusted or expired provider event cannot advance ownership state", () => {
  const state = createAssetTransferState(DEFINITION);
  const untrusted = applyAssetTransferEvent(
    state,
    event("SELLER_CONTROL_VERIFIED", { authoritative: false }),
    NOW,
  );
  if (untrusted.accepted) throw new Error("Untrusted event must be rejected.");

  const expired = applyAssetTransferEvent(
    state,
    event("SELLER_CONTROL_VERIFIED", { validUntil: "2026-11-05T17:59:59.000Z" }),
    NOW,
  );
  if (expired.accepted) throw new Error("Expired event must be rejected.");
});

Deno.test("replaying the same provider event is idempotent", () => {
  const state = createAssetTransferState(DEFINITION);
  const item = event("SELLER_CONTROL_VERIFIED");
  const first = applyAssetTransferEvent(state, item, NOW);
  const replay = applyAssetTransferEvent(first.state, item, NOW);
  if (!first.accepted || !replay.accepted || !replay.idempotent || replay.state.events.length !== 1) {
    throw new Error("Expected safe idempotent replay.");
  }
});

Deno.test("reusing an event ID with different proof is rejected", () => {
  let state = createAssetTransferState(DEFINITION);
  const original = event("SELLER_CONTROL_VERIFIED");
  state = apply(state, original);
  const collision = applyAssetTransferEvent(
    state,
    event("SELLER_CONTROL_VERIFIED", { proofHash: "b".repeat(64) }),
    NOW,
  );
  if (collision.accepted || !collision.issues.some((item) => item.code === "EVENT_ID_COLLISION")) {
    throw new Error("Conflicting event ID reuse must be rejected.");
  }
});

Deno.test("a failed provider transfer blocks the mandatory asset", () => {
  let state = createAssetTransferState(DEFINITION);
  state = apply(state, event("SELLER_CONTROL_VERIFIED"));
  state = apply(state, event("TRANSFER_REQUESTED"));
  state = apply(state, event("TRANSFER_FAILED"));
  const decision = evaluateAssetPortfolio([state]);
  if (decision.status !== "BLOCKED" || decision.failedAssetIds[0] !== DEFINITION.assetId) {
    throw new Error("Failed mandatory transfer must block acquisition.");
  }
});

Deno.test("portfolio remains incomplete until every mandatory asset is buyer-verified", () => {
  const secondDefinition = { ...DEFINITION, assetId: "asset-domain-1", kind: "DOMAIN" as const, sourceProvider: "registrar" };
  const complete = completeTransfer();
  const pending = createAssetTransferState(secondDefinition);
  const decision = evaluateAssetPortfolio([complete, pending]);
  if (decision.status !== "INCOMPLETE" || decision.buyerVerifiedAssetCount !== 1 ||
      decision.pendingAssetIds[0] !== secondDefinition.assetId) {
    throw new Error("One pending mandatory asset must prevent acquisition PASS.");
  }
});

Deno.test("manual review on any mandatory asset requires review", () => {
  let state = createAssetTransferState(DEFINITION);
  state = apply(state, event("MANUAL_REVIEW_REQUIRED"));
  const decision = evaluateAssetPortfolio([state]);
  if (decision.status !== "REVIEW_REQUIRED") throw new Error("Expected REVIEW_REQUIRED.");
});

Deno.test("optional assets do not block mandatory asset completion", () => {
  const optional = createAssetTransferState({ ...DEFINITION, assetId: "optional-asset", mandatory: false });
  const decision = evaluateAssetPortfolio([completeTransfer(), optional]);
  if (decision.status !== "PASS" || decision.requiredAssetCount !== 1) {
    throw new Error("Optional assets must not gate mandatory acquisition completion.");
  }
});
