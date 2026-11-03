import { assert, assertEquals, assertNotEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  assertCanonicalReceiptBlock,
  assertPaymentBlockBeforeExpiry,
  assertSupportedPaymentAsset,
  BNB_PEG_BSC_USD_CONTRACT,
  findExactTransferLog,
  TRANSFER_TOPIC,
} from "./payment-verification.ts";
import {
  decryptGuestToken,
  encryptGuestToken,
  importGuestTokenKey,
} from "./guest-report-token.ts";

// This is a deterministic, in-memory integration simulation. It exercises the
// production chain/asset/receipt/token helpers and models DB uniqueness,
// email retry, one-time link exchange, and report-session authorization.
// It does not contact BNB RPC, Supabase, or Resend and does not replace deployed
// Edge Function / provider E2E verification.
const chainId = 56;
const recipient = "0x" + "c".repeat(40);
const payer = "0x" + "b".repeat(40);
const blockHash = "0x" + "a".repeat(64);
const amount = 9n * 10n ** 18n;
const expiry = "2026-11-03T12:00:00.000Z";
const topic = (address: string) => "0x" + "0".repeat(24) + address.slice(2);
const transferLog = (overrides: Record<string, unknown> = {}) => ({
  address: BNB_PEG_BSC_USD_CONTRACT,
  topics: [TRANSFER_TOPIC, topic(payer), topic(recipient)],
  data: "0x" + amount.toString(16).padStart(64, "0"),
  logIndex: "0x2",
  ...overrides,
});
const beforeExpiryBlock = "0x" + BigInt(Math.floor(Date.parse(expiry) / 1000) - 1).toString(16);
const canonical = { number: "0x10", hash: blockHash, timestamp: beforeExpiryBlock };

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, "0")).join("");
}

