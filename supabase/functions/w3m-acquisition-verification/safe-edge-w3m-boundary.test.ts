import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { executeOnlyAfterW3M } from "./safe-edge-w3m-boundary.ts";

Deno.test("blocked W3M authorization never invokes protected action", async () => {
  let invoked = false;
  const result = await executeOnlyAfterW3M(
    async () => ({ authorized: false, issues: ["REPORT_MISSING"] }),
    async () => { invoked = true; return "side-effect"; },
  );
  assertEquals(result.allowed, false);
  assertEquals(result.authorization.issues, ["REPORT_MISSING"]);
  assertEquals(invoked, false);
});

Deno.test("authorization infrastructure failure fails closed", async () => {
  let invoked = false;
  const result = await executeOnlyAfterW3M(
    async () => { throw new Error("registry unavailable"); },
    async () => { invoked = true; return true; },
  );
  assertEquals(result.allowed, false);
  assertEquals(result.authorization.issues, ["W3M_AUTHORIZATION_UNAVAILABLE"]);
  assertEquals(invoked, false);
});

Deno.test("malformed authorization fails closed", async () => {
  let invoked = false;
  const result = await executeOnlyAfterW3M(
    async () => ({ authorized: true, issues: ["unexpected issue"] }),
    async () => { invoked = true; return true; },
  );
  assertEquals(result.allowed, false);
  assertEquals(invoked, false);
});

Deno.test("valid fresh authorization invokes protected action exactly once", async () => {
  let count = 0;
  const result = await executeOnlyAfterW3M(
    async () => ({
      authorized: true,
      issues: [],
      reportId: "report-1",
      reportVersion: 3,
    }),
    async () => { count += 1; return "prepared"; },
  );
  assertEquals(result.allowed, true);
  assertEquals(result.value, "prepared");
  assertEquals(count, 1);
});

Deno.test("protected action errors are propagated, not disguised as W3M denial", async () => {
  await assertRejects(
    () => executeOnlyAfterW3M(
      async () => ({ authorized: true, issues: [] }),
      async () => { throw new Error("database write failed"); },
    ),
    Error,
    "database write failed",
  );
});
