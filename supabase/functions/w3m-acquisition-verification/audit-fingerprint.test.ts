import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { computeW3MAuditFingerprint } from "./audit-fingerprint.ts";

const base = {
  auditId: "71000000-0000-4000-8000-000000000001",
  repository: "Aminzaki1972/Web3Market",
  commitSha: "a".repeat(40),
  schemaVersion: "audit-manifest-v1",
  manifest: { files: [{ path: "src/a.ts", sha256: "b".repeat(64) }], score: 91 },
};

Deno.test("fingerprint is stable when JSON object key order differs", async () => {
  const a = await computeW3MAuditFingerprint(base);
  const b = await computeW3MAuditFingerprint({
    ...base, manifest: { score: 91, files: [{ sha256: "b".repeat(64), path: "src/a.ts" }] },
  });
  assertEquals(a.digest, b.digest);
  assertEquals(a.canonicalPayload, b.canonicalPayload);
});

Deno.test("fingerprint changes when audit evidence or commit changes", async () => {
  const a = await computeW3MAuditFingerprint(base);
  const evidenceChanged = await computeW3MAuditFingerprint({
    ...base, manifest: { ...base.manifest, score: 90 },
  });
  const commitChanged = await computeW3MAuditFingerprint({ ...base, commitSha: "c".repeat(40) });
  if (a.digest === evidenceChanged.digest || a.digest === commitChanged.digest) {
    throw new Error("A changed evidence payload or commit must change the fingerprint.");
  }
});

Deno.test("rejects missing or malformed commit SHA", async () => {
  await assertRejects(() => computeW3MAuditFingerprint({ ...base, commitSha: "" }));
  await assertRejects(() => computeW3MAuditFingerprint({ ...base, commitSha: "abc" }));
});

Deno.test("rejects non-JSON values instead of silently dropping them", async () => {
  await assertRejects(() => computeW3MAuditFingerprint({
    ...base, manifest: { score: 91, absent: undefined },
  }));
  await assertRejects(() => computeW3MAuditFingerprint({
    ...base, manifest: { score: Number.NaN },
  }));
});

Deno.test("normalizes repository and identity casing before hashing", async () => {
  const a = await computeW3MAuditFingerprint(base);
  const b = await computeW3MAuditFingerprint({
    ...base, auditId: base.auditId.toUpperCase(), repository: "aminzaki1972/web3market",
    commitSha: base.commitSha.toUpperCase(),
  });
  assertEquals(a.digest, b.digest);
});

Deno.test("fingerprint digest is a lowercase SHA-256 hex string", async () => {
  const result = await computeW3MAuditFingerprint(base);
  if (!/^[0-9a-f]{64}$/.test(result.digest)) {
    throw new Error("Fingerprint must be a 32-byte lowercase hexadecimal SHA-256 digest.");
  }
  assertEquals(result.algorithm, "sha-256");
  assertEquals(result.schemaVersion, base.schemaVersion);
});

Deno.test("array order is significant because manifest evidence order is explicit", async () => {
  const a = await computeW3MAuditFingerprint({
    ...base, manifest: { files: ["a.ts", "b.ts"] },
  });
  const b = await computeW3MAuditFingerprint({
    ...base, manifest: { files: ["b.ts", "a.ts"] },
  });
  if (a.digest === b.digest) {
    throw new Error("Reordering an evidence array must change the fingerprint.");
  }
});

Deno.test("rejects sparse arrays instead of producing invalid canonical JSON", async () => {
  const sparse = new Array(2);
  sparse[1] = "present";
  await assertRejects(() => computeW3MAuditFingerprint({
    ...base, manifest: { files: sparse },
  }));
});

Deno.test("rejects non-plain objects in the manifest", async () => {
  await assertRejects(() => computeW3MAuditFingerprint({
    ...base, manifest: { generatedAt: new Date("2026-11-07T00:00:00.000Z") },
  }));
});