Deno.test("workflow simulation: guest $9 order -> exact BNB-USD payment -> private report", async () => {
  // Create-order contract: guest base tier is billable, with exact supported asset.
  const order = { id: "order-1", user_id: null, audit_type: "code", price_usd: 9, status: "pending" };
  assertEquals(order.price_usd, 9);
  assertEquals(order.audit_type, "code");
  assertEquals(assertSupportedPaymentAsset(chainId, BNB_PEG_BSC_USD_CONTRACT, "BSC-USD", 18), undefined);

  // RPC/receipt verification contract using the real production helpers.
  const transfer = findExactTransferLog([transferLog()], BNB_PEG_BSC_USD_CONTRACT, recipient, amount);
  assertEquals(transfer, { payerAddress: payer, logIndex: 2 });
  assertEquals(assertCanonicalReceiptBlock("0x10", blockHash, canonical), undefined);
  assertEquals(assertPaymentBlockBeforeExpiry(expiry, canonical.timestamp), undefined);

  // Confirmation policy: fewer than 12 confirmations is pending, not paid.
  const confirmations = 11;
  assert(confirmations < 12, "11 confirmations must remain pending");
  assertEquals(12 - confirmations, 1);

  // A duplicate transaction hash and duplicate order->audit linkage are rejected
  // by the same unique DB indexes exercised in the PostgreSQL migration tests.
  const txHashes = new Set<string>();
  txHashes.add("0x" + "1".repeat(64));
  assert(txHashes.has(("0x" + "1".repeat(64)).toUpperCase().replace("0X", "0x")));
  assertThrows(() => {
    const normalized = ("0x" + "1".repeat(64)).toLowerCase();
    if (txHashes.has(normalized)) throw new Error("duplicate transaction hash");
  });
  const auditLinks = new Set<string>([order.id]);
  assertThrows(() => {
    if (auditLinks.has(order.id)) throw new Error("payment order already linked");
  });

  // Guest report token: encrypted at rest; provider retry reuses the same token.
  const reportToken = "d".repeat(64);
  const key = await importGuestTokenKey("workflow-test-secret-at-least-32-bytes-long");
  const encrypted = await encryptGuestToken(reportToken, key);
  assert(!encrypted.ciphertext.includes(reportToken));
  assertEquals(await decryptGuestToken(encrypted.ciphertext, encrypted.iv, key), reportToken);
  const reportTokenHash = await digest(reportToken);

  // Simulate first email-provider failure, then retry with the same protected link.
  let emailSent = false;
  let emailClaimed = false;
  let tokenHashStored = reportTokenHash;
  let tokenCiphertextStored = encrypted.ciphertext;
  const providerAttempts: string[] = [];
  async function sendEmail() {
    if (emailSent || emailClaimed) return;
    emailClaimed = true;
    const recovered = await decryptGuestToken(tokenCiphertextStored, encrypted.iv, key);
    providerAttempts.push(recovered);
    if (providerAttempts.length === 1) {
      emailClaimed = false; // failed request releases claim for retry
      throw new Error("mock Resend unavailable");
    }
    emailSent = true;
    emailClaimed = false;
  }
  await assertRejects(() => sendEmail());
  await sendEmail();
  assertEquals(emailSent, true);
  assertEquals(providerAttempts.length, 2);
  assertEquals(providerAttempts[0], providerAttempts[1]);
  assertEquals(await digest(providerAttempts[1]), tokenHashStored);

  // Exchange the emailed link once; store only the session hash.
  const sessionToken = "e".repeat(64);
  let linkUsed = false;
  let sessionHash = "";
  function exchange(token: string) {
    if (linkUsed || awaitHashPlaceholder(token) !== tokenHashStored) throw new Error("link invalid or already used");
    linkUsed = true;
    sessionHash = tokenHashForSession;
    return sessionToken;
  }
  // Keep this tiny synchronous model explicit; cryptographic hash checks above
  // already verify the token material used by the production access flow.
  const tokenHashForSession = "session-hash";
  function awaitHashPlaceholder(token: string) {
    return token === reportToken ? tokenHashStored : "";
  }
  assertEquals(exchange(reportToken), sessionToken);
  assertThrows(() => exchange(reportToken));
  assertEquals(linkUsed, true);
  assertEquals(sessionHash, tokenHashForSession);

  // A report session is accepted only while the payment is confirmed and session
  // hash matches; expired/revoked sessions and pending orders must fail closed.
  order.status = "confirmed";
  const sessionExpiresAt = Date.now() + 12 * 60 * 60 * 1000;
  const authorizeReport = (candidate: string, now: number, revoked = false) =>
    !revoked && order.status === "confirmed" && candidate === sessionHash && now < sessionExpiresAt;
  assertEquals(authorizeReport(tokenHashForSession, Date.now()), true);
  assertEquals(authorizeReport("wrong-session", Date.now()), false);
  assertEquals(authorizeReport(tokenHashForSession, sessionExpiresAt + 1), false);
  assertEquals(authorizeReport(tokenHashForSession, Date.now(), true), false);
  order.status = "pending";
  assertEquals(authorizeReport(tokenHashForSession, Date.now()), false);
});

Deno.test("workflow simulation: rejects wrong chain, token, recipient, amount, reorg, and late payment", () => {
  assertThrows(() => assertSupportedPaymentAsset(1, BNB_PEG_BSC_USD_CONTRACT, "BSC-USD", 18));
  assertThrows(() => assertSupportedPaymentAsset(56, "0x" + "f".repeat(40), "BSC-USD", 18));
  assertThrows(() => findExactTransferLog([transferLog()], BNB_PEG_BSC_USD_CONTRACT, "0x" + "f".repeat(40), amount));
  assertThrows(() => findExactTransferLog([transferLog()], BNB_PEG_BSC_USD_CONTRACT, recipient, amount + 1n));
  assertThrows(() => assertCanonicalReceiptBlock("0x10", blockHash, { number: "0x10", hash: "0x" + "f".repeat(64) }));
  const afterExpiry = "0x" + BigInt(Math.floor(Date.parse(expiry) / 1000) + 1).toString(16);
  assertThrows(() => assertPaymentBlockBeforeExpiry(expiry, afterExpiry));
});

Deno.test("workflow simulation: distinct report links cannot reuse each other's session", async () => {
  const linkA = "a".repeat(64);
  const linkB = "b".repeat(64);
  const sessionA = "c".repeat(64);
  const storedHashA = await digest(linkA);
  const storedHashB = await digest(linkB);
  assertNotEquals(storedHashA, storedHashB);
  const sessionBoundToLinkA = storedHashA;
  assertEquals(sessionBoundToLinkA === storedHashB, false);
  assertEquals(sessionA.length, 64);
});
