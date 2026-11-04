/**
 * Server-only GitHub Actions dispatcher for W3M static-analysis jobs.
 *
 * Keep the GitHub token in Supabase Edge Function secrets. Never return it,
 * log it, or pass it to the scanner workflow as an input or artifact.
 */
import JSZip from "npm:jszip@3.10.1";

export type StaticAnalysisTarget = {
  owner: string;
  repo: string;
  commitSha: string;
  auditId: string;
};

const GITHUB_API = "https://api.github.com";
const CONTROL_REPOSITORY = "Aminzaki1972/Web3Market";
const WORKFLOW_FILE = "w3m-contract-analysis.yml";
const CONTROL_WORKFLOW_REF = "main";

export function validateStaticAnalysisTarget(input: StaticAnalysisTarget): StaticAnalysisTarget {
  const owner = String(input.owner || "").trim();
  const repo = String(input.repo || "").trim().replace(/\.git$/i, "");
  const commitSha = String(input.commitSha || "").trim().toLowerCase();
  const auditId = String(input.auditId || "").trim();

  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo)) {
    throw new Error("Invalid GitHub owner or repository name.");
  }
  if (!/^[a-f0-9]{40}$/.test(commitSha)) {
    throw new Error("Static analysis requires an immutable 40-character commit SHA.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(auditId)) {
    throw new Error("A valid W3M audit UUID is required.");
  }
  return { owner, repo, commitSha, auditId };
}

export type StaticAnalysisReport = {
  schema_version: "w3m.static-analysis.v1";
  repository: string;
  commit_sha: string;
  audit_id: string;
  analysis_scope: "solidity_static_analysis";
  engines: Record<"slither" | "aderyn", { version: string; status: string; process_exit_code: number }>;
  findings: Array<Record<string, unknown>>;
};

export function validateStaticAnalysisReport(
  value: unknown,
  expected: { repository: string; commitSha: string; auditId: string },
): StaticAnalysisReport {
  if (!value || typeof value !== "object") throw new Error("Static-analysis artifact is not a JSON object.");
  const report = value as Record<string, any>;
  if (report.schema_version !== "w3m.static-analysis.v1" ||
      report.analysis_scope !== "solidity_static_analysis") {
    throw new Error("Unsupported static-analysis report schema or scope.");
  }
  if (String(report.repository || "").toLowerCase() !== expected.repository.toLowerCase() ||
      String(report.commit_sha || "").toLowerCase() !== expected.commitSha.toLowerCase() ||
      String(report.audit_id || "") !== expected.auditId) {
    throw new Error("Static-analysis report does not match the requested repository, commit, and audit.");
  }
  for (const engine of ["slither", "aderyn"]) {
    const item = report.engines?.[engine];
    if (!item || !["completed", "unsupported_evm_target", "failed"].includes(item.status) || !Number.isInteger(item.process_exit_code)) {
      throw new Error(`Static-analysis report is missing a valid ${engine} execution status.`);
    }
  }
  if (!Array.isArray(report.findings) ||
      report.findings.some((item: any) => !item || typeof item !== "object" ||
        item.confirmed !== false || item.triage_status !== "needs_ai_triage" ||
        typeof item.fingerprint !== "string" || !item.fingerprint)) {
    throw new Error("Static-analysis report contains invalid or pre-confirmed findings.");
  }
  return report as StaticAnalysisReport;
}

