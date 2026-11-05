import {
  createGitHubOwnershipVerifiedEvent,
  createGitHubTransferConfirmedEvent,
  fetchGitHubAuthenticatedAccount,
  fetchGitHubRepositorySnapshot,
  GitHubAdapterError,
  normalizeGitHubRepository,
  prepareGitHubTransferIntent,
  verifyGitHubRepositoryOwner,
  type GitHubRepositorySnapshot,
} from "./github-repository-adapter.ts";
import { applyAssetTransferEvent, createAssetTransferState, evaluateAssetPortfolio } from "./asset-transfer-orchestrator.ts";

const NOW = "2026-11-05T20:00:00.000Z";
const RAW = {
  id: 12345,
  name: "sample-project",
  full_name: "seller/sample-project",
  owner: { id: 100, login: "seller", type: "User" },
  private: true,
  fork: false,
  archived: false,
  disabled: false,
  visibility: "private",
  default_branch: "main",
  updated_at: "2026-11-05T19:00:00.000Z",
  permissions: { admin: true, push: true, pull: true },
};

function snapshot(overrides: Record<string, unknown> = {}): GitHubRepositorySnapshot {
  return normalizeGitHubRepository(
    { ...RAW, ...overrides },
    new Headers({ etag: '"repo-etag"', "x-github-request-id": "request-123" }),
    NOW,
  );
}

const EXPECTATION = {
  repositoryId: 12345,
  sellerAccountId: 100,
  buyerAccountId: 200,
};
const SELLER_ACTOR = { id: 100, login: "seller", type: "User" as const };
const BUYER_ACTOR = { id: 200, login: "buyer", type: "User" as const };

Deno.test("normalizes immutable repository and owner IDs with provider metadata", () => {
  const result = snapshot();
  if (result.id !== 12345 || result.owner.id !== 100 ||
      result.owner.login !== "seller" || result.admin !== true ||
      result.etag !== '"repo-etag"' || result.requestId !== "request-123") {
    throw new Error("GitHub repository snapshot normalization failed.");
  }
});

Deno.test("rejects incomplete repository owner identity", () => {
  let rejected = false;
  try {
    snapshot({ owner: { login: "seller", type: "User" } });
  } catch (error) {
    rejected = error instanceof GitHubAdapterError;
  }
  if (!rejected) throw new Error("Missing immutable owner ID must be rejected.");
});

Deno.test("seller control requires exact repository ID, owner ID and admin permission", () => {
  const verified = verifyGitHubRepositoryOwner(snapshot(), EXPECTATION, "SELLER", SELLER_ACTOR);
  if (verified.status !== "SELLER_CONTROL_VERIFIED") throw new Error("Expected seller ownership verification.");

  const noAdmin = verifyGitHubRepositoryOwner(
    snapshot({ permissions: { admin: false } }),
    EXPECTATION,
    "SELLER",
    SELLER_ACTOR,
  );
  if (noAdmin.status !== "ADMIN_CONTROL_UNVERIFIED") throw new Error("Admin control must be required.");

  const wrongRepo = verifyGitHubRepositoryOwner(
    snapshot({ id: 99999 }),
    EXPECTATION,
    "SELLER",
    SELLER_ACTOR,
  );
  if (wrongRepo.status !== "REPOSITORY_MISMATCH") throw new Error("Repository substitution must be rejected.");
});

Deno.test("authenticated GitHub actor must match the expected seller or buyer", () => {
  const wrongActor = verifyGitHubRepositoryOwner(
    snapshot(),
    EXPECTATION,
    "SELLER",
    { id: 999, login: "other-user", type: "User" },
  );
  if (wrongActor.status !== "REVIEW_REQUIRED") {
    throw new Error("A token belonging to another GitHub user must not prove seller control.");
  }
});

