import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import {
  createW3MDealAuditBinding,
  verifyW3MDealAuditBinding,
  type W3MDealAuditBinding,
  type W3MDealAuditBindingInput,
} from "./deal-audit-binding.ts";

const base: W3MDealAuditBindingInput = {
  dealId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  auditId: "33333333-3333-4333-8333-333333333333",
  fingerprintId: "44444444-4444-4444-8444-444444444444",
  fingerprintDigest: "a".repeat(64),
  repository: "Aminzaki1972/Web3Market",
  commitSha: "b".repeat(40),
};

Deno.test("creates a deterministic binding for one deal and one audit fingerprint", async () => {
  const first = await createW3MDealAuditBinding(base);
  const second = await createW3MDealAuditBinding({
    ...base,
    repository: "aminzaki1972/web3market",
    commitSha: base.commitSha.toUpperCase(),
    fingerprintDigest: base.fingerprintDigest.toUpperCase(),
  });
  assertEquals(first, second);
  assertEquals(first.schema, "w3m-deal-audit-binding-v1");
  assertEquals(first.binding_hash.length, 64);
});

Deno.test("binding verification fails if deal, project, audit, fingerprint, digest, repo, or commit changes", async () => {
  const binding = await createW3MDealAuditBinding(base);
  assertEquals(await verifyW3MDealAuditBinding(binding, base), true);
  const mutations: W3MDealAuditBindingInput[] = [
    { ...base, dealId: "55555555-5555-4555-8555-555555555555" },
    { ...base, projectId: "66666666-6666-4666-8666-666666666666" },
    { ...base, auditId: "77777777-7777-4777-8777-777777777777" },
    { ...base, fingerprintId: "88888888-8888-4888-8888-888888888888" },
    { ...base, fingerprintDigest: "c".repeat(64) },
    { ...base, repository: "someone/else" },
    { ...base, commitSha: "d".repeat(40) },
  ];
  for (const changed of mutations) {
    assertEquals(await verifyW3MDealAuditBinding(binding, changed), false);
  }
});

Deno.test("is idempotent for an identical binding already stored for the same deal", async () => {
  const binding = await createW3MDealAuditBinding(base);
  assertEquals(await createW3MDealAuditBinding(base, [binding]), binding);
});

Deno.test("rejects rebinding a deal to a different fingerprint or evidence", async () => {
  const binding = await createW3MDealAuditBinding(base);
  await assertRejects(() => createW3MDealAuditBinding({
    ...base,
    fingerprintId: "55555555-5555-4555-8555-555555555555",
    fingerprintDigest: "c".repeat(64),
  }, [binding]));
});

Deno.test("allows the same fingerprint to support another deal only for the exact same project evidence", async () => {
  const existing = await createW3MDealAuditBinding(base);
  const secondDeal = await createW3MDealAuditBinding({
    ...base,
    dealId: "55555555-5555-4555-8555-555555555555",
  }, [existing]);
  assertEquals(secondDeal.project_id, existing.project_id);
  assertEquals(secondDeal.fingerprint_id, existing.fingerprint_id);
  await assertRejects(() => createW3MDealAuditBinding({
    ...base,
    dealId: "66666666-6666-4666-8666-666666666666",
    projectId: "77777777-7777-4777-8777-777777777777",
  }, [existing]));
});

Deno.test("rejects corrupted, duplicate, or malformed existing bindings", async () => {
  const binding = await createW3MDealAuditBinding(base);
  const corrupted = { ...binding, binding_hash: "0".repeat(64) };
  await assertRejects(() => createW3MDealAuditBinding({
    ...base,
    dealId: "55555555-5555-4555-8555-555555555555",
  }, [corrupted]));
  await assertRejects(() => createW3MDealAuditBinding(base, [binding, binding]));
  await assertRejects(() => createW3MDealAuditBinding(base, [{ ...binding, schema: "wrong" } as unknown as W3MDealAuditBinding]));
});

Deno.test("rejects invalid identifiers, digests, repositories, and commit SHAs", async () => {
  await assertRejects(() => createW3MDealAuditBinding({ ...base, dealId: "bad" }));
  await assertRejects(() => createW3MDealAuditBinding({ ...base, fingerprintDigest: "bad" }));
  await assertRejects(() => createW3MDealAuditBinding({ ...base, repository: "../repo" }));
  await assertRejects(() => createW3MDealAuditBinding({ ...base, commitSha: "short" }));
});
