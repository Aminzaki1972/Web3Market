"use strict";
(function(){
 const root=document.getElementById("auditApp");
 const initialRepoInput=document.getElementById("auditRepo");
 const SUPABASE_URL="https://hzhqlexnhtukfljcvnyd.supabase.co";
 const SUPABASE_KEY="sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI";
 let localClient=null;
 const client=()=>localClient||window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 const ensureClient=async()=>{let c=client();if(c)return c;if(window.supabase?.createClient){localClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});return localClient}throw Error("Supabase client library failed to load.");};
 const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
 const id=new URLSearchParams(location.search).get("id");
 const auditId=new URLSearchParams(location.search).get("audit_id");
 const metric=(name,v)=>'<div class="audit-metric"><strong>'+esc(name)+'</strong><b>'+(v==null?"—":esc(Math.round(Number(v)))+"/100")+"</b></div>";
 const sevOrder={critical:0,high:1,medium:2,low:3,info:4};
 function severityClass(s){return String(s||"info").toLowerCase().replace(/[^a-z]/g,"")||"info";}
 function findings(list){
   if(!Array.isArray(list)||!list.length)return '<p class="muted">No findings were returned by the analysis.</p>';
   const sorted=[...list].sort((a,b)=>(sevOrder[a.severity]??9)-(sevOrder[b.severity]??9));
   return sorted.map(f=>{
     const sev=severityClass(f.severity);
     const loc=f.file_path?esc(f.file_path)+(f.line_start?":"+esc(f.line_start)+(f.line_end&&f.line_end!==f.line_start?"-"+esc(f.line_end):""):""):"Repository-level";
     return '<article class="finding"><div class="finding-head"><span class="sev sev-'+sev+'">'+esc(f.severity||"info")+'</span><span class="finding-title">'+esc(f.title||f.category||"Finding")+'</span><span class="finding-status">'+esc(f.status||"needs_verification")+'</span></div><p><strong>Location:</strong> '+loc+'</p><p>'+esc(f.description||"No description provided.")+'</p>'+(f.evidence?'<p><strong>Evidence</strong></p><pre class="finding-evidence">'+esc(f.evidence)+"</pre>":"")+(f.recommendation?'<p><strong>Recommendation:</strong> '+esc(f.recommendation)+"</p>":"")+(f.confidence!=null?'<small class="muted">Confidence: '+esc(f.confidence)+'%</small>':"")+"</article>";
   }).join("");
 }
 function counts(list){const c={critical:0,high:0,medium:0,low:0,info:0};(list||[]).forEach(f=>{if(c[f.severity]!=null)c[f.severity]++});return c;}
 async function getAudit(c,aid){const r=await c.from("code_audits").select("*").eq("id",aid).maybeSingle();if(r.error)throw r.error;return r.data;}
 async function render(a){
   const c=await ensureClient();
   const [fr,filesr]=await Promise.all([
     c.from("code_audit_findings").select("*").eq("audit_id",a.id).order("created_at",{ascending:true}),
     c.from("code_audit_files").select("path,language,line_count,selected_tier").eq("audit_id",a.id).order("path")
   ]);
   if(fr.error)throw fr.error;if(filesr.error)throw filesr.error;
   const fl=fr.data||[], files=filesr.data||[], cnt=counts(fl);
   const score=a.overall_score==null?null:Number(a.overall_score);
   const risk=String(a.risk_level||"Pending");
   const date=a.completed_at||a.created_at||new Date().toISOString();
   root.innerHTML='<div class="audit-head"><div><div class="audit-kicker">W3M AI CODE AUDIT</div><h1>Repository Technical Due Diligence</h1><p class="muted">'+esc(a.repo_owner||"")+" / "+esc(a.repo_name||"")+' · '+esc(a.commit_sha||"snapshot")+'</p></div><div><div class="audit-score">'+(score==null?"—":esc(score)+"/100")+'</div><div class="audit-risk">'+esc(risk.toUpperCase())+'</div></div></div>'+
   '<div class="audit-actions"><button class="btn btn-primary" type="button" onclick="window.print()">Print / Save PDF</button><a class="btn btn-ghost" href="'+(a.project_id?"project.html?id="+encodeURIComponent(a.project_id):"code-audit.html")+'">Back to Project</a><a class="btn btn-primary" href="'+esc(a.repo_url||"#")+'" target="_blank" rel="noopener noreferrer">Open GitHub ↗</a></div>'+
   '<div class="audit-meta"><div><strong>Audit ID</strong><span class="audit-id">'+esc(a.id)+'</span></div><div><strong>Commit</strong><span class="audit-id">'+esc(a.commit_sha||"—")+'</span></div><div><strong>Audit Date</strong><span>'+esc(new Date(date).toLocaleString())+'</span></div><div><strong>Engine</strong><span>'+esc(a.engine_version||a.model||"W3M AI Code Audit")+'</span></div></div>'+
   '<div class="audit-grid">'+metric("Security",a.security_score)+metric("Architecture",a.architecture_score)+metric("Code Quality",a.code_quality_score)+metric("Dependencies",a.dependency_score)+metric("Testing",a.testing_score)+metric("Documentation",a.documentation_score)+metric("Web3",a.web3_score)+'</div>'+
   '<div class="audit-section"><h2>Audit Summary</h2><p class="audit-summary">'+esc(a.summary||"No summary available yet.")+'</p><p class="muted">Files scanned: '+esc(a.files_scanned||0)+' · Lines scanned: '+esc(a.lines_scanned||0)+' · Scan coverage: '+esc(a.coverage_score||0)+'% · Findings: '+esc(fl.length)+'</p></div>'+
   '<div class="audit-section"><h2>Risk Overview</h2><div class="audit-grid">'+metric("Critical",cnt.critical)+metric("High",cnt.high)+metric("Medium",cnt.medium)+metric("Low",cnt.low)+metric("Info",cnt.info)+'</div></div>'+
   '<div class="audit-section"><h2>Technical Findings</h2><p class="muted">Every finding below is tied to repository evidence returned by the audit engine. Confidence and status indicate how strongly the evidence supports the finding.</p>'+findings(fl)+"</div>"+
   '<div class="audit-section"><h2>Repository Snapshot</h2><div class="audit-grid">'+files.slice(0,30).map(x=>'<div class="audit-metric"><strong>'+esc(x.path)+'</strong><span class="muted">'+esc(x.language||"source")+' · '+esc(x.line_count||0)+' lines</span></div>').join("")+'</div>'+(files.length>30?'<p class="muted">Showing the first 30 scanned files in this report.</p>':"")+'</div>'+
   '<div class="audit-certificate"><div class="audit-kicker">W3M AI CODE AUDIT RECORD</div><h2>Audit Analysis Record</h2><p>This report records the analysis result for the repository and commit shown above. It is not a formal penetration test, smart-contract audit, certification, guarantee, or investment advice.</p><p class="audit-id">'+esc(a.id)+'</p><p class="muted">Repository: '+esc(a.repo_owner||"")+"/"+esc(a.repo_name||"")+' · Commit: '+esc(a.commit_sha||"—")+'</p></div>'+
   '<div class="audit-section"><small class="muted">Limitations: public repository data only; no private infrastructure, runtime penetration testing, or private repositories. Line references may be approximate. A later commit requires a new audit.</small></div>';
 }
 window.W3MResumeAudit=async()=>{
   try{
     const c=await ensureClient();
     const a=await getAudit(c,auditId); if(!a)throw Error("Audit not found.");
     const r=await c.functions.invoke("w3m-code-audit",{body:{audit_id:a.id}});
     if(r.error)throw Error(r.error.message||"Unable to resume audit.");
     location.reload();
   }catch(e){alert(e?.message||"Unable to resume audit.");}
 };
 window.W3MRunAudit=async()=>{
   const b=document.getElementById("runAudit"),m=document.getElementById("auditMsg"),input=document.getElementById("auditRepo");
   if(!b||!m||!input)return;
   b.disabled=true;b.textContent="Starting…";m.innerHTML="<p class='muted'>Creating secure audit session…</p>";
   try{
     const c=await ensureClient(),repo=input.value.trim();
     if(!/^https:\/\/github\.com\/[^/]+\/[^/]+(?:\/)?$/i.test(repo))throw Error("Enter a valid public GitHub repository URL.");
     b.textContent="Running Audit…";m.innerHTML="<p class='muted'>Scanning GitHub and preparing AI analysis…</p>";
     const body={repo_url:repo};if(id)body.project_id=id;
     const r=await c.functions.invoke("w3m-code-audit",{body});
     if(r.error){
       let detail=r.error?.message||"The audit service returned an error.";
       try{if(r.error?.context){const ctx=r.error.context;let payload=null;if(typeof ctx.json==="function"){try{payload=await ctx.clone().json()}catch(_){try{payload=await ctx.json()}catch(__){}}}else if(typeof ctx==="object")payload=ctx;if(payload?.code==="RATE_LIMIT")detail="Rate limit reached. Please try again in about "+Math.ceil(Number(payload.retry_after_seconds||60)/60)+" minute(s).";else if(payload?.error)detail=payload.error;}}catch(_){}
       throw Error(detail);
     }
     if(r.data?.error)throw Error(r.data.error);
     const aid=r.data?.audit_id||r.data?.id;if(!aid)throw Error("Audit started but no audit ID was returned.");
     location.replace("code-audit.html?audit_id="+encodeURIComponent(aid));
   }catch(e){console.error(e);m.innerHTML="<p class='muted'>"+esc(e?.message||"Unable to start audit.")+"</p>";b.disabled=false;b.textContent="Run W3M AI Code Audit";}
 };
 async function start(){
   try{const c=await ensureClient();let prefill="";if(id){const p=await c.from("projects").select("github_url").eq("id",id).maybeSingle();if(!p.error&&p.data)prefill=p.data.github_url||"";}if(initialRepoInput)initialRepoInput.value=prefill;}
   catch(e){console.error(e);root.innerHTML='<h1>W3M AI Code Audit</h1><p class="muted">'+esc(e?.message||"Unable to load audit.")+"</p>"}
 }
 async function resumeIfNeeded(a){
   if(!a||!auditId)return;
   const status=String(a.status||"");
   const total=Number(a.total_chunks||a.analysis_progress?.total_chunks||0);
   const current=Number(a.current_chunk||a.analysis_progress?.current_chunk||0);
   if(status!=="analyzing"||!total||current>=total)return;
   try{
     await ensureClient().then(c=>c.functions.invoke("w3m-code-audit",{body:{audit_id:a.id}}));
   }catch(e){console.warn("W3M audit resume request failed",e);}
 }
 async function openExisting(){
   if(!auditId)return false;
   try{
     const c=await ensureClient(),a=await getAudit(c,auditId);if(!a)throw Error("Audit not found.");
     if(["queued","scanning","analyzing","retrying"].includes(a.status)){
       const p=a.analysis_progress||{}; const current=Number(a.current_chunk||p.current_chunk||0); const total=Number(a.total_chunks||p.total_chunks||0);
       const pct=total?Math.min(100,Math.round(current/total*100)):0;
       const retry=a.status==="retrying" ? '<p class="muted">Gemini is temporarily busy. W3M is retrying automatically'+(p.retry_after_seconds?' — next retry in about '+esc(p.retry_after_seconds)+'s':'')+'.</p>' : '';
       root.innerHTML='<div class="audit-status"><h2>W3M AI Code Audit is running…</h2><p class="muted">Status: '+esc(a.status)+'</p><p class="muted">AI analysis progress: '+esc(current)+' / '+esc(total||'?')+' chunks ('+esc(pct)+'%).</p><div style="height:8px;background:#25213a;border-radius:99px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:currentColor"></div></div>'+retry+'<p class="muted">Progress is saved automatically. You can leave this page safely.</p></div>';
       setTimeout(async()=>{await resumeIfNeeded(a);openExisting();},3000);return true;
     }
     if(a.status==="paused"){root.innerHTML='<div class="audit-status"><h2>AI Analysis Temporarily Paused</h2><p class="muted">Gemini was temporarily unavailable. Completed chunks have been saved and will not be lost.</p><p class="audit-error">'+esc(a.error_message||"Temporary AI service interruption.")+'</p><button class="btn btn-primary" type="button" onclick="window.W3MResumeAudit&&window.W3MResumeAudit()">Resume AI Audit</button> <button class="btn btn-ghost" type="button" onclick="location.href=\'code-audit.html\'">New Audit</button></div>';return true;}
     if(a.status==="failed"){root.innerHTML='<div class="audit-status"><h2>Audit could not be completed</h2><p class="audit-error">'+esc(a.error_message||"The audit service failed without a detailed message.")+'</p><button class="btn btn-primary" type="button" onclick="location.href=\'code-audit.html\'">Try another audit</button></div>';return true;}
     await render(a);return true;
   }catch(e){root.innerHTML='<div class="audit-status"><h2>W3M AI Code Audit</h2><p class="audit-error">'+esc(e?.message||"Unable to load audit.")+"</p></div>";return true;}
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>openExisting().then(x=>{if(!x)start()}),{once:true});else openExisting().then(x=>{if(!x)start()});
})();