"use strict";
(function(){
 const root=document.getElementById("auditApp");
 const initialRepoInput=document.getElementById("auditRepo");
 const initialRunButton=document.getElementById("runAudit");
 window.W3MCodeAuditReady=true;
 const SUPABASE_URL="https://hzhqlexnhtukfljcvnyd.supabase.co"; const SUPABASE_KEY="sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI"; let localClient=null; const client=()=>localClient||window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase; const ensureClient=async()=>{let c=client(); if(c)return c; if(window.supabase?.createClient){localClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});return localClient} throw Error("Supabase client library failed to load.");};
 const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
 const id=new URLSearchParams(location.search).get("id");
 const money=(v,c="USD")=>{const n=Number(v);return Number.isFinite(n)?new Intl.NumberFormat("en-US",{style:"currency",currency:c,maximumFractionDigits:0}).format(n):"—"};
 const metric=(name,v)=>'<div class="audit-metric"><strong>'+esc(name)+'</strong><b>'+(v==null?"—":esc(Math.round(Number(v)))+"/100")+"</b></div>";
 function findings(list){if(!Array.isArray(list)||!list.length)return '<p class="muted">No findings were returned.</p>';return list.map(f=>'<div class="finding"><div><span class="sev sev-'+esc(f.severity||"info")+'">'+esc(f.severity||"info")+'</span><span class="finding-title">'+esc(f.title||f.category||"Finding")+'</span></div><p>'+esc(f.description||f.evidence||"No description provided.")+'</p>'+(f.file_path?'<small class="muted">'+esc(f.file_path)+(f.line_start?":"+esc(f.line_start):"")+"</small>":"")+(f.recommendation?'<p><strong>Recommendation:</strong> '+esc(f.recommendation)+"</p>":"")+"</div>").join("")}
 async function getAudit(c,auditId){const r=await c.from("code_audits").select("*").eq("id",auditId).maybeSingle();if(r.error)throw r.error;return r.data}
 async function render(a){
  const c=await ensureClient();
  const f=await c.from("code_audit_findings").select("*").eq("audit_id",a.id).order("severity",{ascending:true});
  const files=await c.from("code_audit_files").select("path,language,line_count,selected_tier").eq("audit_id",a.id).order("path");
  root.innerHTML='<div class="audit-head"><div><div class="audit-kicker">W3M AI CODE AUDIT</div><h1>Repository Technical Due Diligence</h1><p class="muted">'+esc(a.repo_owner||"")+" / "+esc(a.repo_name||"")+' · '+esc(a.commit_sha||"snapshot")+'</p></div><div><div class="audit-score">'+(a.overall_score==null?"—":esc(a.overall_score)+"/100")+'</div><div class="audit-risk">'+esc(String(a.risk_level||"Pending").toUpperCase())+"</div></div></div>"+
   '<div class="audit-actions"><a class="btn btn-ghost" href="'+(a.project_id?'project.html?id='+encodeURIComponent(a.project_id):'code-audit.html')+'">Back to Project</a><a class="btn btn-primary" href="'+esc(a.repo_url||"#")+'" target="_blank" rel="noopener noreferrer">Open GitHub ↗</a></div>'+
   '<div class="audit-grid">'+metric("Security",a.security_score)+metric("Architecture",a.architecture_score)+metric("Code Quality",a.code_quality_score)+metric("Dependencies",a.dependency_score)+metric("Testing",a.testing_score)+metric("Documentation",a.documentation_score)+metric("Web3",a.web3_score)+'</div>'+
   '<div class="audit-section"><h2>Audit Summary</h2><p>'+esc(a.summary||"No summary available yet.")+'</p><p class="muted">Files scanned: '+esc(a.files_scanned||0)+' · Lines scanned: '+esc(a.lines_scanned||0)+' · Scan coverage: '+esc(a.coverage_score||0)+' · Engine: '+esc(a.engine_version||"W3M")+'</p></div>'+
   '<div class="audit-section"><h2>Findings</h2>'+findings(f.data||[])+"</div>"+
   '<div class="audit-section"><h2>Repository Snapshot</h2><div class="audit-grid">'+(files.data||[]).slice(0,20).map(x=>'<div class="audit-metric"><strong>'+esc(x.path)+'</strong><span class="muted">'+esc(x.language||"source")+' · '+esc(x.line_count||0)+' lines</span></div>').join("")+'</div></div>'+
   '<div class="audit-section"><small class="muted">W3M AI Code Audit is AI-assisted technical due diligence, not a formal penetration test, smart-contract audit, certification, guarantee, or investment advice.</small></div>';
 }
 window.W3MRunAudit=async()=>{
  const b=document.getElementById("runAudit"),m=document.getElementById("auditMsg"),input=document.getElementById("auditRepo");
  if(!b||!m||!input)return;
  b.disabled=true;b.textContent="Starting…";m.innerHTML="<p class='muted'>Creating secure audit session…</p>";
  try{
   let c=await ensureClient();
   
   const repo=input.value.trim();
   if(!/^https:\/\/github\.com\/[^/]+\/[^/]+(?:\/)?$/i.test(repo))throw Error("Enter a valid public GitHub repository URL.");
   b.textContent="Running Audit…";m.innerHTML="<p class='muted'>Scanning GitHub and preparing AI analysis…</p>";
   const body={repo_url:repo}; if(id) body.project_id=id; const r=await c.functions.invoke("w3m-code-audit",{body});
   if(r.error){
    let detail=r.error?.message||"The audit service returned an error.";
    try{if(r.error?.context){const ctx=r.error.context;let payload=null;if(typeof ctx.json==="function"){try{payload=await ctx.clone().json();}catch(_){try{payload=await ctx.json();}catch(__){}}}else if(typeof ctx==="object"){payload=ctx;}if(payload?.error)detail=payload.error;if(payload?.retry_after_seconds)detail+=" Try again in about "+Math.ceil(payload.retry_after_seconds/60)+" minute(s).";if(payload?.code==="RATE_LIMIT")detail="Rate limit reached: maximum 3 public audits per hour. "+(payload?.retry_after_seconds?"Try again in about "+Math.ceil(payload.retry_after_seconds/60)+" minute(s).":"Please try again later.");}}catch(_){ }
    throw Error(detail);
   }
   if(r.data?.error)throw Error(r.data.error);
   const aid=r.data?.audit_id||r.data?.id;if(!aid)throw Error("Audit started but no audit ID was returned.");
   location.replace("code-audit.html?audit_id="+encodeURIComponent(aid));
  }catch(e){
   console.error(e);m.innerHTML="<p class='muted'>"+esc(e?.message||"Unable to start audit.")+"</p>";b.disabled=false;b.textContent="Run W3M AI Code Audit";
  }
 };
 async function start(){
  try{
   const c=await ensureClient();
   let projectTitle="Any Public GitHub Repository",prefill="";
   if(id){const p=await c.from("projects").select("title,github_url").eq("id",id).maybeSingle();if(!p.error&&p.data){projectTitle=p.data.title||projectTitle;prefill=p.data.github_url||"";}}
   if(initialRepoInput) initialRepoInput.value=prefill;
 }catch(e){console.error(e);root.innerHTML='<h1>W3M AI Code Audit</h1><p class="muted">'+esc(e?.message||"Unable to load audit.")+'</p>'}
 }
 async function openExisting(){
  const aid=new URLSearchParams(location.search).get("audit_id");if(!aid)return false;
  try{const c=await ensureClient();const a=await getAudit(c,aid);if(!a)throw Error("Audit not found.");if(["queued","scanning","analyzing"].includes(a.status)){root.innerHTML='<div class="audit-status"><h2>W3M AI Code Audit is running…</h2><p class="muted">Status: '+esc(a.status)+'</p><p class="muted">The scan is processing the public repository and AI analysis. This page updates automatically.</p></div>';setTimeout(()=>openExisting(),3500);return true}
  if(a.status==="failed"){root.innerHTML='<div class="audit-status"><h2>Audit could not be completed</h2><p class="audit-error">'+esc(a.error_message||"The audit service failed without a detailed message.")+'</p><button class="btn btn-primary" type="button" onclick="location.href=\'code-audit.html\'">Try another audit</button></div>';return true}
  await render(a);return true}catch(e){root.innerHTML='<div class="audit-status"><h2>W3M AI Code Audit</h2><p class="audit-error">'+esc(e?.message||"Unable to load audit.")+'</p></div>';return true}
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>openExisting().then(x=>{if(!x)start()}),{once:true});else openExisting().then(x=>{if(!x)start()});
})();