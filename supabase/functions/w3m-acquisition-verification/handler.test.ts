import { Wallet } from "npm:ethers@6.15.0";
import { buildW3MAgreementTypedData } from "./agreement-signature.ts";
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
  options: { userId?: string; randomBytes?: (length: number) => Uint8Array } = {},
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

Deno.test("challenge action persists server nonce before returning EIP-712 typed data", async () => {
  const wallet = new Wallet("0x" + "1".repeat(64));
  let stored: ReturnType<typeof challengeRow> | null = null;
  const { deps, calls } = makeDeps(async (name, args) => {
    if (name === "w3m_issue_agreement_challenge") {
      stored = {
        ...challengeRow(wallet.address),
        nonce: String(args.p_nonce),
        signature_deadline: Number(args.p_signature_deadline),
      };
      return { data: CHALLENGE_ID, error: null };
    }
    if (name === "w3m_get_agreement_challenge_for_verification") {
      return { data: stored ? [stored] : [], error: null };
    }
    throw new Error("Unexpected RPC " + name);
  }, { randomBytes: (length) => new Uint8Array(length).fill(0xab) });

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
    wallet_address: wallet.address,
  }));
  const body = await response.json();

  if (response.status !== 200 || body.ok !== true) throw new Error("Challenge failed: " + JSON.stringify(body));
  if (body.challenge_id !== CHALLENGE_ID) throw new Error("Challenge ID mismatch");
  if (body.typed_data.message.nonce !== "0x" + "ab".repeat(32)) throw new Error("Nonce was not generated server-side");
  if (calls.map((call) => call.name).join(",") !==
    "w3m_issue_agreement_challenge,w3m_get_agreement_challenge_for_verification") {
    throw new Error("Challenge must be persisted and then reloaded before typed data is returned");
  }
  const issueArgs = calls[0].args;
  if (issueArgs.p_user_id !== USER_ID || issueArgs.p_nonce !== body.typed_data.message.nonce) {
    throw new Error("Authenticated user or server nonce was not bound to the database challenge");
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
  const signature = await wallet.signTypedData(typed.domain, typed.types, typed.message);
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

  if (response.status !== 200 || body.ok !== true || body.acceptance_id !== ACCEPTANCE_ID) {
    throw new Error("Acceptance failed: " + JSON.stringify(body));
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
  const signature = await attacker.signTypedData(typed.domain, typed.types, typed.message);
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
