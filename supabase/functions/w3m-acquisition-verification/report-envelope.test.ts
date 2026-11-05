import { buildCanonicalReportEnvelope, type ReportEnvelopeInput } from "./report-envelope.ts";
import type { AcquisitionDecision } from "./decision-engine.ts";

const HASH = "a".repeat(64);
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

function fixture(overrides: Partial<ReportEnvelopeInput> = {}): ReportEnvelopeInput {
  const decision: AcquisitionDecision = {
    status: "PASS",
    engineVersion: "w3m-acquisition-verification-1.0.0",
    dealId: "deal-1",
    projectId: "project-1",
    evidenceHash: HASH,
    checkedAt: "2026-11-05T20:00:00.000Z",
    issues: [],
    evidenceCount: 8,
    passedMandatoryCount: 8,
    requiredTypeCount: 8,
  };
  return {
    reportId: "report-1",
    reportVersion: 1,
    supersedesReportId: null,
    buyerId: "buyer-1",
    sellerId: "seller-1",
    dealTermsHash: "b".repeat(64),
    auditId: "audit-1",
    expectedCommitSha: COMMIT,
    issuedAt: "2026-11-05T20:00:00.000Z",
    expiresAt: "2026-11-05T20:10:00.000Z",
    decision,
    ...overrides,
  };
}

Deno.test("builds canonical report envelope and stable report hash", async () => {
  const first = await buildCanonicalReportEnvelope(fixture());
  const second = await buildCanonicalReportEnvelope(fixture());
  if (first.reportHash !== second.reportHash) throw new Error("Identical report inputs must hash identically.");
  if (first.envelope.protocol !== "W3M Protocol V1") throw new Error("Protocol label mismatch.");
  if (first.envelope.status !== "PASS") throw new Error("Report status mismatch.");
});

Deno.test("canonicalizes commit SHA casing and timestamp formats", async () => {
  const input = fixture({ expectedCommitSha: COMMIT.toUpperCase(), issuedAt: "2026-11-05T22:00:00+02:00" });
  const normalized = await buildCanonicalReportEnvelope(input);
  if (normalized.envelope.expectedCommitSha !== COMMIT) throw new Error("Commit SHA must be lowercase.");
  if (normalized.envelope.issuedAt !== "2026-11-05T20:00:00.000Z") throw new Error("Timestamp must be canonical UTC.");
});

Deno.test("rejects invalid evidence and terms hashes", async () => {
  for (const overrides of [
    { decision: { ...fixture().decision, evidenceHash: "bad" } },
    { dealTermsHash: "bad" },
  ]) {
    let rejected = false;
    try {
      await buildCanonicalReportEnvelope({ ...fixture(), ...overrides } as ReportEnvelopeInput);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Invalid hash must be rejected.");
  }
});

Deno.test("rejects expired report window", async () => {
  let rejected = false;
  try {
    await buildCanonicalReportEnvelope(fixture({ expiresAt: "2026-11-05T20:00:00.000Z" }));
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Expired report window must be rejected.");
});

Deno.test("rejects PASS report with incomplete mandatory evidence counters", async () => {
  const decision = { ...fixture().decision, passedMandatoryCount: 7 };
  let rejected = false;
  try {
    await buildCanonicalReportEnvelope(fixture({ decision }));
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Incomplete PASS decision must be rejected.");
});

Deno.test("rejects duplicate buyer and seller identities", async () => {
  let rejected = false;
  try {
    await buildCanonicalReportEnvelope(fixture({ buyerId: "same", sellerId: "same" }));
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Same buyer and seller must be rejected.");
});

Deno.test("rejects report superseding itself", async () => {
  let rejected = false;
  try {
    await buildCanonicalReportEnvelope(fixture({ supersedesReportId: "report-1" }));
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Self-superseding report must be rejected.");
});