export async function retrieveStaticAnalysisReport(
  targetInput: StaticAnalysisTarget,
  options: { token: string; maxRunPages?: number },
): Promise<{ state: "pending" | "completed"; runId?: number; report?: StaticAnalysisReport }> {
  const target = validateStaticAnalysisTarget(targetInput);
  const token = String(options.token || "").trim();
  if (!token) throw new Error("W3M_GITHUB_ACTIONS_TOKEN is not configured.");
  const [controlOwner, controlRepo] = CONTROL_REPOSITORY.split("/");
  const headers = {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Web3Market-W3M-Code-Audit",
  };
  const base = `${GITHUB_API}/repos/${encodeURIComponent(controlOwner)}/${encodeURIComponent(controlRepo)}`;
  let matched: any = null;
  const pages = Math.min(5, Math.max(1, options.maxRunPages ?? 3));
  for (let page = 1; page <= pages && !matched; page++) {
    const url = `${base}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=100&page=${page}`;
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Unable to inspect static-analysis workflow runs (HTTP ${response.status}).`);
    const payload = await response.json();
    const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
    matched = runs.find((run: any) =>
      run?.display_title === `W3M Static Analysis ${target.auditId}` &&
      run?.head_branch && run?.workflow_id
    ) || null;
    if (runs.length < 100) break;
  }
  if (!matched) return { state: "pending" };
  if (matched.status !== "completed") return { state: "pending", runId: Number(matched.id) };
  if (matched.conclusion !== "success") {
    throw new Error(`Static-analysis workflow ended with conclusion: ${String(matched.conclusion || "unknown")}.`);
  }

  const artifactsResponse = await fetch(`${base}/actions/runs/${Number(matched.id)}/artifacts?per_page=100`, { headers });
  if (!artifactsResponse.ok) throw new Error(`Unable to list static-analysis artifacts (HTTP ${artifactsResponse.status}).`);
  const artifactPayload = await artifactsResponse.json();
  const artifact = (Array.isArray(artifactPayload?.artifacts) ? artifactPayload.artifacts : [])
    .find((item: any) => item?.name?.startsWith("w3m-contract-analysis-") && !item?.expired);
  if (!artifact) throw new Error("Workflow completed without a Solidity static-analysis artifact; this is not a clean scan.");
  const downloadResponse = await fetch(`${base}/actions/artifacts/${Number(artifact.id)}/zip`, { headers });
  if (!downloadResponse.ok) throw new Error(`Unable to download static-analysis artifact (HTTP ${downloadResponse.status}).`);
  const zip = await JSZip.loadAsync(await downloadResponse.arrayBuffer());
  const reportFile = Object.values(zip.files).find((entry: any) =>
    !entry.dir && entry.name.split("/").pop() === "w3m-contract-analysis.json"
  ) as any;
  if (!reportFile) throw new Error("Normalized static-analysis JSON is missing from the artifact.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await reportFile.async("string"));
  } catch (_) {
    throw new Error("Normalized static-analysis report is not valid JSON.");
  }
  const report = validateStaticAnalysisReport(parsed, {
    repository: `${target.owner}/${target.repo}`,
    commitSha: target.commitSha,
    auditId: target.auditId,
  });
  return { state: "completed", runId: Number(matched.id), report };
}

export async function dispatchStaticAnalysis(
  targetInput: StaticAnalysisTarget,
  options: { token: string },
): Promise<{ accepted: true; repository: string; commitSha: string; auditId: string }> {
  const target = validateStaticAnalysisTarget(targetInput);
  const token = String(options.token || "").trim();
  if (!token) throw new Error("W3M_GITHUB_ACTIONS_TOKEN is not configured.");
  const [controlOwner, controlRepo] = CONTROL_REPOSITORY.split("/");
  const endpoint = `${GITHUB_API}/repos/${encodeURIComponent(controlOwner)}/${encodeURIComponent(controlRepo)}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "Web3Market-W3M-Code-Audit",
    },
    body: JSON.stringify({
      ref: CONTROL_WORKFLOW_REF,
      inputs: {
        repository_url: `https://github.com/${target.owner}/${target.repo}`,
        commit_sha: target.commitSha,
        audit_id: target.auditId,
      },
    }),
  });

  if (response.status !== 204) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = typeof payload?.message === "string" ? payload.message : "";
    } catch (_) {
      // Do not include response bodies or request headers in logs.
    }
    if (response.status === 404) {
      throw new Error("GitHub workflow dispatch is unavailable. Confirm the workflow exists on the repository default branch and the token has Actions read/write access.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("GitHub rejected the workflow dispatch credential or permission (401/403). Check the repository-scoped Actions permission and token expiry.");
    }
    throw new Error(`GitHub workflow dispatch failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 180)}` : ""}.`);
  }

  return {
    accepted: true,
    repository: `${target.owner}/${target.repo}`,
    commitSha: target.commitSha,
    auditId: target.auditId,
  };
}
