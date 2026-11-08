import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Wallet } from "npm:ethers@6.15.0";

const url = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !anonKey || !serviceKey) throw new Error("Local Supabase integration environment is incomplete.");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const endpoint = url + "/functions/v1/w3m-acquisition-verification";
const projectId = "72000000-0000-4000-8000-000000000002";
const dealId = "71000000-0000-4000-8000-000000000001";
const auditId = "73000000-0000-4000-8000-000000000003";
const commitSha = "f".repeat(40);
const sellerWallet = new Wallet("0x" + "1".repeat(64));
const buyerWallet = new Wallet("0x" + "2".repeat(64));
const password = "W3M-Local-Integration-Only-2026!";

type TestUser = {
  id: string;
  email: string;
  accessToken: string;
  wallet: Wallet;
  client: SupabaseClient;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function createTestUser(label: string, wallet: Wallet): Promise<TestUser> {
  const email = label + "-" + crypto.randomUUID() + "@example.test";
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error("Unable to create local integration user: " + (created.error?.message || "missing user"));
  }
  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) {
    throw new Error("Unable to sign in local integration user: " + (signedIn.error?.message || "missing session"));
  }
  return {
    id: created.data.user.id,
    email,
    accessToken: signedIn.data.session.access_token,
    wallet,
    client,
  };
}

async function call(user: TestUser, body: Record<string, unknown>) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: anonKey!,
      Authorization: "Bearer " + user.accessToken,
      "Content-Type": "application/json",
      Origin: "https://web3market.xyz",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

async function signPrepared(user: TestUser) {
  const prepared = await call(user, {
    action: "prepare",
    deal_id: dealId,
    wallet_address: user.wallet.address,
  });
  assert(prepared.status === 200 && prepared.payload.ok === true,
    "Agreement preparation failed: " + JSON.stringify(prepared.payload));
  const data = prepared.payload.result;
  const signature = await user.wallet.signTypedData(
    data.typedData.domain,
    { DealTermsAcceptance: data.typedData.types.DealTermsAcceptance },
    data.typedData.message,
  );
  const accepted = await call(user, {
    action: "accept",
    challenge_id: data.challengeId,
    signature,
  });
  assert(accepted.status === 200 && accepted.payload.ok === true,
    "EIP-712 acceptance failed: " + JSON.stringify(accepted.payload));
  return { challengeId: data.challengeId, signature };
}

