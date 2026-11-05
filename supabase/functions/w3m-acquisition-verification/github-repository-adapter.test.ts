import {
  fetchGitHubRepositorySnapshot,
  GitHubAdapterError,
  normalizeGitHubRepository,
  prepareGitHubTransferIntent,
  verifyGitHubRepositoryOwner,
  type GitHubRepositorySnapshot,
} from "./github-repository-adapter.ts";

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
  const verified = verifyGitHubRepositoryOwner(snapshot(), EXPECTATION, "SELLER");
  if (verified.status !== "SELLER_CONTROL_VERIFIED") throw new Error("Expected seller ownership verification.");

  const noAdmin = verifyGitHubRepositoryOwner(
    snapshot({ permissions: { admin: false } }),
    EXPECTATION,
    "SELLER",
  );
  if (noAdmin.status !== "ADMIN_CONTROL_UNVERIFIED") throw new Error("Admin control must be required.");

  const wrongRepo = verifyGitHubRepositoryOwner(
    snapshot({ id: 99999 }),
    EXPECTATION,
    "SELLER",
  );
  if (wrongRepo.status !== "REPOSITORY_MISMATCH") throw new Error("Repository substitution must be rejected.");
});

Deno.test("buyer ownership is not verified from collaborator or admin permission alone", () => {
  const collaborator = verifyGitHubRepositoryOwner(
    snapshot({ owner: { id: 100, login: "seller", type: "User" }, permissions: { admin: true } }),
    EXPECTATION,
    "BUYER",
  );
  if (collaborator.status !== "OWNER_MISMATCH") {
    throw new Error("Buyer must be the actual repository owner, not merely an administrator.");
  }

  const buyerOwner = verifyGitHubRepositoryOwner(
    snapshot({ owner: { id: 200, login: "buyer", type: "User" }, permissions: { admin: true } }),
    EXPECTATION,
    "BUYER",
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
