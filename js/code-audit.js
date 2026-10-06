"use strict";
(function(){
 const root=document.getElementById("auditApp");
 const client=()=>window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
 const id=new URLSearchParams(location.search).get("id");
 const money=(v,c="USD")=>{const n=Number(v);return Number.isFinite(n)?new Intl.NumberFormat("en-US",{style:"currency",currency:c,maximumFractionDigits:0}).format(n):"—"};
 const metric=(name,v)=>'<div class="audit-metric"><strong>'+esc(name)+'</strong><b>'+(v==null?"—":esc(Math.round(Number(v)))+"/100")+"</b></div>";
 function findings(list){if(!Array.isArray(list)||!list.length)return '<p class="muted">No findings were returned.</p>';return list.map(f=>'<div class="finding"><div><span class="sev sev-'+esc(f.severity||"info")+'">'+esc(f.severity||"info")+'</span><span class="finding-title">'+esc(f.title||f.category||"Finding")+'</span></div><p>'+esc(f.description||f.evidence||"No description provided.")+'</p>'+(f.file_path?'<small class="muted">'+esc(f.file_path)+(f.line_start?":"+esc(f.line_start):"")+"</small>":"")+(f.recommendation?'<p><strong>Recommendation:</strong> '+esc(f.recommendation)+"</p>":"")+"</div>").join("")}
 async function getAudit(c,auditId){const r=await c.from("code_audits").select("*").eq("id",auditId).maybeSingle();if(r.error)throw r.error;return r.data}
 async function render(a){
  const c=client(); if(!c)throw Error("Database connection unavailable.");
  const f=await c.from("code_audit_findings").select("*").eq("audit_id",a.id).order("severity",{ascending:true});
  const files=await c.from("code_audit_files").select("path,language,line_count,selected_tier").eq("audit_id",a.id).order("path");
  root.innerHTML='<div class="audit-head"><div><div class="audit-kicker">W3M AI CODE AUDIT</div><h1>Repository Technical Due Diligence</h1><p class="muted">'+esc(a.repo_owner||"")+" / "+esc(a.repo_name||"")+' · '+esc(a.commit_sha||"snapshot")+'</p></div><div><div class="audit-score">'+(a.overall_score==null?"—":esc(a.overall_score)+"/100")+'</div><div class="audit-risk">'+esc(String(a.risk_level||"Pending").toUpperCase())+"</div></div></div>"+
   '<div class="audit-actions"><a class="btn btn-ghost" href="'+(a.project_id?'project.html?id='+encodeURIComponent(a.project_id):'code-audit.html')+'">Back to Project</a><a class="btn btn-primary" href="'+esc(a.repo_url||"#")+'" target="_blank" rel="noopener noreferrer">Open GitHub ↗</a></div>'+
   '<div class="audit-grid">'+metric("Security",a.security_score)+metric("Architecture",a.architecture_score)+metric("Code Quality",a.code_quality_score)+metric("Dependencies",a.dependencies_score)+metric("Testing",a.testing_score)+metric("Documentation",a.documentation_score)+metric("Web3",a.web3_score)+'</div>'+
   '<div class="audit-section"><h2>Audit Summary</h2><p>'+esc(a.summary||"No summary available yet.")+'</p><p class="muted">Files scanned: '+esc(a.files_scanned||0)+' · Lines scanned: '+esc(a.lines_scanned||0)+' · Scan coverage: '+esc(a.coverage_score||0)+' · Engine: '+esc(a.engine_version||"W3M")+'</p></div>'+
   '<div class="audit-section"><h2>Findings</h2>'+findings(f.data||[])+"</div>"+
   '<div class="audit-section"><h2>Repository Snapshot</h2><div class="audit-grid">'+(files.data||[]).slice(0,20).map(x=>'<div class="audit-metric"><strong>'+esc(x.path)+'</strong><span class="muted">'+esc(x.language||"source")+' · '+esc(x.line_count||0)+' lines</span></div>').join("")+'</div></div>'+
   '<div class="audit-section"><small class="muted">W3M AI Code Audit is AI-assisted technical due diligence, not a formal penetration test, smart-contract audit, certification, guarantee, or investment advice.</small></div>';
 }
 async function start(){
  try{
   
   const c=client();if(!c){root.innerHTML="<p>Database connection unavailable. Please reload.</p>";return}
   const u=(await c.auth.getUser()).data.user;if(!u){root.innerHTML='<h1>Sign in required</h1><p class="muted">Sign in to run or view a W3M AI Code Audit.</p><a class="btn btn-primary" href="register.html">Sign in</a>';return}
   let projectTitle="Any Public GitHub Repository",prefill="";
   if(id){const p=await c.from("projects").select("title,github_url").eq("id",id).maybeSingle();if(!p.error&&p.data){projectTitle=p.data.title||projectTitle;prefill=p.data.github_url||"";}}
   root.innerHTML='<div class="audit-head"><div><div class="audit-kicker">W3M AI CODE AUDIT</div><h1>'+esc(projectTitle)+'</h1><p class="muted">Independent technical due diligence for any public GitHub repository. The repository does not need to be listed on Web3Market.</p></div></div><div class="audit-actions"><a class="btn btn-ghost" href="'+(id?'project.html?id='+encodeURIComponent(id):'marketplace.html')+'">Back</a></div><div class="audit-section"><label for="auditRepo"><strong>Public GitHub Repository</strong></label><input id="auditRepo" type="url" value="'+esc(prefill)+'" placeholder="https://github.com/owner/repository" style="width:100%;margin-top:8px;padding:11px;border:1px solid #3a3158;border-radius:9px;background:#0d0c19;color:#f5f2ff"><p class="muted">Only this repository is scanned. W3M does not inspect the seller's GitHub account, other repositories, or private repositories.</p><button id="runAudit" class="btn btn-primary" style="margin-top:10px">Run W3M AI Code Audit</button><div id="auditMsg" style="margin-top:10px"></div></div>';
   document.getElementById("runAudit").onclick=async()=>{
    const b=document.getElementById("runAudit"),m=document.getElementById("auditMsg");b.disabled=true;b.textContent="Starting…";m.innerHTML="<p class='muted'>Scanning GitHub and preparing AI analysis…</p>";
    const repo=document.getElementById("auditRepo").value.trim();if(!/^https:\\/\\/github\\.com\\/[^/]+\\/[^/]+(?:\\/)?$/i.test(repo)){m.innerHTML="<p class=\"muted\">Enter a valid public GitHub repository URL.</p>";b.disabled=false;b.textContent="Run W3M AI Code Audit";return}const r=await c.functions.invoke("w3m-code-audit",{body:{repo_url:repo}});
    if(r.error)throw r.error;
    const aid=r.data?.audit_id||r.data?.id;if(!aid)throw Error("Audit started but no audit ID was returned.");
    location.replace("code-audit.html?audit_id="+encodeURIComponent(aid)+"&id="+encodeURIComponent(id));
   };
  }catch(e){console.error(e);root.innerHTML='<h1>W3M AI Code Audit</h1><p class="muted">'+esc(e?.message||"Unable to load audit.")+'</p>'}
 }
 async function openExisting(){
  const aid=new URLSearchParams(location.search).get("audit_id");if(!aid)return false;
  try{const c=client();if(!c)throw Error("Database connection unavailable.");const a=await getAudit(c,aid);if(!a)throw Error("Audit not found.");if(["queued","scanning","analyzing"].includes(a.status)){root.innerHTML='<div class="audit-status"><h2>W3M AI Code Audit is running…</h2><p class="muted">Status: '+esc(a.status)+'</p><p class="muted">This page refreshes automatically.</p></div>';setTimeout(()=>location.reload(),4000);return true}await render(a);return true}catch(e){root.innerHTML='<h1>W3M AI Code Audit</h1><p class="muted">'+esc(e?.message||"Unable to load audit.")+'</p>';return true}
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>openExisting().then(x=>{if(!x)start()}),{once:true});else openExisting().then(x=>{if(!x)start()});
})();