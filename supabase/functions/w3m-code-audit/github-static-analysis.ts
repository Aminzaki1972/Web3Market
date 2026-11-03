/**
 * Server-only GitHub Actions dispatcher for W3M static-analysis jobs.
 *
 * Keep the GitHub token in Supabase Edge Function secrets. Never return it,
 * log it, or pass it to the scanner workflow as an input or artifact.
 */
export type StaticAnalysisTarget = {
  owner: string;
  repo: string;
  commitSha: string;
  auditId: string;
};

const GITHUB_API = "https://api.github.com";
const CONTROL_REPOSITORY = "Aminzaki1972/Web3Market";
const WORKFLOW_FILE = "w3m-contract-analysis.yml";

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

export async function dispatchStaticAnalysis(
  targetInput: StaticAnalysisTarget,
  options: { token: string; workflowRef: string },
): Promise<{ accepted: true; repository: string; commitSha: string; auditId: string }> {
  const target = validateStaticAnalysisTarget(targetInput);
  const token = String(options.token || "").trim();
  const workflowRef = String(options.workflowRef || "").trim();
  if (!token) throw new Error("W3M_GITHUB_ACTIONS_TOKEN is not configured.");
  if (!workflowRef || !/^[A-Za-z0-9_./-]{1,200}$/.test(workflowRef) || workflowRef.includes("..")) {
    throw new Error("A trusted workflow ref is required.");
  }

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
      ref: workflowRef,
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
