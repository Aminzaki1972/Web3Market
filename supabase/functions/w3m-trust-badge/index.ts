import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { collectPages } from "../w3m-code-audit/audit-pagination.ts";
import { evaluateTrustBadge, type AuditEvidence } from "./eligibility.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function parseGitHubRepo(value: unknown): { owner: string; name: string } | null {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) return null;
    const owner = parts[0];
    const name = parts[1].replace(/\.git$/i, "");
    if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(name)) return null;
    return { owner, name };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.project_id || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
      return json({ ok: false, error: "A valid project_id is required" }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ ok: false, error: "Trust badge service is not configured" }, 503);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: project, error: projectError } = await admin
      .from("projects")
      .select("id,status,github_url")
      .eq("id", projectId)
      .maybeSingle();
    if (projectError) throw projectError;
    if (!project || !["active", "sold"].includes(String(project.status))) {
      return json({ ok: true, badge: null, reason: "listing_not_public" });
    }

    const projectRepo = parseGitHubRepo(project.github_url);
    if (!projectRepo) return json({ ok: true, badge: null, reason: "listing_repository_unavailable" });

    const { data: audit, error: auditError } = await admin
      .from("code_audits")
      .select("id,project_id,repo_url,repo_owner,repo_name,branch,commit_sha,status,overall_score,files_scanned,critical_count,high_count,completed_at,analysis_progress")
      .eq("project_id", projectId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (auditError) throw auditError;
    if (!audit) return json({ ok: true, badge: null, reason: "completed_audit_not_found" });

    const auditOwner = String(audit.repo_owner || "");
    const auditName = String(audit.repo_name || "");
    if (auditOwner.toLowerCase() !== projectRepo.owner.toLowerCase() ||
        auditName.toLowerCase() !== projectRepo.name.toLowerCase()) {
      return json({ ok: true, badge: null, reason: "audit_repository_mismatch" });
    }

    const progress = audit.analysis_progress && typeof audit.analysis_progress === "object"
      ? audit.analysis_progress as Record<string, unknown>
      : {};
    if (progress.evidence_version !== "w3m-audit-evidence-v1" || progress.tree_truncated !== false) {
      return json({ ok: true, badge: null, reason: "structured_audit_evidence_missing" });
    }

    const persistedFiles = await collectPages(async (from, to) =>
      await admin.from("code_audit_files").select("path").eq("audit_id", audit.id).range(from, to)
    );
    const persistedFindings = await collectPages(async (from, to) =>
      await admin.from("code_audit_findings").select("severity").eq("audit_id", audit.id).range(from, to)
    );
    const findingCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const finding of persistedFindings) {
      const severity = String(finding.severity || "").toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(findingCounts, severity)) {
        return json({ ok: true, badge: null, reason: "unknown_finding_severity" });
      }
      findingCounts[severity]++;
    }
    if (Number(audit.critical_count) !== findingCounts.critical ||
        Number(audit.high_count) !== findingCounts.high) {
      return json({ ok: true, badge: null, reason: "finding_count_mismatch" });
    }

    const branch = String(audit.branch || "main");
    if (branch.length > 200 || branch.includes("..")) {
      return json({ ok: true, badge: null, reason: "invalid_audit_branch" });
    }
    const githubResponse = await fetch(
      "https://api.github.com/repos/" + encodeURIComponent(auditOwner) + "/" +
      encodeURIComponent(auditName) + "/commits/" + encodeURIComponent(branch),
      { headers: { "Accept": "application/vnd.github+json", "User-Agent": "Web3Market-Trust-Badge" } },
    );
    if (!githubResponse.ok) return json({ ok: false, badge: null, reason: "github_commit_check_unavailable" }, 503);
    const githubHead = await githubResponse.json();
    const currentCommitSha = String(githubHead?.sha || "");

    const evidence: AuditEvidence = {
      audit_id: String(audit.id),
      status: String(audit.status),
      overall_score: Number(audit.overall_score),
      files_scanned: Number(progress.files_scanned),
      eligible_files: Number(progress.eligible_files),
      persisted_file_count: persistedFiles.length,
      oversized_files: Number(progress.oversized_files),
      unreadable_files: Number(progress.unreadable_files),
      critical_count: findingCounts.critical,
      high_count: findingCounts.high,
      commit_sha: String(audit.commit_sha || ""),
      current_commit_sha: currentCommitSha,
    };
    const decision = evaluateTrustBadge(evidence);
    return json({
      ok: true,
      badge: decision.eligible ? decision.badge : null,
      reason: decision.reason,
      audit_id: audit.id,
      score: Number(audit.overall_score),
      audited_commit: String(audit.commit_sha || ""),
      current_commit: currentCommitSha,
      completed_at: audit.completed_at,
      evidence_version: progress.evidence_version,
      premium_status: Number(audit.overall_score) >= 90 ? "admin_approval_ledger_required" : "not_applicable",
    });
  } catch (error) {
    console.error("w3m-trust-badge request failed", error instanceof Error ? error.message : "unknown error");
    return json({ ok: false, error: "Unable to verify this trust badge right now" }, 500);
  }
});
