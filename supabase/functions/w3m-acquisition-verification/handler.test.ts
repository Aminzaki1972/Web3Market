import { Wallet } from "npm:ethers@6.15.0";
import { buildW3MAgreementTypedData } from "./agreement-signature.ts";
import { hashW3MAcquisitionTermsV1 } from "./acquisition-terms.ts";
import { createW3MAcquisitionHandler, type W3MAdminClient } from "./handler.ts";

const USER_ID = "75000000-0000-4000-8000-000000000005";
const DEAL_ID = "71000000-0000-4000-8000-000000000001";
const PROJECT_ID = "72000000-0000-4000-8000-000000000002";
const AUDIT_ID = "73000000-0000-4000-8000-000000000003";
const FINGERPRINT_ID = "74000000-0000-4000-8000-000000000004";
const CHALLENGE_ID = "77000000-0000-4000-8000-000000000007";
const ACCEPTANCE_ID = "78000000-0000-4000-8000-000000000008";
const DIGEST = "a".repeat(64);
const BINDING_HASH = "b".repeat(64);
const TERMS_HASH = "c".repeat(64);
const NOW = 1_900_000_000;
const DEADLINE = NOW + 600;

function uuidBytes32(value: string): string {
  return "0x" + value.replaceAll("-", "").padStart(64, "0");
}

function challengeRow(walletAddress: string) {
  return {
    id: CHALLENGE_ID,
    deal_id: DEAL_ID,
    project_id: PROJECT_ID,
    audit_id: AUDIT_ID,
    fingerprint_id: FINGERPRINT_ID,
    fingerprint_digest: DIGEST,
    binding_hash: BINDING_HASH,
    terms_hash: TERMS_HASH,
    terms_version: "2",
    party_role: "buyer" as const,
    user_id: USER_ID,
    wallet_address: walletAddress,
    nonce: "0x" + "d".repeat(64),
    signature_deadline: DEADLINE,
    created_at: new Date((NOW - 5) * 1000).toISOString(),
    consumed_at: null,
  };
}

