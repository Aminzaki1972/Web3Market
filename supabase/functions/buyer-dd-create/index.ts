import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const allowedOrigins = ["https://web3market.xyz", "https://www.web3market.xyz"];
const corsFor = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && allowedOrigins.includes(origin) ? origin : "https://web3market.xyz",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
});
const reply = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), {
  status, headers: { ...corsFor(origin), "Content-Type": "application/json" }
});
Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (origin && !allowedOrigins.includes(origin)) return reply({error:"Origin not allowed"},403,origin);
  if (req.method === "OPTIONS") return new Response("ok", {headers:corsFor(origin)});
  if (req.method !== "POST") return reply({error:"POST required"},405,origin);
  const auth = req.headers.get("Authorization") || "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient = createClient(url, anon, {global:{headers:{Authorization:auth}}});
  const {data:{user},error:authError} = await userClient.auth.getUser();
  if (authError || !user) return reply({error:"Sign in required"},401,origin);
  const admin = createClient(url, service);
  try {
    const profile = await admin.from("profiles").select("role").eq("id",user.id).maybeSingle();
    if (profile.error || String(profile.data?.role || "").toLowerCase() !== "buyer") return reply({error:"Buyer account required"},403,origin);
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const {count:recentReports,error:rateError} = await admin.from("buyer_due_diligence_reports")
      .select("id",{count:"exact",head:true}).eq("buyer_id",user.id).gte("created_at",since);
    if (rateError) throw rateError;
    if ((recentReports || 0) >= 10) return reply({error:"Report limit reached. Try again later."},429,origin);
    const body = await req.json();
    const projectId = String(body.project_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) return reply({error:"Valid project_id required"},400,origin);
    const {data:project,error:projectError} = await admin.from("projects").select("id,title,status,github_url").eq("id",projectId).maybeSingle();
    if (projectError || !project || String(project.status).toLowerCase() !== "active") return reply({error:"Active marketplace project not found"},404,origin);
    const {data:auditRows,error:auditError} = await admin.from("code_audits")
      .select("id,repo_url,commit_sha,status,files_scanned,coverage_score,overall_score,risk_level,engine_version,completed_at,critical_count,high_count,medium_count,low_count,info_count")
      .eq("status","completed").order("completed_at",{ascending:false}).limit(200);
    if (auditError) throw auditError;
    const normalizeRepo = (value: unknown) => String(value || "").trim().toLowerCase().replace(/\.git$/, "").replace(/\/$/, "");
    const normalizedListingRepo = normalizeRepo(project.github_url);
    const audit = normalizedListingRepo ? (auditRows || []).find(row => normalizeRepo(row.repo_url) === normalizedListingRepo) || null : null;
    const auditMatchesCurrentListing = !!audit;
    let snapshot: Record<string,unknown> = {};
    let auditStatus: "available"|"missing" = "missing";
    if (auditMatchesCurrentListing && audit) {
      // Intentionally exclude file paths, raw evidence, source snippets, private notes and seller metadata.
      snapshot = {
        audit_id:audit.id, repository:audit.repo_url, commit_sha:audit.commit_sha,
        files_scanned:audit.files_scanned, coverage_percent:audit.coverage_score,
        score:audit.overall_score, risk_level:audit.risk_level, engine_version:audit.engine_version,
        completed_at:audit.completed_at,
        finding_counts:{critical:audit.critical_count,high:audit.high_count,medium:audit.medium_count,low:audit.low_count,info:audit.info_count},
        scope:"Public repository snapshot linked to this marketplace listing",
        limitations:["This is a point-in-time automated code review, not a guarantee of security.",
          "Coverage reflects the scanner's recorded coverage; unscanned code and runtime behavior may remain.",
          "No audit record does not mean the project is safe."]
      };
      auditStatus = "available";
    }
    const {data:report,error:insertError} = await admin.from("buyer_due_diligence_reports").insert({
      buyer_id:user.id, project_id:projectId,
      status:auditStatus, audit_source_status:auditStatus, audit_snapshot:snapshot
    }).select("id,project_id,status,audit_source_status,audit_snapshot,created_at").single();
    if (insertError) throw insertError;
    return reply({report},200,origin);
  } catch (e) {
    console.error("buyer-dd-create",String((e as Error)?.message || e));
    return reply({error:"Unable to create due diligence report"},500,origin);
  }
});