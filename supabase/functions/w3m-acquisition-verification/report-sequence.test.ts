import { resolveNextW3MReportSequence } from "./report-sequence.ts";

const DEAL = "deal-sequence-test";
const FIRST = "10000000-0000-4000-8000-000000000001";
const SECOND = "10000000-0000-4000-8000-000000000002";

Deno.test("first report sequence starts at version one without supersession", () => {
  const result = resolveNextW3MReportSequence(DEAL, null);
  if (result.reportVersion !== 1 || result.supersedesReportId !== null) {
    throw new Error("First report must be version one with no predecessor.");
  }
});

Deno.test("next report increments exactly and supersedes the latest report", () => {
  const result = resolveNextW3MReportSequence(DEAL, {
    id: FIRST, deal_id: DEAL, report_version: 7,
  });
  if (result.reportVersion !== 8 || result.supersedesReportId !== FIRST) {
    throw new Error("Next report must increment the latest version and point to its ID.");
  }
});

Deno.test("sequence resolver rejects cross-deal, malformed and exhausted latest rows", () => {
  const invalid = [
    { id: FIRST, deal_id: "another-deal", report_version: 1 },
    { id: "not-a-uuid", deal_id: DEAL, report_version: 1 },
    { id: FIRST, deal_id: DEAL, report_version: 0 },
    { id: FIRST, deal_id: DEAL, report_version: 2147483647 },
  ];
  for (const latest of invalid) {
    let rejected = false;
    try { resolveNextW3MReportSequence(DEAL, latest); } catch { rejected = true; }
    if (!rejected) throw new Error("Malformed latest report row must fail closed.");
  }
});

Deno.test("sequence resolver rejects a blank deal ID", () => {
  let rejected = false;
  try { resolveNextW3MReportSequence(" ", null); } catch { rejected = true; }
  if (!rejected) throw new Error("Blank deal IDs must be rejected.");
});