function makeRequest(body: unknown, authorization = "Bearer valid-user-token") {
  return new Request("https://web3market.xyz/functions/v1/w3m-acquisition-verification", {
    method: "POST",
    headers: {
      Authorization: authorization,
      Origin: "https://web3market.xyz",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function makeDeps(
  rpc: W3MAdminClient["rpc"],
  options: {
    userId?: string;
    randomBytes?: (length: number) => Uint8Array;
    from?: NonNullable<W3MAdminClient["from"]>;
  } = {},
) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: W3MAdminClient = {
    auth: {
      async getUser(token: string) {
        if (token !== "valid-user-token") return { data: { user: null }, error: new Error("bad token") };
        return { data: { user: { id: options.userId || USER_ID } }, error: null };
      },
    },
    async rpc(name, args) {
      calls.push({ name, args });
      return await rpc(name, args);
    },
    from: options.from,
  };
  return {
    calls,
    deps: {
      createAdminClient: () => client,
      getEnv: (name: string) => name === "SUPABASE_URL" ? "https://test.supabase.co" :
        name === "SUPABASE_SERVICE_ROLE_KEY" ? "service-role-test-key" : undefined,
      nowSeconds: () => NOW,
      randomBytes: options.randomBytes,
    },
  };
}

Deno.test("status action exposes only participant-scoped current terms and acceptance state", async () => {
  const sellerId = "76000000-0000-4000-8000-000000000006";
  const canonicalTerms = {
    schema: "w3m-acquisition-terms-v1", terms_version: 2,
    deal: { deal_id: DEAL_ID, project_id: PROJECT_ID, buyer_id: USER_ID, seller_id: sellerId },
    project: { title: "Synthetic project", category: "SaaS" },
    audit: { audit_id: AUDIT_ID, repository: "aminzaki1972/web3market", commit_sha: "f".repeat(40), fingerprint_digest: DIGEST },
    consideration: { amount: "1000.00", currency: "USDT" },
    platform_fee: { percent: "7.50", amount: "75.00" },
    seller_net: { amount: "925.00", currency: "USDT" },
    payment: { method: "safe_multisig", chain_id: 56, asset: "USDT", token_contract: null, safe_address: null, status_at_signing: "configured_or_pending" },
    transfer_scope: { included_assets: [{ type: "repository", description: "Source code" }], excluded_assets: [], access_and_credentials: { transfer_method: "Test-only handover" }, third_party_dependencies: [], intellectual_property: { declaration: "Test-only" }, data_and_privacy: { scope: "No personal data" } },
    delivery: { deadline: "2027-01-01T00:00:00Z", checklist: ["Transfer repository"] },
    inspection: { enabled: true, window: "5 days", acceptance_criteria: ["Access delivered"] },
    dispute: { procedure_version: "test-v1", text: "Synthetic dispute text for automated tests only" },
    escrow: { funding_condition: "Test Safe funding condition", release_condition: "Test release condition", dispute_hold: true },
    governing_terms: { governing_law: "Synthetic law text for automated tests", venue_or_process: "Synthetic process for automated tests", language: "English" },
    risk_acknowledgements: ["Audit is limited to scanned commit"], disclosures: [],
    created_at: "2026-11-07T00:00:00Z", expires_at: "2026-11-08T00:00:00Z",
  };
  const statusTermsHash = await hashW3MAcquisitionTermsV1(canonicalTerms);
  const rows: Record<string, Array<Record<string, unknown>>> = {
    deals: [{ id: DEAL_ID, buyer_id: USER_ID, seller_id: sellerId, project_id: PROJECT_ID, status: "pending", dispute_status: "none" }],
    w3m_acquisition_terms_versions: [{
      id: "75000000-0000-4000-8000-000000000005", deal_id: DEAL_ID, terms_version: 2,
      terms_hash: statusTermsHash, canonical_terms_json: canonicalTerms,
      status: "published", published_at: "2026-11-07T00:00:00Z",
    }],
    w3m_agreement_acceptances: [{
      deal_id: DEAL_ID, party_role: "buyer", user_id: USER_ID, terms_version: 2,
      terms_hash: statusTermsHash, accepted_at: "2026-11-07T01:00:00Z",
      signature: "0x" + "f".repeat(130), nonce: "private-nonce",
    }],
    deal_assets: [{
      id: "7a000000-0000-4000-8000-00000000000a",
      deal_id: DEAL_ID, asset_name: "repository: Source code", status: "delivered",
      delivery_url: "https://example.invalid/private-repo-reference",
      delivered_by: USER_ID, delivered_at: "2026-11-07T02:00:00Z",
      accepted_by: null, accepted_at: null, created_at: "2026-11-07T00:30:00Z",
      evidence: "must-not-be-returned",
    }],
  };
  const makeQuery = (table: string) => {
    let selected = [...(rows[table] || [])];
    return {
      select(_columns: string) { return this; },
      eq(column: string, value: unknown) { selected = selected.filter((row) => row[column] === value); return this; },
      order(_column: string) { return this; },
      async range(from: number, to: number) { return { data: selected.slice(from, to + 1), error: null }; },
      async maybeSingle() { return { data: selected[0] || null, error: null }; },
    };
  };
  const from = ((table: string) => makeQuery(table)) as NonNullable<W3MAdminClient["from"]>;
  const agreementContext = {
    binding: null,
    terms: {
      id: "75000000-0000-4000-8000-000000000005", terms_version: 2,
      terms_hash: statusTermsHash, canonical_terms_json: canonicalTerms,
      status: "published", published_at: "2026-11-07T00:00:00Z",
    },
    acceptances: [{
      party_role: "buyer", user_id: USER_ID, terms_version: 2,
      terms_hash: statusTermsHash, accepted_at: "2026-11-07T01:00:00Z",
      signature: "0x" + "f".repeat(130), nonce: "private-nonce",
    }],
  };
  const { deps } = makeDeps(async (name) => {
    if (name === "w3m_get_deal_agreement_context") return { data: agreementContext, error: null };
    if (name === "w3m_get_deal_asset_finalization_evidence") {
      return { data: [{
        deal_id: DEAL_ID,
        buyer_id: USER_ID,
        asset_rows: [{
          asset_id: "7a000000-0000-4000-8000-00000000000a",
          asset_name: "repository: Source code",
          status: "delivered",
          delivery_url: "https://example.invalid/private-repo-reference",
          delivered_by: USER_ID,
          delivered_at: "2026-11-07T02:00:00Z",
          accepted_by: null,
          accepted_at: null,
          events: [{
            event_type: "delivered", attempt_number: 1, actor_user_id: USER_ID,
            evidence_digest: "e".repeat(64), occurred_at: "2026-11-07T02:00:00Z",
          }],
        }],
      }], error: null };
    }
    return { data: null, error: null };
  }, { from });
  const handler = createW3MAcquisitionHandler(deps);
  const response = await handler(makeRequest({ action: "status", deal_id: DEAL_ID }));
  const body = await response.json();
  if (response.status !== 200 || body.ok !== true ||
      body.result?.acceptances?.buyer?.accepted !== true ||
      body.result?.acceptances?.seller?.accepted !== false ||
      body.result?.both_accepted !== false ||
      body.result?.current_terms?.terms_hash !== statusTermsHash ||
      !Array.isArray(body.result?.assets) || body.result.assets.length !== 1 ||
      body.result.assets[0]?.status !== "delivered" ||
      body.result.assets[0]?.events?.[0]?.evidence_digest !== "e".repeat(64)) {
    throw new Error("Participant status response did not report the exact published terms, acceptance state, and asset delivery history");
  }
  const serialized = JSON.stringify(body);
  if (serialized.includes("signature") || serialized.includes("private-nonce") ||
      serialized.includes("challenge_id") || serialized.includes("must-not-be-returned")) {
    throw new Error("Private signature or challenge material leaked through status action");
  }

  const { deps: foreignDeps } = makeDeps(async () => ({ data: null, error: null }), {
    from, userId: "79000000-0000-4000-8000-000000000009",
  });
  const foreignResponse = await createW3MAcquisitionHandler(foreignDeps)(
    makeRequest({ action: "status", deal_id: DEAL_ID }),
  );
  if (foreignResponse.status !== 403) throw new Error("Non-participant must not read agreement status");
});

Deno.test("legacy caller-supplied challenge action is retired", async () => {
  const { deps, calls } = makeDeps(async () => {
    throw new Error("Retired challenge action must not reach persistence RPCs");
  });
  const handler = createW3MAcquisitionHandler(deps);
  const response = await handler(makeRequest({
    action: "challenge",
    deal_id: DEAL_ID,
    project_id: PROJECT_ID,
    audit_id: AUDIT_ID,
    fingerprint_id: FINGERPRINT_ID,
    fingerprint_digest: DIGEST,
    binding_hash: BINDING_HASH,
    terms_hash: TERMS_HASH,
    terms_version: "2",
    party_role: "buyer",
    wallet_address: "0x" + "1".repeat(40),
  }));
  const body = await response.json();
  if (response.status !== 410 || body.ok !== false) {
    throw new Error("Legacy challenge action must be explicitly retired");
  }
  if (calls.length !== 0) throw new Error("Retired challenge action reached a persistence RPC");
});

Deno.test("prepare action derives role, wallet, audit binding, and published terms from trusted storage", async () => {
  const wallet = new Wallet("0x" + "6".repeat(64));
  const sellerId = "76000000-0000-4000-8000-000000000006";
  const terms = {
    schema: "w3m-acquisition-terms-v1", terms_version: 2,
    deal: { deal_id: DEAL_ID, project_id: PROJECT_ID, buyer_id: USER_ID, seller_id: sellerId },
    project: { title: "Synthetic project", category: "SaaS" },
    audit: { audit_id: AUDIT_ID, repository: "aminzaki1972/web3market", commit_sha: "f".repeat(40), fingerprint_digest: DIGEST },
    consideration: { amount: "1000.00", currency: "USDT" },
    platform_fee: { percent: "7.50", amount: "75.00" },
    seller_net: { amount: "925.00", currency: "USDT" },
    payment: { method: "safe_multisig", chain_id: 56, asset: "USDT", token_contract: null, safe_address: null, status_at_signing: "configured_or_pending" },
    transfer_scope: { included_assets: [{ type: "repository", description: "Source code" }], excluded_assets: [], access_and_credentials: { transfer_method: "Test-only handover" }, third_party_dependencies: [], intellectual_property: { declaration: "Test-only" }, data_and_privacy: { scope: "No personal data" } },
    delivery: { deadline: "2027-01-01T00:00:00Z", checklist: ["Transfer repository"] },
    inspection: { enabled: true, window: "5 days", acceptance_criteria: ["Access delivered"] },
    dispute: { procedure_version: "test-v1", text: "Synthetic dispute text for automated tests only" },
    escrow: { funding_condition: "Test Safe funding condition", release_condition: "Test release condition", dispute_hold: true },
    governing_terms: { governing_law: "Synthetic law text for automated tests", venue_or_process: "Synthetic process for automated tests", language: "English" },
    risk_acknowledgements: ["Audit is limited to scanned commit"], disclosures: [],
    created_at: "2026-11-07T00:00:00Z", expires_at: "2026-11-08T00:00:00Z",
  };
  const termsHash = await hashW3MAcquisitionTermsV1(terms);
  const publicRows: Record<string, Array<Record<string, unknown>>> = {
    deals: [{ id: DEAL_ID, project_id: PROJECT_ID, buyer_id: USER_ID, seller_id: sellerId, status: "pending", dispute_status: "none" }],
    profiles: [{ id: USER_ID, wallet_address: wallet.address, wallet_verified: true }],
  };
  const agreementContext = {
    binding: {
      deal_id: DEAL_ID, project_id: PROJECT_ID, audit_id: AUDIT_ID,
      fingerprint_id: FINGERPRINT_ID, fingerprint_digest: DIGEST,
      repository: "aminzaki1972/web3market", commit_sha: "f".repeat(40),
      binding_hash: BINDING_HASH,
    },
    terms: {
      id: "75000000-0000-4000-8000-000000000005", terms_version: 2,
      terms_hash: termsHash, canonical_terms_json: terms, status: "published",
    },
    acceptances: [],
  };
  const makeQuery = (rows: Array<Record<string, unknown>>) => {
    let selected = [...rows];
    return {
      select(_columns: string) { return this; },
      eq(column: string, value: unknown) { selected = selected.filter((row) => row[column] === value); return this; },
      order(_column: string) { return this; },
      async range(from: number, to: number) { return { data: selected.slice(from, to + 1), error: null }; },
      async maybeSingle() { return { data: selected[0] || null, error: null }; },
    };
  };
  let stored: ReturnType<typeof challengeRow> | null = null;
  let corruptBindingEvidence = false;
  const from = ((table: string) => makeQuery(publicRows[table] || [])) as NonNullable<W3MAdminClient["from"]>;
  const { deps, calls } = makeDeps(async (name, args) => {
    if (name === "w3m_get_deal_agreement_context") return { data: agreementContext, error: null };
    if (name === "w3m_issue_agreement_challenge") {
      stored = { ...challengeRow(wallet.address), nonce: String(args.p_nonce), signature_deadline: Number(args.p_signature_deadline), terms_hash: termsHash };
      if (corruptBindingEvidence) stored.binding_hash = "9".repeat(64);
      return { data: CHALLENGE_ID, error: null };
    }
    if (name === "w3m_get_agreement_challenge_for_verification") return { data: stored ? [stored] : [], error: null };
    throw new Error("Unexpected RPC " + name);
  }, { from, randomBytes: (length) => new Uint8Array(length).fill(0xcd) });
  const handler = createW3MAcquisitionHandler(deps);
  const response = await handler(makeRequest({ action: "prepare", deal_id: DEAL_ID, wallet_address: wallet.address }));
  const body = await response.json();
  if (response.status !== 200 || body.ok !== true) throw new Error("Preparation failed: " + JSON.stringify(body));
  const prepared = body.result;
  if (prepared.dealId !== DEAL_ID || prepared.partyRole !== "buyer" || prepared.walletAddress !== wallet.address ||
    prepared.termsHash !== termsHash || prepared.termsVersion !== "2" || prepared.challengeId !== CHALLENGE_ID ||
    prepared.typedData.message.termsHash !== "0x" + termsHash) throw new Error("Preparation did not return the exact trusted deal, terms, wallet, and challenge");
  const issueCall = calls.find((call) => call.name === "w3m_issue_agreement_challenge");
  if (issueCall?.args.p_user_id !== USER_ID || issueCall?.args.p_party_role !== "buyer" || issueCall?.args.p_terms_hash !== termsHash ||
      !calls.some((call) => call.name === "w3m_get_deal_agreement_context" && call.args.p_deal_id === DEAL_ID)) {
    throw new Error("Preparation did not load private agreement context through the restricted RPC or bind the challenge to the authenticated party");
  }

  // The server must reject a persisted challenge whose binding evidence differs
  // from the immutable deal-audit binding, before returning typed data to a browser.
  corruptBindingEvidence = true;
  const corruptedResponse = await handler(makeRequest({
    action: "prepare", deal_id: DEAL_ID, wallet_address: wallet.address,
  }));
  if (corruptedResponse.status !== 500) {
    throw new Error("Preparation must fail closed when persisted challenge binding evidence is substituted");
  }
});

Deno.test("accept action verifies exact persisted EIP-712 challenge before recording", async () => {
  const wallet = new Wallet("0x" + "2".repeat(64));
  const row = challengeRow(wallet.address);
  const typed = buildW3MAgreementTypedData({
    dealId: uuidBytes32(DEAL_ID),
    fingerprintId: uuidBytes32(FINGERPRINT_ID),
    fingerprintDigest: "0x" + DIGEST,
    bindingHash: "0x" + BINDING_HASH,
    termsHash: "0x" + TERMS_HASH,
    termsVersion: "2",
    partyRole: "buyer",
    walletAddress: wallet.address,
    nonce: row.nonce,
    deadline: DEADLINE,
  }, NOW);
  const signature = await wallet.signTypedData(typed.domain, { DealTermsAcceptance: typed.types.DealTermsAcceptance.map((field) => ({ ...field })) }, typed.message);
  const { deps, calls } = makeDeps(async (name) => {
    if (name === "w3m_get_agreement_challenge_for_verification") {
      return { data: [row], error: null };
    }
    if (name === "w3m_record_agreement_acceptance") {
      return { data: ACCEPTANCE_ID, error: null };
    }
    throw new Error("Unexpected RPC " + name);
  });

  const handler = createW3MAcquisitionHandler(deps);
  const response = await handler(makeRequest({
    action: "accept",
    challenge_id: CHALLENGE_ID,
    signature,
  }));
  const body = await response.json();

  if (response.status !== 200 || body.ok !== true || body.acceptance_id !== ACCEPTANCE_ID ||
    body.result?.dealId !== DEAL_ID || body.result?.partyRole !== "buyer" ||
    body.result?.termsVersion !== "2" || body.result?.acceptanceId !== ACCEPTANCE_ID ||
    body.result?.idempotentReplay !== false) {
    throw new Error("Acceptance failed or returned a mismatched client contract: " + JSON.stringify(body));
  }
  const record = calls.find((call) => call.name === "w3m_record_agreement_acceptance");
  if (!record || record.args.p_user_id !== USER_ID ||
    String(record.args.p_recovered_signer).toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error("Verified signer and authenticated user were not persisted");
  }
});

Deno.test("accept action rejects wrong-wallet signatures without calling persistence RPC", async () => {
  const expectedWallet = new Wallet("0x" + "3".repeat(64));
  const attacker = new Wallet("0x" + "4".repeat(64));
  const row = challengeRow(expectedWallet.address);
  const typed = buildW3MAgreementTypedData({
    dealId: uuidBytes32(DEAL_ID),
    fingerprintId: uuidBytes32(FINGERPRINT_ID),
    fingerprintDigest: "0x" + DIGEST,
    bindingHash: "0x" + BINDING_HASH,
    termsHash: "0x" + TERMS_HASH,
    termsVersion: "2",
    partyRole: "buyer",
    walletAddress: expectedWallet.address,
    nonce: row.nonce,
    deadline: DEADLINE,
  }, NOW);
  const signature = await attacker.signTypedData(typed.domain, { DealTermsAcceptance: typed.types.DealTermsAcceptance.map((field) => ({ ...field })) }, typed.message);
  const { deps, calls } = makeDeps(async () => ({ data: [row], error: null }));
  const handler = createW3MAcquisitionHandler(deps);
  const response = await handler(makeRequest({
    action: "accept", challenge_id: CHALLENGE_ID, signature,
  }));
  if (response.status !== 422) throw new Error("Wrong-wallet signature should return 422");
  if (calls.some((call) => call.name === "w3m_record_agreement_acceptance")) {
    throw new Error("Invalid signature reached the acceptance persistence RPC");
  }
});

Deno.test("accept action rejects challenges belonging to another account", async () => {
  const wallet = new Wallet("0x" + "5".repeat(64));
  const row = challengeRow(wallet.address);
  const { deps, calls } = makeDeps(async () => ({ data: [row], error: null }), {
    userId: "79000000-0000-4000-8000-000000000009",
  });
  const handler = createW3MAcquisitionHandler(deps);
  const response = await handler(makeRequest({
    action: "accept",
    challenge_id: CHALLENGE_ID,
    signature: "0x" + "0".repeat(130),
  }));
  if (response.status !== 403) throw new Error("Foreign challenge should return 403");
  if (calls.some((call) => call.name === "w3m_record_agreement_acceptance")) {
    throw new Error("Foreign challenge reached persistence RPC");
  }
});

Deno.test("handler rejects untrusted origins and missing bearer tokens", async () => {
  const { deps } = makeDeps(async () => ({ data: null, error: null }));
  const handler = createW3MAcquisitionHandler(deps);
  const badOrigin = new Request("https://web3market.xyz/functions/v1/w3m-acquisition-verification", {
    method: "POST",
    headers: { Origin: "https://attacker.example", Authorization: "Bearer valid-user-token" },
    body: JSON.stringify({ action: "challenge" }),
  });
  const noAuth = makeRequest({ action: "challenge" }, "");
  if ((await handler(badOrigin)).status !== 403) throw new Error("Untrusted origin should be rejected");
  if ((await handler(noAuth)).status !== 401) throw new Error("Missing bearer token should be rejected");
});

Deno.test("publish action reloads seller, project, completed audit and every persisted evidence page", async () => {
  const sellerId = "76000000-0000-4000-8000-000000000006";
  const datasets: Record<string, Array<Record<string, unknown>>> = {
    deals: [{
      id: DEAL_ID, project_id: PROJECT_ID, buyer_id: USER_ID, seller_id: sellerId,
      status: "pending", dispute_status: "none",
    }],
    projects: [{ id: PROJECT_ID, owner_id: sellerId }],
    code_audits: [{
      id: AUDIT_ID, project_id: PROJECT_ID, status: "completed",
      repo_owner: "Aminzaki1972", repo_name: "Web3Market", commit_sha: "f".repeat(40),
      engine_version: "w3m-code-audit-1.0", audit_type: "full",
      files_scanned: 1, lines_scanned: 12,
      overall_score: 91, security_score: 92, architecture_score: 90,
      code_quality_score: 91, dependency_score: 89, testing_score: 80,
      documentation_score: 85, web3_score: 90, scalability_score: 88,
      ai_fit_score: 82, risk_level: "Moderate", summary: "Synthetic test audit",
    }],
    code_audit_files: [{
      audit_id: AUDIT_ID, path: "src/index.ts", sha: "a".repeat(40), language: "TypeScript",
      size_bytes: 120, line_count: 12, selected_tier: 1, scanned: true,
    }],
    code_audit_findings: [],
  };
  class Query {
    private rows: Array<Record<string, unknown>>;
    constructor(table: string) { this.rows = [...(datasets[table] || [])]; }
    select(_columns: string) { return this; }
    eq(column: string, value: unknown) {
      this.rows = this.rows.filter((row) => row[column] === value);
      return this;
    }
    order(column: string, options?: { ascending?: boolean }) {
      this.rows.sort((a, b) => String(a[column] ?? "").localeCompare(String(b[column] ?? "")));
      if (options?.ascending === false) this.rows.reverse();
      return this;
    }
    async range(from: number, to: number) {
      return { data: this.rows.slice(from, to + 1), error: null };
    }
    async maybeSingle() {
      return { data: this.rows[0] || null, error: null };
    }
  }
  const from = ((table: string) => new Query(table)) as NonNullable<W3MAdminClient["from"]>;
  const { deps, calls } = makeDeps(async (name, args) => {
    if (name !== "w3m_publish_audit_fingerprint_and_binding") {
      throw new Error("Unexpected RPC " + name);
    }
    return {
      data: [{ fingerprint_id: args.p_fingerprint_id, binding_hash: args.p_binding_hash }],
      error: null,
    };
  }, { userId: sellerId, from });

  const handler = createW3MAcquisitionHandler(deps);
  const response = await handler(makeRequest({ action: "publish_fingerprint_binding", deal_id: DEAL_ID, audit_id: AUDIT_ID }));
  const body = await response.json();
  if (response.status !== 201 || body.ok !== true) {
    throw new Error("Fingerprint publication failed: " + JSON.stringify(body));
  }
  if (body.files_fingerprinted !== 1 || !/^[0-9a-f]{64}$/.test(body.fingerprint_digest)) {
    throw new Error("Persisted audit evidence was not fingerprinted correctly");
  }
  const call = calls.find((item) => item.name === "w3m_publish_audit_fingerprint_and_binding");
  if (!call || call.args.p_user_id !== sellerId || call.args.p_deal_id !== DEAL_ID ||
    call.args.p_project_id !== PROJECT_ID || call.args.p_audit_id !== AUDIT_ID) {
    throw new Error("Trusted seller and deal context were not bound to the publication RPC");
  }
});

Deno.test("publish action rejects non-owners before reading or persisting audit evidence", async () => {
  const sellerId = "76000000-0000-4000-8000-000000000006";
  const from = ((table: string) => ({
    select() { return this; },
    eq() { return this; },
    order() { return this; },
    async range() { return { data: [], error: null }; },
    async maybeSingle() {
      return {
        data: table === "deals"
          ? { id: DEAL_ID, project_id: PROJECT_ID, buyer_id: USER_ID, seller_id: sellerId, status: "pending", dispute_status: "none" }
          : { id: PROJECT_ID, owner_id: "79000000-0000-4000-8000-000000000009" },
        error: null,
      };
    },
  })) as unknown as NonNullable<W3MAdminClient["from"]>;
  const { deps, calls } = makeDeps(async () => ({ data: null, error: null }), { userId: sellerId, from });
  const handler = createW3MAcquisitionHandler(deps);
  const response = await handler(makeRequest({ action: "publish_fingerprint_binding", deal_id: DEAL_ID, audit_id: AUDIT_ID }));
  if (response.status !== 403) throw new Error("Non-owner should be rejected");
  if (calls.length !== 0) throw new Error("Non-owner reached a persistence RPC");
});

Deno.test("publish action fails closed when any scanned file lacks a Git blob SHA", async () => {
  const sellerId = "76000000-0000-4000-8000-000000000006";
  const datasets: Record<string, Array<Record<string, unknown>>> = {
    deals: [{ id: DEAL_ID, project_id: PROJECT_ID, buyer_id: USER_ID, seller_id: sellerId, status: "pending", dispute_status: "none" }],
    projects: [{ id: PROJECT_ID, owner_id: sellerId }],
    code_audits: [{
      id: AUDIT_ID, project_id: PROJECT_ID, status: "completed",
      repo_owner: "Aminzaki1972", repo_name: "Web3Market", commit_sha: "f".repeat(40),
      engine_version: "w3m-code-audit-1.0", audit_type: "full", files_scanned: 1, lines_scanned: 12,
      overall_score: 91, security_score: 92, architecture_score: 90, code_quality_score: 91,
      dependency_score: 89, testing_score: 80, documentation_score: 85, web3_score: 90,
      scalability_score: 88, ai_fit_score: 82, risk_level: "Moderate", summary: "Synthetic test audit",
    }],
    code_audit_files: [{ audit_id: AUDIT_ID, path: "src/index.ts", sha: null, language: "TypeScript", size_bytes: 120, line_count: 12, selected_tier: 1, scanned: true }],
    code_audit_findings: [],
  };
  class Query {
    private rows: Array<Record<string, unknown>>;
    constructor(table: string) { this.rows = [...(datasets[table] || [])]; }
    select() { return this; }
    eq(column: string, value: unknown) { this.rows = this.rows.filter((row) => row[column] === value); return this; }
    order() { return this; }
    async range(from: number, to: number) { return { data: this.rows.slice(from, to + 1), error: null }; }
    async maybeSingle() { return { data: this.rows[0] || null, error: null }; }
  }
  const from = ((table: string) => new Query(table)) as NonNullable<W3MAdminClient["from"]>;
  const { deps, calls } = makeDeps(async () => ({ data: null, error: null }), { userId: sellerId, from });
  const handler = createW3MAcquisitionHandler(deps);
  const response = await handler(makeRequest({ action: "publish_fingerprint_binding", deal_id: DEAL_ID, audit_id: AUDIT_ID }));
  if (response.status !== 500) throw new Error("Missing Git blob SHA must fail closed");
  if (calls.length !== 0) throw new Error("Invalid audit manifest reached persistence RPC");
});


function validTermsPayload() {
  return {
    schema: "w3m-acquisition-terms-v1",
    terms_version: 1,
    deal: { deal_id: DEAL_ID, project_id: PROJECT_ID, buyer_id: USER_ID, seller_id: "76000000-0000-4000-8000-000000000006" },
    project: { title: "Synthetic project", category: "SaaS" },
    audit: { audit_id: AUDIT_ID, repository: "example/project", commit_sha: "a".repeat(40), fingerprint_digest: "b".repeat(64) },
    consideration: { amount: "1000.00", currency: "USDT" },
    platform_fee: { percent: "7.50", amount: "75.00" },
    seller_net: { amount: "925.00", currency: "USDT" },
    payment: { method: "safe_multisig", chain_id: 56, asset: "USDT", token_contract: null, safe_address: null, status_at_signing: "configured_or_pending" },
    transfer_scope: {
      included_assets: [{ type: "repository", description: "Source code" }],
      excluded_assets: [],
      access_and_credentials: { transfer_method: "Owner handover; no secrets in this record" },
      third_party_dependencies: [],
      intellectual_property: { seller_declaration: "Seller-provided declaration" },
      data_and_privacy: { scope: "No personal data transfer included" },
    },
    delivery: { deadline: "2027-01-01T00:00:00Z", checklist: ["Transfer repository"] },
    inspection: { enabled: true, window: "5 days", acceptance_criteria: ["Repository access delivered"] },
    dispute: { procedure_version: "draft-1", text: "Synthetic procedure for tests only" },
    escrow: { funding_condition: "Buyer funds verified Safe", release_condition: "Both parties complete conditions", dispute_hold: true },
    governing_terms: { governing_law: "Synthetic governing-law policy for validator tests", venue_or_process: "Synthetic dispute venue for validator tests", language: "English" },
    risk_acknowledgements: ["Audit is limited to the scanned commit."],
    disclosures: [],
    created_at: "2026-11-07T00:00:00Z",
    expires_at: "2026-11-08T00:00:00Z",
  };
}

Deno.test("publish_terms authenticates the seller, hashes validated terms, and calls the restricted publication RPC", async () => {
  const sellerId = "76000000-0000-4000-8000-000000000006";
  const dealRow = {
    id: DEAL_ID, project_id: PROJECT_ID, buyer_id: USER_ID, seller_id: sellerId,
    status: "pending", dispute_status: "none",
  };
  const from = ((table: string) => ({
    rows: table === "deals" ? [dealRow] : [],
    select() { return this; },
    eq(column: string, value: unknown) {
      this.rows = this.rows.filter((row: Record<string, unknown>) => row[column] === value);
      return this;
    },
    async maybeSingle() { return { data: this.rows[0] || null, error: null }; },
    order() { return this; },
    async range() { return { data: this.rows, error: null }; },
  })) as unknown as NonNullable<W3MAdminClient["from"]>;
  const { deps, calls } = makeDeps(async (name, args) => {
    if (name === "w3m_publish_acquisition_terms_version") {
      if (args.p_deal_id !== DEAL_ID || args.p_terms_version !== 1 ||
        !/^[0-9a-f]{64}$/.test(String(args.p_terms_hash)) ||
        (args.p_canonical_terms_json as Record<string, unknown>).schema !== "w3m-acquisition-terms-v1") {
        throw new Error("Terms publication RPC arguments were not canonical and bound");
      }
      return { data: "79000000-0000-4000-8000-000000000009", error: null };
    }
    if (name === "w3m_sync_deal_assets_from_published_terms" && args.p_deal_id === DEAL_ID) {
      return { data: 1, error: null };
    }
    throw new Error("Unexpected RPC " + name);
  }, { userId: sellerId, from });
  const handler = createW3MAcquisitionHandler(deps);
  const response = await handler(makeRequest({ action: "publish_terms", deal_id: DEAL_ID, terms: validTermsPayload() }));
  const body = await response.json();
  if (response.status !== 201 || body.ok !== true || body.terms_version !== 1 ||
    !/^[0-9a-f]{64}$/.test(body.terms_hash)) {
    throw new Error("Terms publication failed: " + JSON.stringify(body));
  }
  if (calls.length !== 2 || calls[0].name !== "w3m_publish_acquisition_terms_version" ||
    calls[1].name !== "w3m_sync_deal_assets_from_published_terms") {
    throw new Error("Validated terms must publish and synchronize the exact per-asset checklist");
  }
});

Deno.test("publish_terms rejects a non-seller before calling the publication RPC", async () => {
  const sellerId = "76000000-0000-4000-8000-000000000006";
  const from = ((table: string) => ({
    select() { return this; },
    eq() { return this; },
    async maybeSingle() {
      return { data: table === "deals" ? {
        id: DEAL_ID, project_id: PROJECT_ID, buyer_id: USER_ID, seller_id: sellerId,
        status: "pending", dispute_status: "none",
      } : null, error: null };
    },
    order() { return this; },
    async range() { return { data: [], error: null }; },
  })) as unknown as NonNullable<W3MAdminClient["from"]>;
  const { deps, calls } = makeDeps(async () => ({ data: null, error: null }), {
    userId: USER_ID, from,
  });
  const handler = createW3MAcquisitionHandler(deps);
  const response = await handler(makeRequest({ action: "publish_terms", deal_id: DEAL_ID, terms: validTermsPayload() }));
  if (response.status !== 403) throw new Error("Non-seller terms publication should return 403");
  if (calls.length !== 0) throw new Error("Non-seller reached the terms publication RPC");
});

Deno.test("publish_terms rejects terms whose deal parties do not match the trusted deal", async () => {
  const sellerId = "76000000-0000-4000-8000-000000000006";
  const from = ((table: string) => ({
    select() { return this; },
    eq() { return this; },
    async maybeSingle() {
      return { data: table === "deals" ? {
        id: DEAL_ID, project_id: PROJECT_ID, buyer_id: USER_ID, seller_id: sellerId,
        status: "pending", dispute_status: "none",
      } : null, error: null };
    },
    order() { return this; },
    async range() { return { data: [], error: null }; },
  })) as unknown as NonNullable<W3MAdminClient["from"]>;
  const { deps, calls } = makeDeps(async () => ({ data: null, error: null }), {
    userId: sellerId, from,
  });
  const terms = validTermsPayload();
  terms.deal.buyer_id = "79000000-0000-4000-8000-000000000009";
  const handler = createW3MAcquisitionHandler(deps);
  const response = await handler(makeRequest({ action: "publish_terms", deal_id: DEAL_ID, terms }));
  if (response.status !== 409) throw new Error("Mismatched deal party should be rejected");
  if (calls.length !== 0) throw new Error("Mismatched terms reached the publication RPC");
});


Deno.test("asset_transition authenticates the user and calls the restricted per-asset RPC", async () => {
  const assetId = "7a000000-0000-4000-8000-00000000000a";
  const sellerId = "76000000-0000-4000-8000-000000000006";
  const { deps, calls } = makeDeps(async (name, args) => {
    if (name !== "w3m_transition_deal_asset_v1" ||
        args.p_actor_user_id !== sellerId || args.p_deal_id !== DEAL_ID ||
        args.p_asset_id !== assetId || args.p_action !== "deliver" ||
        args.p_delivery_url !== "https://example.invalid/repo" ||
        args.p_evidence !== "synthetic delivery evidence") {
      throw new Error("Asset transition RPC was not bound to authenticated seller input");
    }
    return { data: { asset_id: assetId, status: "delivered", attempt_number: 1 }, error: null };
  }, { userId: sellerId });
  const handler = createW3MAcquisitionHandler(deps);
  const response = await handler(makeRequest({
    action: "asset_transition", asset_action: "deliver", deal_id: DEAL_ID,
    asset_id: assetId, delivery_url: "https://example.invalid/repo",
    evidence: "synthetic delivery evidence",
  }));
  const body = await response.json();
  if (response.status !== 200 || body.ok !== true ||
      body.result?.asset_id !== assetId || body.result?.status !== "delivered" ||
      calls.length !== 1) {
    throw new Error("Authenticated per-asset delivery was not confirmed");
  }
});

Deno.test("asset_transition rejects malformed delivery evidence before persistence", async () => {
  const { deps, calls } = makeDeps(async () => ({ data: null, error: null }));
  const handler = createW3MAcquisitionHandler(deps);
  const response = await handler(makeRequest({
    action: "asset_transition", asset_action: "deliver", deal_id: DEAL_ID,
    asset_id: "7a000000-0000-4000-8000-00000000000a",
    delivery_url: "http://insecure.invalid/repo", evidence: "test",
  }));
  if (response.status !== 400 || calls.length !== 0) {
    throw new Error("Non-HTTPS delivery reference must be rejected before persistence");
  }
});

Deno.test("asset_transition rejects buyer-supplied delivery fields", async () => {
  const { deps, calls } = makeDeps(async () => ({ data: null, error: null }));
  const handler = createW3MAcquisitionHandler(deps);
  const response = await handler(makeRequest({
    action: "asset_transition", asset_action: "accept", deal_id: DEAL_ID,
    asset_id: "7a000000-0000-4000-8000-00000000000a",
    delivery_url: "https://example.invalid/repo",
  }));
  if (response.status !== 400 || calls.length !== 0) {
    throw new Error("Buyer response must not carry or modify seller delivery evidence");
  }
});

Deno.test("asset_transition rejects a mismatched RPC result", async () => {
  const { deps } = makeDeps(async () => ({
    data: { asset_id: DEAL_ID, status: "accepted", attempt_number: 1 }, error: null,
  }), { userId: USER_ID });
  const handler = createW3MAcquisitionHandler(deps);
  const response = await handler(makeRequest({
    action: "asset_transition", asset_action: "deliver", deal_id: DEAL_ID,
    asset_id: "7a000000-0000-4000-8000-00000000000a",
    delivery_url: "https://example.invalid/repo", evidence: "test evidence",
  }));
  if (response.status !== 503) throw new Error("Mismatched RPC result must fail closed");
});


Deno.test("asset_transition maps stale or locked deal state to a conflict response", async () => {
  const assetId = "7a000000-0000-4000-8000-00000000000a";
  const sellerId = "76000000-0000-4000-8000-000000000006";
  const { deps } = makeDeps(async () => ({
    data: null,
    error: { code: "55000", message: "asset_changes_blocked_by_safe_release_or_completed_deal" },
  }), { userId: sellerId });
  const handler = createW3MAcquisitionHandler(deps);
  const response = await handler(makeRequest({
    action: "asset_transition", asset_action: "deliver", deal_id: DEAL_ID,
    asset_id: assetId, delivery_url: "https://example.invalid/repo",
    evidence: "synthetic evidence",
  }));
  const body = await response.json();
  if (response.status !== 409 || body.ok !== false) {
    throw new Error("Locked or stale asset state must return a conflict, not an internal server error");
  }
});