Deno.test("organization-owned repositories require a dedicated organization authority adapter", () => {
  const result = verifyGitHubRepositoryOwner(
    snapshot({ owner: { id: 300, login: "seller-org", type: "Organization" } }),
    EXPECTATION,
    "SELLER",
    SELLER_ACTOR,
  );
  if (result.status !== "REVIEW_REQUIRED") {
    throw new Error("Organization ownership must not be inferred from a personal-user token.");
  }
});

Deno.test("buyer ownership is not verified from collaborator or admin permission alone", () => {
  const collaborator = verifyGitHubRepositoryOwner(
    snapshot({ owner: { id: 100, login: "seller", type: "User" }, permissions: { admin: true } }),
    EXPECTATION,
    "BUYER",
    BUYER_ACTOR,
  );
  if (collaborator.status !== "OWNER_MISMATCH") {
    throw new Error("Buyer must be the actual repository owner, not merely an administrator.");
  }

  const buyerOwner = verifyGitHubRepositoryOwner(
    snapshot({ owner: { id: 200, login: "buyer", type: "User" }, permissions: { admin: true } }),
    EXPECTATION,
    "BUYER",
    BUYER_ACTOR,
  );
  if (buyerOwner.status !== "BUYER_CONTROL_VERIFIED") throw new Error("Expected buyer owner verification.");
});

Deno.test("transfer intent requires both consents and exact buyer account identity", () => {
  const sellerSnapshot = snapshot();
  let missingConsentRejected = false;
  try {
    prepareGitHubTransferIntent({
      sellerSnapshot,
      expectation: EXPECTATION,
      buyer: { id: 200, login: "buyer", type: "User" },
      buyerAuthenticatedAccount: BUYER_ACTOR,
      sellerAuthenticatedAccount: SELLER_ACTOR,
      sellerConsentRecorded: true,
      buyerConsentRecorded: false,
    });
  } catch (error) {
    missingConsentRejected = error instanceof GitHubAdapterError;
  }
  if (!missingConsentRejected) throw new Error("Missing buyer consent must prevent transfer intent.");

  let wrongBuyerRejected = false;
  try {
    prepareGitHubTransferIntent({
      sellerSnapshot,
      expectation: EXPECTATION,
      buyer: { id: 201, login: "buyer", type: "User" },
      buyerAuthenticatedAccount: { id: 201, login: "buyer", type: "User" },
      sellerAuthenticatedAccount: SELLER_ACTOR,
      sellerConsentRecorded: true,
      buyerConsentRecorded: true,
    });
  } catch (error) {
    wrongBuyerRejected = error instanceof GitHubAdapterError;
  }
  if (!wrongBuyerRejected) throw new Error("Buyer account ID mismatch must be rejected.");

  const intent = prepareGitHubTransferIntent({
    sellerSnapshot,
    expectation: EXPECTATION,
    buyer: { id: 200, login: "buyer", type: "User" },
    sellerAuthenticatedAccount: SELLER_ACTOR,
    sellerConsentRecorded: true,
    buyerConsentRecorded: true,
  });
  if (intent.executionEnabled !== false || intent.requestBody.new_owner !== "buyer" ||
      intent.requiresBuyerAcceptance !== true) {
    throw new Error("Transfer intent must remain non-executable and record buyer acceptance requirement.");
  }
});

Deno.test("forked or disabled repositories cannot produce a transfer intent", () => {
  for (const changes of [{ fork: true }, { disabled: true }]) {
    let rejected = false;
    try {
      prepareGitHubTransferIntent({
        sellerSnapshot: snapshot(changes),
        expectation: EXPECTATION,
        buyer: { id: 200, login: "buyer", type: "User" },
        sellerAuthenticatedAccount: SELLER_ACTOR,
        sellerConsentRecorded: true,
        buyerConsentRecorded: true,
      });
    } catch (error) {
      rejected = error instanceof GitHubAdapterError;
    }
    if (!rejected) throw new Error("Unsupported repository state must require review.");
  }
});

