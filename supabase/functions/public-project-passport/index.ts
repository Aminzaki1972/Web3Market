import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGINS = new Set([
  "https://web3market.xyz",
  "https://www.web3market.xyz",
  "https://web3market.pages.dev",
]);
const BASE_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
function cors(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return { ...BASE_HEADERS, "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://web3market.xyz" };
}
function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors(req) });
}
function normalizeRepo(value: unknown) {
  return String(value || "").trim().replace(/\.git$/i, "").replace(/\/+$/, "").toLowerCase();
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_SELECT = "id,title,description,short_description,full_description,category,website_url,github_url,technology_stack,blockchain,ai_score,status,project_status,ai_status,created_at,w3m_identity_id,verification";
const AUDIT_SELECT = "id,repo_url,branch,commit_sha,status,overall_score,security_score,risk_level,critical_count,high_count,medium_count,low_count,info_count,created_at,completed_at,files_scanned,lines_scanned";

async function rest(path: string, serviceKey: string) {
  const response = await fetch(path, {
    headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, Accept: "application/json" },
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error("Marketplace lookup failed (" + response.status + ").");
  return await response.json();
}
function eligible(project: any, byId: boolean) {
  const allowed = byId ? ["active", "sold", "archived"] : ["active", "sold"];
  return allowed.includes(String(project?.status || "").toLowerCase()) &&
    String(project?.project_status || "").toLowerCase() === "approved" &&
    String(project?.ai_status || "").toLowerCase() === "approved" &&
    project?.verification?.ai?.test_mode !== true;
}
async function identityFor(project: any, url: string, key: string) {
  if (!project?.w3m_identity_id) return null;
  const endpoint = new URL(url + "/rest/v1/project_identities");
  endpoint.searchParams.set("id", "eq." + project.w3m_identity_id);
  endpoint.searchParams.set("select", "identity_code,first_seen_at,identity_status");
  endpoint.searchParams.set("limit", "1");
  const rows = await rest(endpoint.toString(), key);
  return Array.isArray(rows) ? rows[0] || null : null;
}
async function auditHistory(project: any, url: string, key: string) {
  const repo = normalizeRepo(project?.github_url);
  if (!repo) return [];
  const endpoint = new URL(url + "/rest/v1/code_audits");
  endpoint.searchParams.set("select", AUDIT_SELECT);
  endpoint.searchParams.set("status", "eq.completed");
  endpoint.searchParams.set("order", "created_at.desc");
  endpoint.searchParams.set("limit", "100");
  const rows = await rest(endpoint.toString(), key);
  if (!Array.isArray(rows)) return [];
  return rows.filter((audit: any) => normalizeRepo(audit.repo_url) === repo).slice(0, 10).map((audit: any) => ({
    id: audit.id, branch: audit.branch, commit_sha: audit.commit_sha, status: "completed",
    overall_score: audit.overall_score, security_score: audit.security_score, risk_level: audit.risk_level,
    critical_count: audit.critical_count, high_count: audit.high_count, medium_count: audit.medium_count,
    low_count: audit.low_count, info_count: audit.info_count, created_at: audit.created_at,
    completed_at: audit.completed_at, files_scanned: audit.files_scanned, lines_scanned: audit.lines_scanned,
  }));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "POST required" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(req, { error: "Passport service is not configured." }, 500);
  try {
    const body = await req.json();
    const query = String(body?.query || "").trim().slice(0, 180);
    if (!query) return json(req, { success: true, project: null, identity: null, audits: [] });
    const byId = UUID.test(query);
    const endpoint = new URL(supabaseUrl + "/rest/v1/projects");
    endpoint.searchParams.set("select", PROJECT_SELECT);
    endpoint.searchParams.set("status", byId ? "in.(active,sold,archived)" : "in.(active,sold)");
    endpoint.searchParams.set("order", "created_at.desc");
    endpoint.searchParams.set("limit", byId ? "1" : "20");
    if (byId) endpoint.searchParams.set("id", "eq." + query);
    else {
      const safeQuery = query.replace(/[,*()]/g, " ").trim();
      if (!safeQuery) return json(req, { success: true, project: null, identity: null, audits: [] });
      endpoint.searchParams.set("title", "ilike.*" + safeQuery + "*");
    }
    const raw = await rest(endpoint.toString(), serviceKey);
    const candidates = (Array.isArray(raw) ? raw : []).filter((project: any) => eligible(project, byId));
    if (!candidates.length) return json(req, { success: true, project: null, identity: null, audits: [] });
    const exact = byId ? candidates[0] : candidates.find((project: any) => String(project.title || "").trim().toLowerCase() === query.toLowerCase());
    if (!byId && !exact && candidates.length > 1) {
      return json(req, { success: true, matches: candidates.map((project: any) => ({ id: project.id, title: project.title })) });
    }
    const project = exact || candidates[0];
    const safeProject = {
      id: project.id, title: project.title, description: project.description,
      short_description: project.short_description, full_description: project.full_description,
      category: project.category, website_url: project.website_url, github_url: project.github_url,
      technology_stack: project.technology_stack, blockchain: project.blockchain, ai_score: project.ai_score,
      status: project.status, project_status: project.project_status, ai_status: project.ai_status,
      created_at: project.created_at, w3m_identity_id: project.w3m_identity_id,
    };
    const [identity, audits] = await Promise.all([
      identityFor(project, supabaseUrl, serviceKey),
      auditHistory(project, supabaseUrl, serviceKey),
    ]);
    return json(req, { success: true, project: safeProject, identity, audits });
  } catch (error) {
    return json(req, { error: error instanceof Error ? error.message : "Unexpected Passport error." }, 500);
  }
});
