/**
 * Cryptographic finalization check for the W3M V1 acceptance pair.
 *
 * This is a pure verifier. The trusted server must reload immutable rows and
 * current deal/binding/terms from storage before calling it. Persistence must
 * still enforce atomic nonce consumption and unique deal/version/party rows.
 */
import {
  hasCompleteW3MAcceptancePair,
  type W3MAcceptanceRecord,
  type W3MCompleteAcceptanceExpectation,
} from "./acceptance-ledger.ts";
import {
  verifyW3MAgreementChallengeSignature,
} from "./agreement-challenge.ts";
import type {
  W3MDealAuditBinding,
  W3MDealAuditBindingInput,
} from "./deal-audit-binding.ts";

export type W3MAcceptancePartyUsers = {
  buyerUserId: string;
  sellerUserId: string;
};

function expectedUserForRole(
  role: "buyer" | "seller",
  parties: W3MAcceptancePartyUsers,
): string {
  return role === "buyer" ? parties.buyerUserId : parties.sellerUserId;
}

/**
 * Revalidates the exact two-party acceptance pair and independently recovers
 * both EIP-712 signers from the persisted signatures. The verifier uses each
 * record's acceptance timestamp as its verification clock, so a valid
 * 15-minute challenge remains verifiable after it expires.
 *
 * Returns false for any malformed, stale, substituted, cross-deal, wrong-user,
 * wrong-wallet, or cryptographically invalid record.
 */
export async function verifyW3MFinalizationAcceptancePair(
  rows: readonly W3MAcceptanceRecord[],
  expected: W3MCompleteAcceptanceExpectation,
  parties: W3MAcceptancePartyUsers,
  binding: W3MDealAuditBinding,
  expectedBinding: W3MDealAuditBindingInput,
): Promise<boolean> {
  try {
    if (!Array.isArray(rows) || rows.length < 2 || !parties ||
      !binding || !expectedBinding) return false;

    if (!hasCompleteW3MAcceptancePair(rows, expected)) return false;

    if (parties.buyerUserId.toLowerCase() === parties.sellerUserId.toLowerCase()) {
      return false;
    }

    const currentRows = rows.filter((row) =>
      row.deal_id.toLowerCase() === expected.dealId.toLowerCase() &&
      row.terms_version === expected.termsVersion
    );
    if (currentRows.length !== 2) return false;

    for (const row of currentRows) {
      if (row.user_id.toLowerCase() !==
        expectedUserForRole(row.party_role, parties).toLowerCase()) {
        return false;
      }

      const acceptedAtMs = Date.parse(row.accepted_at);
      if (!Number.isFinite(acceptedAtMs) ||
        new Date(acceptedAtMs).toISOString() !== row.accepted_at) {
        return false;
      }

      const acceptedAtSeconds = Math.floor(acceptedAtMs / 1000);
      const verified = await verifyW3MAgreementChallengeSignature({
        binding,
        expectedBinding,
        termsHash: row.terms_hash,
        termsVersion: row.terms_version,
        partyRole: row.party_role,
        walletAddress: row.wallet_address,
        nonce: row.nonce,
        deadline: row.signature_deadline,
      }, row.signature, acceptedAtSeconds);

      if (!verified.valid ||
        verified.recoveredAddress.toLowerCase() !== row.wallet_address.toLowerCase() ||
        verified.bindingHash.toLowerCase() !== row.binding_hash.toLowerCase()) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
