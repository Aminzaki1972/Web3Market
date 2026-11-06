import {
  handleW3MReportIssueRequest,
  type W3MReportIssueRequestDependencies,
} from "./report-issue-request-handler.ts";
const DEAL = "11111111-1111-4111-8111-111111111111";
function request(body: unknown, method = "POST", auth = "Bearer valid") {
  return new Request("https://w3m.invalid/report", {
    method,
    headers: { authorization: auth, "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}
function deps(overrides: Partial<W3MReportIssueRequestDependencies> = {}) {
  const calls: string[] = [];
  const value: W3MReportIssueRequestDependencies = {
    authenticate: async () => { calls.push("auth"); return "user-1"; },
    authorize: async () => { calls.push("authorize"); return true; },
    issue: async () => {
      calls.push("issue");
      return { reportId: "report-1", reportVersion: 1, decisionStatus: "PASS" };
    },
    ...overrides,
  };
  return { value, calls };
}
Deno.test("report issue rejects non-POST", async () => {
  const d = deps();
  const response = await handleW3MReportIssueRequest(request({}, "GET"), d.value);
  if (response.status !== 405 || d.calls.length !== 0) throw new Error("method boundary failed");
});
Deno.test("report issue requires authentication", async () => {
  const d = deps();
  const response = await handleW3MReportIssueRequest(request({ deal_id: DEAL }, "POST", ""), d.value);
  if (response.status !== 401 || d.calls.length !== 0) throw new Error("auth boundary failed");
});
Deno.test("report issue rejects caller-supplied evidence and signer fields", async () => {
  const d = deps();
  const response = await handleW3MReportIssueRequest(request({ deal_id: DEAL, status: "PASS", signature: "0x123" }), d.value);
  if (response.status !== 400 || d.calls.includes("issue")) throw new Error("untrusted input accepted");
});
Deno.test("report issue authorizes before issuing and never authorizes settlement", async () => {
  const d = deps();
  const response = await handleW3MReportIssueRequest(request({ deal_id: DEAL }), d.value);
  const body = await response.json();
  if (response.status !== 200 || d.calls.join(",") !== "auth,authorize,issue") throw new Error("issuance order failed");
  if (body.settlement_authorized !== false || body.execution_enabled !== false) throw new Error("issuance crossed settlement boundary");
});
Deno.test("report issue denies unauthorized actors", async () => {
  const d = deps({ authorize: async () => false });
  const response = await handleW3MReportIssueRequest(request({ deal_id: DEAL }), d.value);
  if (response.status !== 403 || d.calls.includes("issue")) throw new Error("authorization bypass");
});