const createdUsers: TestUser[] = [];
try {
  const seller = await createTestUser("w3m-seller", sellerWallet);
  createdUsers.push(seller);
  const buyer = await createTestUser("w3m-buyer", buyerWallet);
  createdUsers.push(buyer);
  const outsider = await createTestUser("w3m-outsider", new Wallet("0x" + "3".repeat(64)));
  createdUsers.push(outsider);

  const profileRows = [
    { id: seller.id, wallet_address: seller.wallet.address, wallet_verified: true },
    { id: buyer.id, wallet_address: buyer.wallet.address, wallet_verified: true },
    { id: outsider.id, wallet_address: outsider.wallet.address, wallet_verified: true },
  ];
  const profiles = await admin.from("profiles").insert(profileRows);
  assert(!profiles.error, "Unable to seed verified test wallets: " + (profiles.error?.message || ""));

  const project = await admin.from("projects").insert({ id: projectId, owner_id: seller.id });
  assert(!project.error, "Unable to seed test project: " + (project.error?.message || ""));
  const deal = await admin.from("deals").insert({
    id: dealId,
    project_id: projectId,
    buyer_id: buyer.id,
    seller_id: seller.id,
    status: "pending",
    dispute_status: "none",
    release_tx_hash: null,
  });
  assert(!deal.error, "Unable to seed test deal: " + (deal.error?.message || ""));

  const audit = await admin.from("code_audits").insert({
    id: auditId,
    project_id: projectId,
    status: "completed",
    repo_owner: "integration-tests",
    repo_name: "w3m-fixture",
    commit_sha: commitSha,
    engine_version: "w3m-integration-fixture",
    audit_type: "full",
    files_scanned: 1,
    lines_scanned: 12,
    overall_score: 85,
    security_score: 86,
    architecture_score: 84,
    code_quality_score: 85,
    dependency_score: 83,
    testing_score: 80,
    documentation_score: 82,
    web3_score: 85,
    scalability_score: 81,
    ai_fit_score: 80,
    risk_level: "LOW",
    summary: "Synthetic local integration fixture; not a real audit.",
  });
  assert(!audit.error, "Unable to seed completed audit: " + (audit.error?.message || ""));
  const auditFile = await admin.from("code_audit_files").insert({
    audit_id: auditId,
    path: "src/index.ts",
    sha: "a".repeat(40),
    language: "TypeScript",
    size_bytes: 128,
    line_count: 12,
    selected_tier: 0,
    scanned: true,
  });
  assert(!auditFile.error, "Unable to seed scanned audit file: " + (auditFile.error?.message || ""));

  const fingerprint = await call(seller, {
    action: "publish_fingerprint_binding",
    deal_id: dealId,
    audit_id: auditId,
  });
  assert(fingerprint.status === 201 && fingerprint.payload.ok === true,
    "Persisted audit fingerprint publication failed: " + JSON.stringify(fingerprint.payload));

  const terms = {
    schema: "w3m-acquisition-terms-v1",
    terms_version: 1,
    deal: {
      deal_id: dealId,
      project_id: projectId,
      buyer_id: buyer.id,
      seller_id: seller.id,
    },
    project: { title: "Synthetic W3M integration project", category: "SaaS" },
    audit: {
      audit_id: auditId,
      repository: "integration-tests/w3m-fixture",
      commit_sha: commitSha,
      fingerprint_digest: fingerprint.payload.fingerprint_digest,
    },
    consideration: { amount: "1000.00", currency: "USDT" },
    platform_fee: { percent: "7.5", amount: "75.00" },
    seller_net: { amount: "925.00", currency: "USDT" },
    payment: {
      method: "safe_multisig",
      chain_id: 56,
      asset: "USDT",
      token_contract: null,
      safe_address: null,
      status_at_signing: "configured_or_pending",
    },
    transfer_scope: {
      included_assets: [{ type: "repository", description: "Synthetic source repository" }],
      excluded_assets: [],
      third_party_dependencies: [],
      access_and_credentials: { transfer_method: "Synthetic repository handover" },
      intellectual_property: { declaration: "Synthetic test fixture only" },
      data_and_privacy: { scope: "No real user data" },
    },
    delivery: {
      deadline: "2027-01-01T00:00:00Z",
      checklist: ["Transfer the synthetic source repository"],
    },
    inspection: {
      enabled: true,
      window: "5 days",
      acceptance_criteria: ["Repository access received"],
    },
    dispute: {
      procedure_version: "integration-test-v1",
      text: "Synthetic test-only dispute procedure; not legal terms.",
    },
    escrow: {
      funding_condition: "Test-only Safe funding condition",
      release_condition: "Test-only Safe release condition",
      dispute_hold: true,
    },
    governing_terms: {
      governing_law: "Synthetic test-only jurisdiction",
      venue_or_process: "Synthetic test-only process",
      language: "English",
    },
    risk_acknowledgements: ["Synthetic integration test only; no actual ownership or transaction."],
    disclosures: [],
    created_at: "2026-11-08T00:00:00Z",
    expires_at: "2026-11-09T00:00:00Z",
  };

  const publishedTerms = await call(seller, {
    action: "publish_terms",
    deal_id: dealId,
    terms,
  });
  assert(publishedTerms.status === 201 && publishedTerms.payload.ok === true,
    "Canonical terms publication or asset checklist sync failed: " + JSON.stringify(publishedTerms.payload));

  // The private schema must remain unavailable through PostgREST even to the
  // service-role API client. The Edge Function uses only its restricted RPC.
  const privateRead = await admin.schema("w3m_private")
    .from("w3m_deal_audit_bindings").select("deal_id").limit(1);
  assert(privateRead.error?.code === "PGRST106",
    "w3m_private unexpectedly became exposed through the Data API.");

  const buyerAcceptance = await signPrepared(buyer);
  const sellerAcceptance = await signPrepared(seller);

  const replay = await call(buyer, {
    action: "accept",
    challenge_id: buyerAcceptance.challengeId,
    signature: buyerAcceptance.signature,
  });
  assert(replay.status === 409, "Consumed agreement challenge was not rejected on replay.");

  // Test-only lifecycle transition: this disposable local fixture simulates
  // the post-funding stage without creating or broadcasting any Safe transaction.
  const fundedFixture = await admin.from("deals").update({ status: "funded" })
    .eq("id", dealId).select("id").single();
  assert(!fundedFixture.error && fundedFixture.data?.id === dealId,
    "Unable to move the local-only fixture into its post-funding delivery stage.");

  const outsiderStatus = await call(outsider, { action: "status", deal_id: dealId });
  assert(outsiderStatus.status === 403, "Non-participant was able to read agreement status.");

  const beforeDelivery = await call(buyer, { action: "status", deal_id: dealId });
  assert(beforeDelivery.status === 200 && beforeDelivery.payload.result?.both_accepted === true,
    "Buyer/seller acceptance pair was not visible through the real Edge Function.");
  const asset = beforeDelivery.payload.result.assets?.[0];
  assert(asset?.status === "pending" && asset.asset_id,
    "Published agreement did not create its individual pending asset checklist.");

  const delivery = await call(seller, {
    action: "asset_transition",
    deal_id: dealId,
    asset_id: asset.asset_id,
    asset_action: "deliver",
    delivery_url: "https://example.invalid/synthetic-repository",
    evidence: "Synthetic delivery evidence only; no credentials or private keys.",
  });
  assert(delivery.status === 200 && delivery.payload.result?.status === "delivered",
    "Seller delivery transition failed: " + JSON.stringify(delivery.payload));

  const acceptance = await call(buyer, {
    action: "asset_transition",
    deal_id: dealId,
    asset_id: asset.asset_id,
    asset_action: "accept",
  });
  assert(acceptance.status === 200 && acceptance.payload.result?.status === "accepted",
    "Buyer per-asset acceptance failed: " + JSON.stringify(acceptance.payload));

  const finalConfirmation = await call(buyer, {
    action: "confirm_delivery",
    deal_id: dealId,
  });
  assert(finalConfirmation.status === 200 &&
    finalConfirmation.payload.result?.asset_count === 1 &&
    finalConfirmation.payload.result?.created === true,
    "Buyer final delivery confirmation failed: " + JSON.stringify(finalConfirmation.payload));

  const confirmationReplay = await call(buyer, {
    action: "confirm_delivery",
    deal_id: dealId,
  });
  assert(confirmationReplay.status === 200 &&
    confirmationReplay.payload.result?.created === false &&
    confirmationReplay.payload.result?.confirmation_id === finalConfirmation.payload.result?.confirmation_id,
    "Final delivery confirmation retry was not idempotent.");

  const finalStatus = await call(buyer, { action: "status", deal_id: dealId });
  assert(finalStatus.status === 200 &&
    finalStatus.payload.result?.assets?.[0]?.status === "accepted" &&
    finalStatus.payload.result?.both_accepted === true &&
    finalStatus.payload.result?.final_delivery_confirmation?.confirmed === true &&
    finalStatus.payload.result?.final_delivery_confirmation?.asset_count === 1,
    "Final agreement, asset state, and buyer confirmation did not survive the real Edge Function/PostgREST round trip.");

  const serialized = JSON.stringify(finalStatus.payload);
  assert(!serialized.includes(buyerAcceptance.signature) &&
    !serialized.includes(sellerAcceptance.signature) &&
    !serialized.includes("challenge_id") &&
    !serialized.includes("Synthetic delivery evidence only"),
    "Private signature, challenge, or raw delivery evidence leaked from the status endpoint.");

  console.log("W3M V1 local Supabase integration passed: Auth, audit binding, terms publication, private RPC, EIP-712 acceptance, replay rejection, participant authorization, per-asset delivery and acceptance.");
} finally {
  for (const user of createdUsers) {
    await admin.auth.admin.deleteUser(user.id);
  }
}