Deno.test("read-only fetch uses authenticated GET and does not expose token in URL", async () => {
  let observedUrl = "";
  let observedAuthorization = "";
  let observedMethod = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    observedUrl = String(input);
    observedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
    observedMethod = init?.method ?? "GET";
    return new Response(JSON.stringify(RAW), {
      status: 200,
      headers: {
        "content-type": "application/json",
        etag: '"fresh-etag"',
        "x-github-request-id": "req-456",
      },
    });
  };

  const result = await fetchGitHubRepositorySnapshot({
    ownerLogin: "seller",
    repositoryName: "sample-project",
    serverToken: "server-only-token",
    fetchImpl,
    now: NOW,
  });
  if (!observedUrl.endsWith("/repos/seller/sample-project") ||
      observedUrl.includes("server-only-token") ||
      observedAuthorization !== "Bearer server-only-token" ||
      observedMethod !== "GET" || result.id !== 12345) {
    throw new Error("GitHub adapter did not perform a server-authenticated read-only GET.");
  }
});

Deno.test("GitHub API errors are surfaced without leaking response body", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("private provider payload", { status: 403, headers: { "x-github-request-id": "req-denied" } });

  try {
    await fetchGitHubRepositorySnapshot({
      ownerLogin: "seller",
      repositoryName: "sample-project",
      serverToken: "server-only-token",
      fetchImpl,
      now: NOW,
    });
    throw new Error("Expected GitHub API failure.");
  } catch (error) {
    if (!(error instanceof GitHubAdapterError) || error.status !== 403 ||
        error.requestId !== "req-denied" || error.message.includes("private provider payload")) {
      throw new Error("GitHub API error handling leaked or lost diagnostic metadata.");
    }
  }
});

Deno.test("future-dated provider metadata is rejected", () => {
  let rejected = false;
  try {
    snapshot({ updated_at: "2026-11-06T19:00:00.000Z" });
  } catch (error) {
    rejected = error instanceof GitHubAdapterError;
  }
  if (!rejected) throw new Error("Future-dated provider metadata must be rejected.");
});


