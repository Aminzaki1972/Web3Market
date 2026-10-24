import { assertEquals, assert } from "jsr:@std/assert@1";
import { selectAuditBatch, selectAuditCandidates } from "./audit-selection.ts";

// Pinned public repository commit: this is a live GitHub tree integration test,
// not a Gemini/Supabase end-to-end audit. It uses no credentials or paid services.
Deno.test("real public repository tree is covered across every bounded batch", async () => {
  const owner = "OpenZeppelin";
  const repo = "openzeppelin-contracts";
  const sha = "11565e5f6277a320408025e649240056ba6a3919";
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    { headers: { "User-Agent": "Web3Market-W3M-Audit-Integration-Test", "Accept": "application/vnd.github+json" } },
  );
  assert(response.ok, `GitHub tree request failed: HTTP ${response.status}`);
  const tree = await response.json();
  assertEquals(tree.truncated, false, "pinned public repository tree must not be truncated");

  const selected = selectAuditCandidates(tree.tree || [], Number.MAX_SAFE_INTEGER);
  assert(selected.candidateCount > 100, `expected >100 eligible files; got ${selected.candidateCount}`);
  assertEquals(selected.candidates.length, selected.candidateCount);

  const batchSize = 100;
  const first = selectAuditBatch(selected.candidates, 0, batchSize);
  assert(first.totalBatches > 1, "fixture must exercise multiple batches");
  const flattened: string[] = [];
  for (let index = 0; index < first.totalBatches; index++) {
    const batch = selectAuditBatch(selected.candidates, index, batchSize);
    assertEquals(batch.batchIndex, index);
    assert(batch.candidates.length > 0 && batch.candidates.length <= batchSize);
    flattened.push(...batch.candidates.map((file: any) => file.path));
  }

  assertEquals(flattened.length, selected.candidateCount);
  assertEquals(new Set(flattened).size, selected.candidateCount, "a path must not appear in multiple batches");
  assertEquals(flattened, selected.candidates.map((file: any) => file.path), "batch concatenation must preserve the selected order");
});
