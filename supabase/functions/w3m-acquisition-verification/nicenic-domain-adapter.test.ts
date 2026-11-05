import {
  createNiceNicSellerControlEvent,
  fetchNiceNicDomainSnapshot,
  NiceNicAdapterError,
  verifyNiceNicSellerControl,
} from "./nicenic-domain-adapter.ts";

const NOW = "2026-11-05T20:00:00.000Z";
const DOMAIN = "web3market.xyz";
const USERNAME = "seller-nicenic-account";

function niceNicFetch(options: {
  includeDomain?: boolean;
  totalPages?: number;
  status?: string;
  hold?: number;
  detailsDomain?: string;
} = {}): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== "api.nicenic.net" || init?.method !== "GET" ||
        new Headers(init?.headers).get("authorization") !== USERNAME + ":server-only-secret") {
      throw new Error("Unexpected NiceNIC request or credential handling.");
    }
    if (url.searchParams.get("action") === "domain_list") {
      return new Response(JSON.stringify({
        code: 0,
        msg: "success",
        data: {
          options: { total_pages: options.totalPages ?? 1 },
          domain_list: options.includeDomain === false ? [] : [{
            domain: DOMAIN,
            status: options.status ?? "active",
            hold: options.hold ?? 0,
            nameservers: ["ns1.example.net", "ns2.example.net"],
          }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.searchParams.get("action") === "info") {
      return new Response(JSON.stringify({
        code: 0,
        msg: "success",
        data: {
          domain: options.detailsDomain ?? DOMAIN,
          created_date: "2025-01-01",
          expired_date: "2027-01-01",
          nameservers: ["ns1.example.net", "ns2.example.net"],
          contacts: { registrant: { name: "Redacted" } },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("Unexpected NiceNIC API action.");
  };
}

Deno.test("reads NiceNIC account membership and domain details without changing the domain", async () => {
  const snapshot = await fetchNiceNicDomainSnapshot({
    username: USERNAME,
    apiSecret: "server-only-secret",
    domain: DOMAIN,
    fetchImpl: niceNicFetch(),
    now: NOW,
  });
  if (!snapshot.accountHasDomain || !snapshot.accountListComplete ||
      snapshot.status !== "active" || snapshot.hold !== false ||
      snapshot.domain !== DOMAIN || !snapshot.registrantContactPresent) {
    throw new Error("NiceNIC read-only domain snapshot is incomplete.");
  }
});

Deno.test("registrar account control alone is not legal registrant identity proof", async () => {
  const snapshot = await fetchNiceNicDomainSnapshot({
    username: USERNAME,
    apiSecret: "server-only-secret",
    domain: DOMAIN,
    fetchImpl: niceNicFetch(),
    now: NOW,
  });
  const result = verifyNiceNicSellerControl(
    snapshot,
    { domain: DOMAIN, sellerAccountUsername: USERNAME },
    false,
  );
  if (result.status !== "REGISTRANT_IDENTITY_UNVERIFIED") {
    throw new Error("Account access must not be misrepresented as registrant identity verification.");
  }
});

Deno.test("seller control requires account membership, active status, no hold and trusted identity match", async () => {
  const snapshot = await fetchNiceNicDomainSnapshot({
    username: USERNAME,
    apiSecret: "server-only-secret",
    domain: DOMAIN,
    fetchImpl: niceNicFetch(),
    now: NOW,
  });
  const result = verifyNiceNicSellerControl(
    snapshot,
    { domain: DOMAIN, sellerAccountUsername: USERNAME },
    true,
  );
  if (result.status !== "SELLER_CONTROL_VERIFIED") throw new Error("Expected verified seller domain control.");
});

Deno.test("domain absent from a complete account listing is not seller control", async () => {
  const snapshot = await fetchNiceNicDomainSnapshot({
    username: USERNAME,
    apiSecret: "server-only-secret",
    domain: DOMAIN,
    fetchImpl: niceNicFetch({ includeDomain: false }),
    now: NOW,
  });
  const result = verifyNiceNicSellerControl(
    snapshot,
    { domain: DOMAIN, sellerAccountUsername: USERNAME },
    true,
  );
  if (result.status !== "DOMAIN_NOT_IN_ACCOUNT") throw new Error("Domain absent from account must not verify.");
});

Deno.test("inactive or held domains are rejected", async () => {
  for (const options of [{ status: "expired" }, { hold: 1 }]) {
    const snapshot = await fetchNiceNicDomainSnapshot({
      username: USERNAME,
      apiSecret: "server-only-secret",
      domain: DOMAIN,
      fetchImpl: niceNicFetch(options),
      now: NOW,
    });
    const result = verifyNiceNicSellerControl(
      snapshot,
      { domain: DOMAIN, sellerAccountUsername: USERNAME },
      true,
    );
    if (result.status !== "DOMAIN_INACTIVE") throw new Error("Inactive or held domain must be rejected.");
  }
});

Deno.test("NiceNIC seller control can emit a W3M ownership event only after identity match", async () => {
  const snapshot = await fetchNiceNicDomainSnapshot({
    username: USERNAME,
    apiSecret: "server-only-secret",
    domain: DOMAIN,
    fetchImpl: niceNicFetch(),
    now: NOW,
  });
  const event = await createNiceNicSellerControlEvent({
    snapshot,
    expectedSellerAccountUsername: USERNAME,
    dealId: "deal-1",
    projectId: "project-1",
    assetId: "domain-asset-1",
    sellerIdentity: "seller-account",
    buyerIdentity: "buyer-account",
    registrantIdentityMatched: true,
    now: NOW,
  });
  if (event.eventType !== "SELLER_CONTROL_VERIFIED" ||
      event.sourceProvider !== "nicenic" ||
      !/^[0-9a-f]{64}$/.test(event.proofHash)) {
    throw new Error("NiceNIC control evidence was not normalized for W3M.");
  }
});

Deno.test("domain details response must match the requested domain", async () => {
  let rejected = false;
  try {
    await fetchNiceNicDomainSnapshot({
      username: USERNAME,
      apiSecret: "server-only-secret",
      domain: DOMAIN,
      fetchImpl: niceNicFetch({ detailsDomain: "other-domain.xyz" }),
      now: NOW,
    });
  } catch (error) {
    rejected = error instanceof NiceNicAdapterError;
  }
  if (!rejected) throw new Error("Domain response substitution must be rejected.");
});

Deno.test("invalid API credentials are not placed in URL parameters", async () => {
  let observedUrl = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    observedUrl = String(input);
    if (new Headers(init?.headers).get("authorization") !== USERNAME + ":secret-value") {
      throw new Error("Authorization header missing.");
    }
    const url = new URL(observedUrl);
    if (url.searchParams.has("api_secret") || url.searchParams.has("password")) {
      throw new Error("Secret leaked into URL.");
    }
    if (url.searchParams.get("action") === "domain_list") {
      return new Response(JSON.stringify({
        code: 0, data: { options: { total_pages: 1 }, domain_list: [] },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      code: 0, data: { domain: DOMAIN, nameservers: [], contacts: {} },
    }), { status: 200 });
  };
  await fetchNiceNicDomainSnapshot({
    username: USERNAME,
    apiSecret: "secret-value",
    domain: DOMAIN,
    fetchImpl,
    now: NOW,
  });
  if (observedUrl.includes("secret-value")) throw new Error("NiceNIC secret leaked into URL.");
});


Deno.test("NiceNIC event cannot substitute another registrar account", async () => {
  const snapshot = await fetchNiceNicDomainSnapshot({
    username: USERNAME,
    apiSecret: "server-only-secret",
    domain: DOMAIN,
    fetchImpl: niceNicFetch(),
    now: NOW,
  });
  let rejected = false;
  try {
    await createNiceNicSellerControlEvent({
      snapshot,
      expectedSellerAccountUsername: "different-account",
      dealId: "deal-1",
      projectId: "project-1",
      assetId: "domain-asset-1",
      sellerIdentity: "seller-account",
      buyerIdentity: "buyer-account",
      registrantIdentityMatched: true,
      now: NOW,
    });
  } catch (error) {
    rejected = error instanceof NiceNicAdapterError;
  }
  if (!rejected) throw new Error("Registrar account mismatch must not produce ownership evidence.");
});