Deno.test("authenticated-user endpoint resolves the token actor identity", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    if (String(input) !== "https://api.github.com/user" ||
        new Headers(init?.headers).get("authorization") !== "Bearer server-only-token") {
      throw new Error("Unexpected authenticated-user request.");
    }
    return new Response(JSON.stringify({ id: 100, login: "seller", type: "User" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const account = await fetchGitHubAuthenticatedAccount({ serverToken: "server-only-token", fetchImpl });
  if (account.id !== 100 || account.login !== "seller") {
    throw new Error("GitHub authenticated actor identity was not normalized.");
  }
});


Deno.test("verified GitHub seller read becomes a hashed W3M ownership event", async () => {
  const ownership = { repository: snapshot(), authenticatedAccount: SELLER_ACTOR };
  const event = await createGitHubOwnershipVerifiedEvent({
    ownership,
    expectation: EXPECTATION,
    phase: "SELLER",
    dealId: "deal-1",
    projectId: "project-1",
    assetId: "github-asset-1",
    sellerIdentity: "seller-account",
    buyerIdentity: "buyer-account",
    now: NOW,
  });
  const state = createAssetTransferState({
    assetId: "github-asset-1",
    dealId: "deal-1",
    projectId: "project-1",
    kind: "GITHUB_REPOSITORY",
    sourceProvider: "github",
    sourceAssetRef: "seller/sample-project",
    sellerIdentity: "seller-account",
    buyerIdentity: "buyer-account",
    mandatory: true,
  });
  const applied = applyAssetTransferEvent(state, event, "2026-11-05T20:00:30.000Z");
  if (!applied.accepted || applied.state.status !== "SELLER_CONTROL_VERIFIED" ||
      !/^[0-9a-f]{64}$/.test(event.proofHash) || event.authoritative !== true) {
    throw new Error("Verified GitHub ownership proof did not advance the W3M asset lifecycle.");
  }
});

Deno.test("GitHub buyer evidence requires a fresh provider read of the exact buyer owner", async () => {
  const buyerRepository = normalizeGitHubRepository(
    {
      ...RAW,
      full_name: "buyer/sample-project",
      owner: { id: 200, login: "buyer", type: "User" },
    },
    new Headers({ etag: '"buyer-repo-etag"' }),
    NOW,
  );
  const event = await createGitHubOwnershipVerifiedEvent({
    ownership: { repository: buyerRepository, authenticatedAccount: BUYER_ACTOR },
    expectation: EXPECTATION,
    phase: "BUYER",
    dealId: "deal-1",
    projectId: "project-1",
    assetId: "github-asset-1",
    sellerIdentity: "seller-account",
    buyerIdentity: "buyer-account",
    now: NOW,
  });
  if (event.eventType !== "BUYER_CONTROL_VERIFIED" ||
      event.currentOwnerIdentity !== "buyer-account") {
    throw new Error("Buyer ownership proof did not bind to the new owner.");
  }
});

Deno.test("stale GitHub repository snapshot cannot be timestamped as a fresh ownership proof", async () => {
  let rejected = false;
  try {
    await createGitHubOwnershipVerifiedEvent({
      ownership: { repository: snapshot(), authenticatedAccount: SELLER_ACTOR },
      expectation: EXPECTATION,
      phase: "SELLER",
      dealId: "deal-1",
      projectId: "project-1",
      assetId: "github-asset-1",
      sellerIdentity: "seller-account",
      buyerIdentity: "buyer-account",
      now: "2026-11-05T20:01:00.000Z",
    });
  } catch (error) {
    rejected = error instanceof GitHubAdapterError;
  }
  if (!rejected) throw new Error("A stale repository read must not be repackaged as fresh evidence.");
});


Deno.test("repeated reads of the same GitHub repository version are idempotent", async () => {
  const firstEvent = await createGitHubOwnershipVerifiedEvent({
    ownership: { repository: snapshot(), authenticatedAccount: SELLER_ACTOR },
    expectation: EXPECTATION,
    phase: "SELLER",
    dealId: "deal-1",
    projectId: "project-1",
    assetId: "github-asset-1",
    sellerIdentity: "seller-account",
    buyerIdentity: "buyer-account",
    now: NOW,
  });
  const laterRead = normalizeGitHubRepository(
    RAW,
    new Headers({ etag: '"repo-etag"', "x-github-request-id": "request-456" }),
    "2026-11-05T20:01:00.000Z",
  );
  const replayEvent = await createGitHubOwnershipVerifiedEvent({
    ownership: { repository: laterRead, authenticatedAccount: SELLER_ACTOR },
    expectation: EXPECTATION,
    phase: "SELLER",
    dealId: "deal-1",
    projectId: "project-1",
    assetId: "github-asset-1",
    sellerIdentity: "seller-account",
    buyerIdentity: "buyer-account",
    now: "2026-11-05T20:01:00.000Z",
  });
  const state = createAssetTransferState({
    assetId: "github-asset-1",
    dealId: "deal-1",
    projectId: "project-1",
    kind: "GITHUB_REPOSITORY",
    sourceProvider: "github",
    sourceAssetRef: "seller/sample-project",
    sellerIdentity: "seller-account",
    buyerIdentity: "buyer-account",
    mandatory: true,
  });
  const first = applyAssetTransferEvent(state, firstEvent, "2026-11-05T20:00:30.000Z");
  const replay = applyAssetTransferEvent(first.state, replayEvent, "2026-11-05T20:01:30.000Z");
  if (!first.accepted || !replay.accepted || !replay.idempotent ||
      firstEvent.eventId !== replayEvent.eventId || firstEvent.proofHash !== replayEvent.proofHash) {
    throw new Error("Identical GitHub source versions must replay idempotently.");
  }
});


Deno.test("GitHub seller proof, transfer confirmation, and buyer proof complete one W3M asset", async () => {
  const definition = {
    assetId: "github-asset-1",
    dealId: "deal-1",
    projectId: "project-1",
    kind: "GITHUB_REPOSITORY" as const,
    sourceProvider: "github",
    sourceAssetRef: "seller/sample-project",
    sellerIdentity: "seller-account",
    buyerIdentity: "buyer-account",
    mandatory: true,
  };
  let state = createAssetTransferState(definition);
  const sellerProof = await createGitHubOwnershipVerifiedEvent({
    ownership: { repository: snapshot(), authenticatedAccount: SELLER_ACTOR },
    expectation: EXPECTATION,
    phase: "SELLER",
    dealId: definition.dealId,
    projectId: definition.projectId,
    assetId: definition.assetId,
    sellerIdentity: definition.sellerIdentity,
    buyerIdentity: definition.buyerIdentity,
    now: NOW,
  });
  let transition = applyAssetTransferEvent(state, sellerProof, "2026-11-05T20:00:30.000Z");
  if (!transition.accepted) throw new Error("Seller proof was rejected.");
  state = transition.state;

  const transferRequest = {
    eventId: "github-transfer-request-1",
    eventType: "TRANSFER_REQUESTED" as const,
    assetId: definition.assetId,
    dealId: definition.dealId,
    projectId: definition.projectId,
    sourceProvider: "github",
    sourceRecordId: "12345",
    sourceVersion: "transfer-request-v1",
    sourceEventId: "github-transfer-request-1",
    proofHash: "c".repeat(64),
    observedAt: "2026-11-05T20:00:40.000Z",
    validUntil: "2026-11-05T20:05:40.000Z",
    authoritative: true,
    fromIdentity: definition.sellerIdentity,
    toIdentity: definition.buyerIdentity,
  };
  transition = applyAssetTransferEvent(state, transferRequest, "2026-11-05T20:00:50.000Z");
  if (!transition.accepted) throw new Error("Transfer request event was rejected.");
  state = transition.state;

  const buyerRepository = normalizeGitHubRepository(
    { ...RAW, full_name: "buyer/sample-project", owner: { id: 200, login: "buyer", type: "User" } },
    new Headers({ etag: '"buyer-version-1"' }),
    "2026-11-05T20:01:00.000Z",
  );
  const buyerOwnership = { repository: buyerRepository, authenticatedAccount: BUYER_ACTOR };
  const confirmed = await createGitHubTransferConfirmedEvent({
    ownership: buyerOwnership,
    expectation: EXPECTATION,
    dealId: definition.dealId,
    projectId: definition.projectId,
    assetId: definition.assetId,
    sellerIdentity: definition.sellerIdentity,
    buyerIdentity: definition.buyerIdentity,
    now: "2026-11-05T20:01:00.000Z",
  });
  transition = applyAssetTransferEvent(state, confirmed, "2026-11-05T20:01:30.000Z");
  if (!transition.accepted) throw new Error("Provider transfer confirmation was rejected.");
  state = transition.state;

  const finalBuyerRead = normalizeGitHubRepository(
    { ...RAW, full_name: "buyer/sample-project", owner: { id: 200, login: "buyer", type: "User" } },
    new Headers({ etag: '"buyer-version-2"' }),
    "2026-11-05T20:02:00.000Z",
  );
  const buyerProof = await createGitHubOwnershipVerifiedEvent({
    ownership: { repository: finalBuyerRead, authenticatedAccount: BUYER_ACTOR },
    expectation: EXPECTATION,
    phase: "BUYER",
    dealId: definition.dealId,
    projectId: definition.projectId,
    assetId: definition.assetId,
    sellerIdentity: definition.sellerIdentity,
    buyerIdentity: definition.buyerIdentity,
    now: "2026-11-05T20:02:00.000Z",
  });
  transition = applyAssetTransferEvent(state, buyerProof, "2026-11-05T20:02:30.000Z");
  if (!transition.accepted) throw new Error("Final buyer ownership proof was rejected.");
  state = transition.state;

  const portfolio = evaluateAssetPortfolio([state]);
  if (portfolio.status !== "PASS" || state.status !== "BUYER_CONTROL_VERIFIED") {
    throw new Error("The verified GitHub ownership lifecycle did not complete.");
  }
});
