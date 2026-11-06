import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  encodeSafeExecTransactionCalldata,
  submitSafeWalletExecutionPackage,
  executeW3MDealReleaseFromWallet,
} from "../../../js/w3m-safe-wallet-execution-client.js";

const SAFE = "0x1111111111111111111111111111111111111111";
const OWNER = "0x2222222222222222222222222222222222222222";
const HASH = "0x" + "a".repeat(64);
const OUTER_HASH = "0x" + "b".repeat(64);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map((v) => JSON.parse(canonical(v))));
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) sorted[key] = input[key];
    return "{" + Object.keys(sorted).map((key) =>
      JSON.stringify(key) + ":" + canonical(sorted[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}
async function hash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
function pkg() {
  return {
    protocol: "W3M_PROTOCOL_V1",
    chainId: 56,
    dealId: "81000000-0000-4000-8000-000000000001",
    transactionId: "82000000-0000-4000-8000-000000000002",
    reportId: "83000000-0000-4000-8000-000000000003",
    reportVersion: 1,
    agreementTermsVersionId: "84000000-0000-4000-8000-000000000004",
    agreementTermsHash: "f".repeat(64),
    safeAddress: SAFE,
    safeTransactionHash: HASH,
    safeVersion: "1.4.1",
    readBlockNumber: "90000000",
    readBlockHash: "0x" + "9".repeat(64),
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    call: {
      to: "0x3333333333333333333333333333333333333333",
      value: "0",
      data: "0x12345678",
      operation: 1,
      safeTxGas: "0",
      baseGas: "0",
      gasPrice: "0",
      gasToken: "0x0000000000000000000000000000000000000000",
      refundReceiver: "0x0000000000000000000000000000000000000000",
      nonce: "7",
    },
    signatures: [{ signerAddress: OWNER, signature: "0x" + "1".repeat(130) }],
    requiredSignatures: 1,
  };
}
function provider(overrides: Record<string, unknown> = {}) {
  const calls: { method: string; params?: unknown[] }[] = [];
  return {
    calls,
    async request(args: { method: string; params?: unknown[] }) {
      calls.push(args);
      if (args.method === "eth_chainId") return overrides.chain ?? "0x38";
      if (args.method === "eth_accounts") return overrides.accounts ?? [OWNER];
      if (args.method === "eth_requestAccounts") return [OWNER];
      if (args.method === "eth_call") return overrides.nonce ?? "0x" + "0".repeat(63) + "7";
      if (args.method === "eth_sendTransaction") return overrides.txHash ?? OUTER_HASH;
      throw new Error("unexpected RPC method");
    },
  };
}

Deno.test("encodes exact Safe execTransaction calldata with dynamic offsets and packed signatures", () => {
  const data = encodeSafeExecTransactionCalldata(pkg());
  assertEquals(data.slice(0, 10), "0x6a761202");
  assertEquals(data.length > 10 + 640, true);
  assertEquals(data.slice(10 + 64 * 2, 10 + 64 * 3), "0".repeat(61) + "140");
});

Deno.test("submits only after package hash, BNB chain, verified signer, and Safe nonce checks", async () => {
  const value = pkg();
  const packageHash = await hash(value);
  const wallet = provider();
  const result = await submitSafeWalletExecutionPackage({
    provider: wallet,
    package: value,
    expectedPackageHash: packageHash,
  });
  assertEquals(result, {
    transactionHash: OUTER_HASH,
    from: OWNER,
    safeAddress: SAFE,
    safeTransactionHash: HASH,
    state: "SUBMITTED_UNVERIFIED",
  });
  assertEquals(wallet.calls.filter((call) => call.method === "eth_sendTransaction").length, 1);
  const sent = wallet.calls.find((call) => call.method === "eth_sendTransaction")?.params?.[0] as Record<string, unknown>;
  assertEquals(sent.to, SAFE);
  assertEquals(sent.value, "0x0");
});

Deno.test("blocks wrong chain, wrong signer, changed nonce, expired package, and hash mismatch before send", async () => {
  const value = pkg();
  const packageHash = await hash(value);
  for (const options of [
    { chain: "0x1" },
    { accounts: ["0x4444444444444444444444444444444444444444"] },
    { nonce: "0x" + "0".repeat(63) + "8" },
  ]) {
    const wallet = provider(options);
    await assertRejects(() => submitSafeWalletExecutionPackage({
      provider: wallet, package: value, expectedPackageHash: packageHash,
    }));
    assertEquals(wallet.calls.some((call) => call.method === "eth_sendTransaction"), false);
  }
  const expired = { ...value, expiresAt: new Date(Date.now() - 1_000).toISOString() };
  const expiredHash = await hash(expired);
  const expiredWallet = provider();
  await assertRejects(() => submitSafeWalletExecutionPackage({
    provider: expiredWallet, package: expired, expectedPackageHash: expiredHash,
  }));
  assertEquals(expiredWallet.calls.some((call) => call.method === "eth_sendTransaction"), false);

  const mismatchWallet = provider();
  await assertRejects(() => submitSafeWalletExecutionPackage({
    provider: mismatchWallet, package: value, expectedPackageHash: "c".repeat(64),
  }));
  assertEquals(mismatchWallet.calls.some((call) => call.method === "eth_sendTransaction"), false);
});


Deno.test("orchestrates package issuance, connected-wallet submission, and unverified hash persistence", async () => {
  const value = pkg();
  const packageHash = await hash(value);
  const urls: string[] = [];
  const submissionBodies: Record<string, unknown>[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/w3m-protocol-v1-safe-wallet-package")) {
      assertEquals(init?.method, "POST");
      assertEquals((init?.headers as Record<string, string>)?.Authorization, "Bearer test-access-token");
      return new Response(JSON.stringify({
        ok: true, state: "PACKAGE_ISSUED",
        attempt_id: "24000000-0000-4000-8000-000000000004",
        package_hash: packageHash, package: value,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/w3m-protocol-v1-safe-wallet-submit")) {
      submissionBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({
        ok: true, state: "BROADCAST_UNVERIFIED",
        transaction_hash: OUTER_HASH, receipt_verified: false, finalized: false,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("Unexpected endpoint");
  };
  const wallet = provider();
  const result = await executeW3MDealReleaseFromWallet({
    provider: wallet,
    dealId: value.dealId,
    accessToken: "test-access-token",
    supabaseUrl: "https://project.supabase.co",
    fetchImpl,
  });
  assertEquals(result.state, "BROADCAST_UNVERIFIED");
  assertEquals(result.transactionHash, OUTER_HASH);
  assertEquals(result.receiptVerified, false);
  assertEquals(result.finalized, false);
  assertEquals(urls.length, 2);
  assertEquals(submissionBodies[0]?.attempt_id, "24000000-0000-4000-8000-000000000004");
  assertEquals(submissionBodies[0]?.package_hash, packageHash);
  assertEquals(submissionBodies[0]?.transaction_hash, OUTER_HASH);
});

Deno.test("preserves the wallet hash for reconciliation if submission-hash persistence fails", async () => {
  const value = pkg();
  const packageHash = await hash(value);
  let calls = 0;
  const result = await executeW3MDealReleaseFromWallet({
    provider: provider(),
    dealId: value.dealId,
    accessToken: "test-access-token",
    supabaseUrl: "https://project.supabase.co",
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({
        ok: true, state: "PACKAGE_ISSUED",
        attempt_id: "24000000-0000-4000-8000-000000000004",
        package_hash: packageHash, package: value,
      }), { status: 200 });
      throw new Error("simulated network loss after wallet submission");
    },
  });
  assertEquals(result.state, "SUBMITTED_UNRECORDED");
  assertEquals(result.transactionHash, OUTER_HASH);
  assertEquals(result.receiptVerified, false);
  assertEquals(result.finalized, false);
});
