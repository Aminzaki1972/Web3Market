import { assertEquals, assertNotEquals, assertThrows } from "jsr:@std/assert@1";
import type { AcquisitionEvidence } from "./decision-engine.ts";
import { assertDealCodeAuditMatchesProjectRepository, buildDealCodeAuditBinding } from "./deal-code-audit-binding.ts";

const dealId = "44444444-4444-4444-8444-444444444444";
const projectId = "11111111-1111-4111-8111-111111111111";
const auditId = "22222222-2222-4222-8222-222222222222";
const commitSha = "a".repeat(40);

function evidence(overrides: Partial<AcquisitionEvidence> = {}): AcquisitionEvidence {
  return {
    id: "code-audit:" + auditId,
    type: "CODE_AUDIT",
    result: "PASS",
    mandatory: true,
    dealId,
    projectId,
    contentHash: "b".repeat(64),
    observedAt: "2026-11-06T18:00:00.000Z",
    validUntil: "2026-12-01T10:00:00.000Z",
    sourceRecordId: auditId,
    sourceVersion: commitSha,
    metadata: {
      auditStatus: "completed",
      auditManifestVersion: "w3m-audit-manifest-v1",
      auditManifestHash: "b".repeat(64),
      auditFileCount: 190,
      auditFindingCount: 25,
      auditType: "code",
      commitSha,
      repositoryOwner: "Aminzaki1972",
      repositoryName: "Web3Market",
      completedAt: "2026-11-01T10:00:00.000Z",
    },
    ...overrides,
  };
}

Deno.test("builds a canonical immutable audit binding from passing evidence", () => {
  const result = buildDealCodeAuditBinding({ evidence: evidence(), expectedDealId: dealId, expectedProjectId: projectId });
  assertEquals(result.auditId, auditId);
  assertEquals(result.repositoryUrl, "https://github.com/Aminzaki1972/Web3Market");
  assertEquals(result.commitSha, commitSha);
  assertEquals(result.auditType, "code");
  assertEquals(result.completedAt, "2026-11-01T10:00:00.000Z");
});

Deno.test("binding changes when selected audit or commit changes", () => {
  const first = buildDealCodeAuditBinding({ evidence: evidence(), expectedDealId: dealId, expectedProjectId: projectId });
  const second = buildDealCodeAuditBinding({
    evidence: evidence({ sourceVersion: "c".repeat(40), metadata: { ...evidence().metadata, commitSha: "c".repeat(40) } }),
    expectedDealId: dealId,
    expectedProjectId: projectId,
  });
  assertNotEquals(first.commitSha, second.commitSha);
});

Deno.test("rejects evidence not passing, mandatory, or bound to exact deal/project", () => {
  assertThrows(() => buildDealCodeAuditBinding({ evidence: evidence({ result: "REVIEW_REQUIRED" }), expectedDealId: dealId, expectedProjectId: projectId }));
  assertThrows(() => buildDealCodeAuditBinding({ evidence: evidence({ mandatory: false }), expectedDealId: dealId, expectedProjectId: projectId }));
  assertThrows(() => buildDealCodeAuditBinding({ evidence: evidence({ projectId: "33333333-3333-4333-8333-333333333333" }), expectedDealId: dealId, expectedProjectId: projectId }));
});

Deno.test("rejects malformed audit IDs, commits, repository names, scope and timestamps", () => {
  assertThrows(() => buildDealCodeAuditBinding({ evidence: evidence({ sourceRecordId: "bad" }), expectedDealId: dealId, expectedProjectId: projectId }));
  assertThrows(() => buildDealCodeAuditBinding({ evidence: evidence({ sourceVersion: "bad" }), expectedDealId: dealId, expectedProjectId: projectId }));
  assertThrows(() => buildDealCodeAuditBinding({ evidence: evidence({ metadata: { ...evidence().metadata, repositoryName: "../other" } }), expectedDealId: dealId, expectedProjectId: projectId }));
  assertThrows(() => buildDealCodeAuditBinding({ evidence: evidence({ metadata: { ...evidence().metadata, auditType: "unknown" } }), expectedDealId: dealId, expectedProjectId: projectId }));
  assertThrows(() => buildDealCodeAuditBinding({ evidence: evidence({ metadata: { ...evidence().metadata, completedAt: "2026-11-07T00:00:00.000Z" } }), expectedDealId: dealId, expectedProjectId: projectId }));
});


Deno.test("requires a valid evidence observation inside the audit validity interval", () => {
  assertThrows(() => buildDealCodeAuditBinding({
    evidence: evidence({ validUntil: null }),
    expectedDealId: dealId,
    expectedProjectId: projectId,
  }));
  assertThrows(() => buildDealCodeAuditBinding({
    evidence: evidence({ observedAt: "not-a-date" }),
    expectedDealId: dealId,
    expectedProjectId: projectId,
  }));
  assertThrows(() => buildDealCodeAuditBinding({
    evidence: evidence({ observedAt: "2026-12-01T10:00:00.000Z" }),
    expectedDealId: dealId,
    expectedProjectId: projectId,
  }));
  assertThrows(() => buildDealCodeAuditBinding({
    evidence: evidence({ validUntil: "2026-10-31T10:00:00.000Z" }),
    expectedDealId: dealId,
    expectedProjectId: projectId,
  }));
});


Deno.test("authoritative project repository must match the selected audit repository", () => {
  const binding = buildDealCodeAuditBinding({
    evidence: evidence(),
    expectedDealId: dealId,
    expectedProjectId: projectId,
  });
  assertEquals(
    assertDealCodeAuditMatchesProjectRepository(binding, "https://github.com/Aminzaki1972/Web3Market/"),
    undefined,
  );
  assertEquals(
    assertDealCodeAuditMatchesProjectRepository(binding, "https://github.com/Aminzaki1972/Web3Market.git"),
    undefined,
  );
  assertThrows(() => assertDealCodeAuditMatchesProjectRepository(
    binding,
    "https://github.com/another-owner/Web3Market",
  ));
  assertThrows(() => assertDealCodeAuditMatchesProjectRepository(
    binding,
    "https://github.com/Aminzaki1972/another-repository",
  ));
});

Deno.test("project repository comparison rejects non-canonical and ambiguous URLs", () => {
  const binding = buildDealCodeAuditBinding({
    evidence: evidence(),
    expectedDealId: dealId,
    expectedProjectId: projectId,
  });
  for (const url of [
    null,
    "",
    "http://github.com/Aminzaki1972/Web3Market",
    "https://github.com.evil.example/Aminzaki1972/Web3Market",
    "https://user@github.com/Aminzaki1972/Web3Market",
    "https://github.com/Aminzaki1972/Web3Market/tree/main",
    "https://github.com/Aminzaki1972%2FWeb3Market",
    "https://github.com/Aminzaki1972/Web3Market?tab=readme",
  ]) {
    assertThrows(() => assertDealCodeAuditMatchesProjectRepository(binding, url));
  }
});
