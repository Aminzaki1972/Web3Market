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
 let autoFollow=true;
 const stopFollow=()=>{autoFollow=false;const el=document.getElementById("w3mStopFollow");if(el){el.disabled=true;el.textContent="Automatic follow-up stopped";}const note=document.getElementById("w3mFollowNote");if(note)note.textContent="Automatic page refresh and resume requests are stopped. An already-running server request may finish its current chunk.";};
 window.W3MStopAuditFollow=stopFollow;
 const auditId=new URLSearchParams(location.search).get("audit_id");
 const metric=(name,v,asScore=true)=>'<div class="audit-metric"><strong>'+esc(name)+'</strong><b>'+(v==null?"—":esc(Math.round(Number(v)))+(asScore?"/100":""))+"</b></div>";
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
 window.W3MCreateAutoFixPR=async(audit)=>{
   const button=document.getElementById("createAutoFixPR"),message=document.getElementById("autoFixPRMessage");
   if(!button||!message||!audit?.id)return;
   button.disabled=true;button.textContent="Preparing reviewable fixes…";message.textContent="Checking the audited commit and preparing a separate GitHub branch. The default branch will not be changed.";
   try{
    const c=await ensureClient();const auth=await c.auth.getSession();if(!auth?.data?.session?.user)throw Error("Sign in to create an Auto-Fix PR.");
    const result=await c.functions.invoke("w3m-audit-autofix-pr",{body:{audit_id:audit.id}});
    if(result.error)throw Error(result.error.message||"Unable to create Auto-Fix PR.");
    const data=result.data||{};if(!data.ok||!data.pull_request)throw Error(data.error||"No pull request was created.");
    message.textContent="Reviewable pull request created. It has not been merged.";
    const link=document.createElement("a");link.href=data.pull_request;link.target="_blank";link.rel="noopener noreferrer";link.textContent="Open Auto-Fix PR #"+data.pr_number+" ↗";link.className="btn btn-primary";message.appendChild(document.createTextNode(" "));message.appendChild(link);
    button.textContent="Auto-Fix PR created";button.disabled=true;
   }catch(error){message.textContent=error?.message||"Auto-Fix PR could not be created.";button.disabled=false;button.textContent="Generate Auto-Fix PR";}
  };
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
   window.W3MCurrentAudit=a;
   root.innerHTML='<div class="audit-head"><div><div class="audit-kicker">W3M AI CODE AUDIT</div><h1>Repository Technical Due Diligence</h1><p class="muted">'+esc(a.repo_owner||"")+" / "+esc(a.repo_name||"")+' · '+esc(a.commit_sha||"snapshot")+'</p></div><div><div class="audit-score">'+(score==null?"—":esc(score)+"/100")+'</div><div class="audit-risk">'+esc(risk.toUpperCase())+'</div></div></div>'+
   '<div class="audit-actions"><button class="btn btn-primary" type="button" onclick="window.print()">Print / Save PDF</button>'+ (a.status==="completed"?'<button id="createAutoFixPR" class="btn btn-primary" type="button" onclick="window.W3MCreateAutoFixPR&&window.W3MCreateAutoFixPR(window.W3MCurrentAudit)">Generate Auto-Fix PR</button>':"")+'<a class="btn btn-ghost" href="'+(a.project_id?"project.html?id="+encodeURIComponent(a.project_id):"code-audit.html")+'">Back to Project</a><a class="btn btn-primary" href="'+esc(a.repo_url||"#")+'" target="_blank" rel="noopener noreferrer">Open GitHub ↗</a></div>'+
   '<div id="autoFixPRMessage" class="muted" style="margin:8px 0"></div><div class="audit-meta"><div><strong>Audit ID</strong><span class="audit-id">'+esc(a.id)+'</span></div><div><strong>Commit</strong><span class="audit-id">'+esc(a.commit_sha||"—")+'</span></div><div><strong>Audit Date</strong><span>'+esc(new Date(date).toLocaleString())+'</span></div><div><strong>Engine</strong><span>'+esc(a.engine_version||a.model||"W3M AI Code Audit")+'</span></div></div>'+
   '<div class="audit-grid">'+metric("Security",a.security_score)+metric("Architecture",a.architecture_score)+metric("Code Quality",a.code_quality_score)+metric("Dependencies",a.dependency_score)+metric("Testing",a.testing_score)+metric("Documentation",a.documentation_score)+metric("Web3",a.web3_score)+metric("Scalability (static estimate)",a.scalability_score)+metric("AI Fit (evidence-based)",a.ai_fit_score)+'</div>'+
   '<div class="audit-section"><h2>About Executive Scores</h2><p class="muted">Scalability is a static estimate from scanned code, not a load or production performance test. AI Fit is an evidence-based estimate from available repository content; it does not prove that an AI feature works or delivers value. A dash means the metric was not recorded for this audit.</p></div><div class="audit-section"><h2>Audit Summary</h2><p class="audit-summary">'+esc(a.summary||"No summary available yet.")+'</p><p class="muted">Files scanned: '+esc(a.files_scanned||0)+' · Lines scanned: '+esc(a.lines_scanned||0)+' · Scan coverage: '+esc(a.coverage_score||0)+'% · Findings: '+esc(fl.length)+'</p></div>'+
   '<div class="audit-section"><h2>Risk Overview</h2><div class="audit-grid">'+metric("Critical",cnt.critical,false)+metric("High",cnt.high,false)+metric("Medium",cnt.medium,false)+metric("Low",cnt.low,false)+metric("Info",cnt.info,false)+'</div></div>'+
   '<div class="audit-section"><h2>Technical Findings</h2><p class="muted">Every finding below is tied to repository evidence returned by the audit engine. Confidence and status indicate how strongly the evidence supports the finding.</p>'+findings(fl)+"</div>"+
   '<div class="audit-section"><h2>Repository Snapshot</h2><div class="audit-grid">'+files.slice(0,30).map(x=>'<div class="audit-metric"><strong>'+esc(x.path)+'</strong><span class="muted">'+esc(x.language||"source")+' · '+esc(x.line_count||0)+' lines</span></div>').join("")+'</div>'+(files.length>30?'<p class="muted">Showing the first 30 scanned files in this report.</p>':"")+'</div>'+
   '<div class="audit-certificate"><div class="audit-kicker">W3M AI CODE AUDIT RECORD</div><h2>Audit Analysis Record</h2><p>This report records the analysis result for the repository and commit shown above. It is not a formal penetration test, smart-contract audit, certification, guarantee, or investment advice.</p><p class="audit-id">'+esc(a.id)+'</p><p class="muted">Repository: '+esc(a.repo_owner||"")+"/"+esc(a.repo_name||"")+' · Commit: '+esc(a.commit_sha||"—")+'</p></div>'+
   '<div class="audit-section"><small class="muted">Limitations: public repository data only; no private infrastructure, runtime penetration testing, or private repositories. Line references may be approximate. A later commit requires a new audit.</small></div>';
 }
 window.W3MResumeAudit=async()=>{
   try{
     const c=await ensureClient();
     const auth=await c.auth.getSession();
     if(!auth?.data?.session?.user)throw Error("Sign in to access this audit record.");
     const a=await getAudit(c,auditId); if(!a)throw Error("Audit not found or you do not have permission to view it.");
     const r=await c.functions.invoke("w3m-code-audit",{body:{audit_id:a.id}});
     if(r.error)throw Error(r.error.message||"Unable to resume audit.");
     location.reload();
   }catch(e){alert(e?.message||"Unable to resume audit.");}
 };
 const PENDING_PAYMENT_KEY="w3m:audit-payment-order:v1";
 function clearPendingPayment(){try{localStorage.removeItem(PENDING_PAYMENT_KEY);sessionStorage.removeItem(PENDING_PAYMENT_KEY);}catch(_){}}
 function savePendingPayment(order,guestToken,email,repo,auditType){
   try{localStorage.setItem(PENDING_PAYMENT_KEY,JSON.stringify({order,guestToken:guestToken||"",email:email||"",repo,auditType,savedAt:Date.now()}));}
   catch(_){throw Error("This browser cannot retain the payment session. Keep this page open and complete verification before closing it.");}
 }
 function renderPaymentOrder(c,m,pending){
   const {order,guestToken,email}=pending;
   m.innerHTML="<div class='audit-payment-order'><h3>Payment order "+esc(order.id)+"</h3><p>Send <strong>"+esc(order.amount)+"</strong> on <strong>BNB Smart Chain</strong> to the official Web3Market receiving wallet below.</p><p><strong>Receiving wallet</strong><br><code>"+esc(order.recipient_address)+"</code></p><p><strong>Payment asset: Binance-Peg BSC-USD (not direct Tether-issued USD₮)</strong><br><strong>Approved token contract</strong><br><code>"+esc(order.token_contract)+"</code></p><p><strong>Order expires</strong><br>"+esc(new Date(order.expires_at).toLocaleString())+"</p>"+(email?"<p>Private report email: <strong>"+esc(email)+"</strong></p>":"")+"<label for='auditPaymentTxHash'><strong>Transaction hash</strong></label><input id='auditPaymentTxHash' type='text' placeholder='0x…' autocomplete='off' style='display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:12px;border:1px solid #3a3158;border-radius:9px;background:#0d0c19;color:#f5f2ff'><button id='verifyAuditPayment' class='btn btn-primary' type='button'>Verify payment and start audit</button><button id='discardAuditPayment' class='btn btn-ghost' type='button'>Discard saved order</button><p class='muted'>The audit starts only after the server verifies the exact Binance-Peg BSC-USD transfer and 12 block confirmations. This is not direct Tether-issued USD₮. Confirm the network and full token contract before sending. Never send funds to an address other than the one shown in this order. Your pending order is saved in this browser on this device so you can resume after closing the tab. Do not use a shared device; clear the order after completion.</p></div>";
   const verifyButton=document.getElementById("verifyAuditPayment");
   document.getElementById("discardAuditPayment").addEventListener("click",()=>{if(!window.confirm("Only remove this saved order if you have NOT sent any funds. If you already paid, cancel and contact support with the order ID."))return;clearPendingPayment();const runButton=document.getElementById("runAudit");if(runButton){runButton.disabled=false;runButton.textContent="Run W3M AI Code Audit";}m.innerHTML="<p class='muted'>Saved payment order removed from this browser on this device. If you already sent funds, contact support with the order ID before creating another order.</p>";});
   window.W3MVerifyAuditPayment=async()=>{
     const txInput=document.getElementById("auditPaymentTxHash");
     if(!verifyButton||!txInput)return;
     const txHash=txInput.value.trim();
     if(!/^0x[0-9a-f]{64}$/i.test(txHash)){const note=document.createElement("p");note.className="muted";note.textContent="Enter a valid transaction hash.";m.querySelector(".audit-payment-order")?.appendChild(note);return;}
     verifyButton.disabled=true;verifyButton.textContent="Verifying on BNB Chain…";
     try{
       const verified=await c.functions.invoke("verify-audit-payment",{body:{order_id:order.id,tx_hash:txHash,guest_order_token:guestToken||undefined}});
       if(verified.error)throw Error(verified.error.message||"Payment verification failed.");
       const data=verified.data||{};
       if(data.guest){clearPendingPayment();m.innerHTML="<div class='audit-payment-order'><h3>Payment verified</h3><p>Your audit is being prepared. We sent a private report-access link to <strong>"+esc(data.email||email)+"</strong>. Check your inbox and spam folder. The link expires and can be exchanged only once.</p></div>";return;}
       if(data.audit_id){clearPendingPayment();location.replace("code-audit.html?audit_id="+encodeURIComponent(data.audit_id));return;}
       if(data.pending){verifyButton.disabled=false;verifyButton.textContent="Verify payment and start audit";throw Error(data.error||"Payment is awaiting confirmations.");}
       if(data.audit_started===false){verifyButton.disabled=false;verifyButton.textContent="Retry starting audit";throw Error(data.error||"Payment confirmed; audit start can be retried.");}
       throw Error(data.error||"Payment could not be verified.");
     }catch(error){const note=document.createElement("p");note.className="muted";note.textContent=error?.message||"Payment verification failed.";m.querySelector(".audit-payment-order")?.appendChild(note);verifyButton.disabled=false;verifyButton.textContent="Verify payment and start audit";}
   };
   verifyButton.addEventListener("click",window.W3MVerifyAuditPayment);
 }
 window.W3MRunAudit=async()=>{
   const b=document.getElementById("runAudit"),m=document.getElementById("auditMsg"),input=document.getElementById("auditRepo");
   if(!b||!m||!input)return;
   b.disabled=true;b.textContent="Starting…";m.innerHTML="<p class='muted'>Creating secure audit session…</p>";
   try{
     const c=await ensureClient();
     const auth=await c.auth.getSession();
     const signedIn=!!auth?.data?.session?.user;
     const repo=input.value.trim();
     const auditType=document.getElementById("auditType")?.value||"code";
     const guestEmail=document.getElementById("auditGuestEmail")?.value.trim().toLowerCase()||"";
     // Guests may purchase the base Code Audit tier; the free entitlement is enforced only by the signed-in project-owner path below.
     if(!signedIn&&!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(guestEmail))throw Error("Enter a valid email address to receive your private report.");
     if(!["code","smart_contract","complete"].includes(auditType))throw Error("Choose a valid audit type.");
     if(!/^https:\/\/github\.com\/[^/]+\/[^/]+(?:\/)?$/i.test(repo))throw Error("Enter a valid public GitHub repository URL.");
     b.textContent="Running Audit…";m.innerHTML="<p class='muted'>Scanning GitHub and preparing AI analysis…</p>";
     if(id&&auditType==="code"){
       const r=await c.functions.invoke("w3m-code-audit",{body:{repo_url:repo,project_id:id,audit_type:"code"}});
       if(r.error)throw Error(r.error.message||"Unable to start the free project audit.");
       const aid=r.data?.audit_id||r.data?.id;if(!aid)throw Error(r.data?.error||"Audit started but no audit ID was returned.");
       location.replace("code-audit.html?audit_id="+encodeURIComponent(aid));return;
     }
     const orderResponse=await c.functions.invoke("create-audit-payment-order",{body:{repo_url:repo,audit_type:auditType,project_id:id||undefined,email:guestEmail||undefined}});
     if(orderResponse.error)throw Error(orderResponse.error.message||"Unable to create a payment order.");
     const order=orderResponse.data?.order;if(!order?.id)throw Error(orderResponse.data?.error||"Payment order was not created.");
     const pending={order,guestToken:orderResponse.data?.guest_order_token||"",email:orderResponse.data?.email||guestEmail,repo,auditType};
     if(!signedIn&&!pending.guestToken)throw Error("The guest order token was not returned; the order cannot be safely verified. Contact support before sending funds.");
     savePendingPayment(order,pending.guestToken,pending.email,repo,auditType);
     renderPaymentOrder(c,m,pending);
     return;
   }catch(e){console.error(e);m.innerHTML="<p class='muted'>"+esc(e?.message||"Unable to start audit.")+"</p>";b.disabled=false;b.textContent="Run W3M AI Code Audit";}
 };
 function restorePendingPayment(c){
   try{
     const raw=localStorage.getItem(PENDING_PAYMENT_KEY)||sessionStorage.getItem(PENDING_PAYMENT_KEY);if(!raw)return false;
     const pending=JSON.parse(raw);
     if(!pending||!pending.order?.id||!pending.order?.recipient_address||!pending.order?.token_contract||!pending.order?.expires_at||!pending.repo||!["code","smart_contract","complete"].includes(pending.auditType)||typeof pending.guestToken!=="string")throw Error("Saved payment session is incomplete.");
     if(Date.parse(pending.order.expires_at)<=Date.now()){clearPendingPayment();throw Error("This saved payment order has expired. Do not send funds to it; create a new order. If you already sent funds, contact support with the order ID and transaction hash.");}
     localStorage.setItem(PENDING_PAYMENT_KEY,JSON.stringify(pending));
     try{sessionStorage.removeItem(PENDING_PAYMENT_KEY);}catch(_){} 
     const m=document.getElementById("auditMsg");if(!m)return false;
     const b=document.getElementById("runAudit");if(b){b.disabled=true;b.textContent="Pending payment order restored";}
     if(pending.guestToken&&!/^[0-9a-f]{64}$/i.test(pending.guestToken))throw Error("Saved guest access token is invalid.");
     if(!pending.guestToken&&pending.email)throw Error("Guest access token is missing. Do not send payment to this expired browser session.");
     renderPaymentOrder(c,m,pending);
     return true;
   }catch(e){clearPendingPayment();const m=document.getElementById("auditMsg");if(m)m.innerHTML="<p class='muted'>"+esc(e?.message||"Unable to restore the saved payment order.")+"</p>";return false;}
 }
async function start(){
   try{const c=await ensureClient();restorePendingPayment(c);let prefill="";if(id){const p=await c.from("projects").select("github_url").eq("id",id).maybeSingle();if(!p.error&&p.data)prefill=p.data.github_url||"";}if(initialRepoInput)initialRepoInput.value=prefill;if(id){const freeOption=document.querySelector("#auditType option[value=code]");if(freeOption)freeOption.textContent="Full Repository Code Audit — Free once for this project";}}
   catch(e){console.error(e);root.innerHTML='<h1>W3M AI Code Audit</h1><p class="muted">'+esc(e?.message||"Unable to load audit.")+"</p>"}
 }
 async function resumeIfNeeded(a){
   if(!a||!auditId||!autoFollow)return;
   const status=String(a.status||"");
   const progress=a.analysis_progress||{};
   const total=Number(a.total_chunks||progress.total_chunks||0);
   const current=Number(a.current_chunk||progress.current_chunk||0);
   const fileBatchIndex=Number(progress.file_batch_index||0);const totalFileBatches=Number(progress.total_file_batches||0);const hasPendingFileBatch=status==="queued"&&totalFileBatches>0&&fileBatchIndex<totalFileBatches;if(!["queued","scanning","analyzing","retrying"].includes(status)||(!hasPendingFileBatch&&(!total||current>=total)))return;
   const heartbeat=progress.updated_at?Date.parse(progress.updated_at):0;
   const stale=!heartbeat||!Number.isFinite(heartbeat)||(Date.now()-heartbeat)>90000;
   // A fresh scanning heartbeat means a worker is already active. Never call resume on every poll.
   if(["scanning","analyzing","retrying"].includes(status)&&!stale)return;
   // Avoid burning the server-side resume allowance if a queued audit is polled repeatedly.
   const key="w3m:lastResumeAttempt:"+a.id;
   const last=Number(sessionStorage.getItem(key)||0);
   if(Date.now()-last<60000)return;
   sessionStorage.setItem(key,String(Date.now()));
   try{
     await ensureClient().then(c=>c.functions.invoke("w3m-code-audit",{body:{audit_id:a.id}}));
   }catch(e){console.warn("W3M audit resume request failed",e);}
 }
 async function openGuestReport(){
   const params=new URLSearchParams(location.search);
   const linkToken=window.__W3MGuestReportToken||params.get("guest_report");
   // The HTML head removes this bearer token before analytics scripts load.
   try{delete window.__W3MGuestReportToken;}catch(_){window.__W3MGuestReportToken=null;}
   const key="w3m_guest_audit_session:v1";
   const legacyKey="w3m_guest_audit_session";
   let existing="",existingLinkHash="";
   try{
     const saved=localStorage.getItem(key);
     if(saved){
       const record=JSON.parse(saved);
       if(record&&typeof record.token==="string"&&Number(record.expiresAt)>Date.now()){existing=record.token;existingLinkHash=String(record.reportLinkHash||"");}
       else localStorage.removeItem(key);
     }
     if(!existing){
       const legacy=sessionStorage.getItem(legacyKey);
       if(legacy){existing=legacy;existingLinkHash="";localStorage.setItem(key,JSON.stringify({token:legacy,expiresAt:Date.now()+12*60*60*1000,reportLinkHash:""}));sessionStorage.removeItem(legacyKey);}
     }
   }catch(_){existing="";}
   // Reuse a saved session only when no new link was supplied or it belongs to that same link.
   // A different email link may represent a different paid report on the same browser.
   let suppliedLinkHash="";
   if(linkToken){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(linkToken));suppliedLinkHash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");}
   if(existing&&(!linkToken||(existingLinkHash&&existingLinkHash===suppliedLinkHash))){
     try{await loadGuestReport(existing);return true;}
     catch(error){
       const message=String(error?.message||"");
       if(/expired|revoked|valid report session/i.test(message)){try{localStorage.removeItem(key);}catch(_){}}
       root.innerHTML='<div class="audit-status"><h2>Private report temporarily unavailable</h2><p class="audit-error">'+esc(message||"Unable to load the report.")+'</p><button id="retryGuestReport" class="btn btn-primary" type="button">Retry secure report access</button><p class="muted">Your saved session remains on this device until its 12-hour expiry unless the server reports that it is invalid.</p></div>';
       document.getElementById("retryGuestReport")?.addEventListener("click",()=>loadGuestReport(existing).catch(e=>{const p=root.querySelector(".audit-error");if(p)p.textContent=e?.message||"Unable to load the report.";}));
       return true;
     }
   }
   if(!linkToken)return false;
   if(linkToken){
     root.innerHTML='<div class="audit-status"><h2>Private audit report</h2><p class="muted">This secure email link can be exchanged once for a 12-hour private report session.</p><button id="openGuestReport" class="btn btn-primary" type="button">Open my private report</button></div>';
     document.getElementById("openGuestReport").addEventListener("click",async()=>{
       const button=document.getElementById("openGuestReport");button.disabled=true;button.textContent="Securing report access…";
       try{
         const c=await ensureClient();
         const r=await c.functions.invoke("guest-audit-access",{body:{action:"exchange",report_token:linkToken}});
         if(r.error||!r.data?.session_token)throw Error(r.data?.error||r.error?.message||"This report link is invalid or expired.");
         localStorage.setItem(key,JSON.stringify({token:r.data.session_token,expiresAt:Date.parse(r.data.expires_at)||Date.now()+12*60*60*1000,reportLinkHash:suppliedLinkHash}));
         history.replaceState(null,"",location.pathname);
         await loadGuestReport(r.data.session_token);
       }catch(e){root.innerHTML='<div class="audit-status"><h2>Report access unavailable</h2><p class="audit-error">'+esc(e?.message||"Unable to open this report.")+'</p></div>';}
     });
     return true;
   }
   await loadGuestReport(existing);
   return true;
 }
 async function loadGuestReport(sessionToken){
   const c=await ensureClient();
   const response=await c.functions.invoke("guest-audit-access",{body:{action:"report",session_token:sessionToken}});
   if(response.error||!response.data?.ok)throw Error(response.data?.error||response.error?.message||"Unable to load the private report.");
   const d=response.data;
   if(d.pending||!d.audit){
     root.innerHTML='<div class="audit-status"><h2>Payment confirmed — preparing your audit</h2><p class="muted">Your paid order is confirmed. The audit will begin automatically. This page will check progress every 10 seconds.</p></div>';
     setTimeout(()=>loadGuestReport(sessionToken).catch(e=>{root.innerHTML='<p class="audit-error">'+esc(e?.message||"Unable to refresh report.")+'</p>';}),10000);
     return;
   }
   const a=d.audit, fl=d.findings||[], files=d.files||[], score=a.overall_score==null?null:Number(a.overall_score);
   if(a.status!=="completed"){
     const progress=a.analysis_progress||{};
     const current=Number(a.current_chunk||progress.current_chunk||0),total=Number(a.total_chunks||progress.total_chunks||0);
     root.innerHTML='<div class="audit-status"><h2>Your W3M AI Code Audit is running…</h2><p class="muted">Status: '+esc(a.status)+'</p><p class="muted">'+(total?'AI analysis progress: '+esc(current)+' / '+esc(total)+' chunks.':'Scanning the public repository and preparing analysis…')+'</p><p class="muted">Your payment is confirmed. You can close this page; use the same email link on this device to return during this session.</p></div>';
     setTimeout(()=>loadGuestReport(sessionToken).catch(e=>{root.innerHTML='<p class="audit-error">'+esc(e?.message||"Unable to refresh report.")+'</p>';}),10000);
     return;
   }
   const cnt=counts(fl), date=a.completed_at||a.created_at||new Date().toISOString();
   root.innerHTML='<div class="audit-head"><div><div class="audit-kicker">W3M AI CODE AUDIT — PRIVATE GUEST REPORT</div><h1>Repository Technical Due Diligence</h1><p class="muted">'+esc(a.repo_owner||"")+' / '+esc(a.repo_name||"")+' · '+esc(a.commit_sha||"snapshot")+'</p></div><div><div class="audit-score">'+(score==null?"—":esc(score)+"/100")+'</div><div class="audit-risk">'+esc(String(a.risk_level||"Pending").toUpperCase())+'</div></div></div>'+
   '<div class="audit-actions"><button class="btn btn-primary" type="button" onclick="window.print()">Print / Save PDF</button><a class="btn btn-ghost" href="marketplace.html">Marketplace</a></div>'+
   '<div class="audit-meta"><div><strong>Audit ID</strong><span class="audit-id">'+esc(a.id)+'</span></div><div><strong>Commit</strong><span class="audit-id">'+esc(a.commit_sha||"—")+'</span></div><div><strong>Audit Date</strong><span>'+esc(new Date(date).toLocaleString())+'</span></div><div><strong>Engine</strong><span>'+esc(a.engine_version||"W3M AI Code Audit")+'</span></div></div>'+
   '<div class="audit-grid">'+metric("Security",a.security_score)+metric("Architecture",a.architecture_score)+metric("Code Quality",a.code_quality_score)+metric("Dependencies",a.dependency_score)+metric("Testing",a.testing_score)+metric("Documentation",a.documentation_score)+metric("Web3",a.web3_score)+metric("Scalability (static estimate)",a.scalability_score)+metric("AI Fit (evidence-based)",a.ai_fit_score)+'</div>'+
   '<div class="audit-section"><h2>Audit Summary</h2><p class="audit-summary">'+esc(a.summary||"No summary available.")+'</p><p class="muted">Files scanned: '+esc(a.files_scanned||0)+' · Lines scanned: '+esc(a.lines_scanned||0)+' · Coverage: '+esc(a.coverage_score||0)+'% · Findings: '+esc(fl.length)+'</p></div>'+
   '<div class="audit-section"><h2>Risk Overview</h2><div class="audit-grid">'+metric("Critical",cnt.critical,false)+metric("High",cnt.high,false)+metric("Medium",cnt.medium,false)+metric("Low",cnt.low,false)+metric("Info",cnt.info,false)+'</div></div>'+
   '<div class="audit-section"><h2>Technical Findings</h2>'+findings(fl)+'</div>'+
   '<div class="audit-section"><h2>Repository Snapshot</h2><div class="audit-grid">'+files.slice(0,30).map(x=>'<div class="audit-metric"><strong>'+esc(x.path)+'</strong><span class="muted">'+esc(x.language||"source")+' · '+esc(x.line_count||0)+' lines</span></div>').join("")+'</div></div>'+
   '<div class="audit-certificate"><div class="audit-kicker">W3M AI CODE AUDIT RECORD</div><h2>Audit Analysis Record</h2><p>This report records the analysis result for the repository and commit shown above. It is not a formal penetration test, certification, guarantee, or investment advice.</p><p class="audit-id">'+esc(a.id)+'</p></div>'+
   '<div class="audit-section"><small class="muted">Private guest report. This browser session expires automatically after 12 hours. Do not share this page or session.</small></div>';
 }
 async function openExisting(){
   if(!auditId)return false;
   try{
     const c=await ensureClient();
     const auth=await c.auth.getSession();
     if(!auth?.data?.session?.user){
       root.innerHTML='<div class="audit-status"><h2>Sign in to view this audit</h2><p class="muted">Detailed reports and repository findings are available only to the audit owner and authorized administrators.</p><a class="btn btn-primary" href="login.html?next='+encodeURIComponent(location.pathname.split("/").pop()+location.search)+'">Sign in</a> <a class="btn btn-ghost" href="register.html">Create account</a></div>';
       return true;
     }
     const a=await getAudit(c,auditId);if(!a)throw Error("Audit not found or you do not have permission to view it.");
     if(["queued","scanning","analyzing","retrying"].includes(a.status)){
       const p=a.analysis_progress||{}; const current=Number(a.current_chunk||p.current_chunk||0); const total=Number(a.total_chunks||p.total_chunks||0);
       const pct=total?Math.min(100,Math.round(current/total*100)):0;
       const retry=a.status==="retrying" ? '<p class="muted">Gemini is temporarily busy. W3M is retrying automatically'+(p.retry_after_seconds?' — next retry in about '+esc(p.retry_after_seconds)+'s':'')+'.</p>' : '';
       root.innerHTML='<div class="audit-status"><h2>W3M AI Code Audit is running…</h2><p class="muted">Status: '+esc(a.status)+'</p>'+(total?'<p class="muted">AI analysis progress: '+esc(current)+' / '+esc(total)+' chunks ('+esc(pct)+'%).</p>':'<p class="muted">File batch: '+esc(Number(p.file_batch_index||0)+1)+' / '+esc(p.total_file_batches||'?')+'.</p>')+'<div style="height:8px;background:#25213a;border-radius:99px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:currentColor"></div></div>'+retry+'<p class="muted">Progress is saved automatically. You can leave this page safely.</p><button id="w3mStopFollow" class="btn btn-ghost" type="button" onclick="window.W3MStopAuditFollow&&window.W3MStopAuditFollow()">Stop automatic follow-up</button><p id="w3mFollowNote" class="muted" aria-live="polite">This stops browser polling/resume attempts; an already-running server request may finish its current chunk.</p></div>';
       setTimeout(async()=>{if(!autoFollow)return;await resumeIfNeeded(a);if(autoFollow)openExisting();},10000);return true;
     }
     if(a.status==="paused"){
 const wait=Number(a.analysis_progress?.retry_after_seconds||0);
 if(wait>0){
  root.innerHTML='<div class="audit-status"><h2>AI Analysis Temporarily Paused</h2><p class="muted">Gemini quota/service limit was reached. Completed chunks are saved and will not be lost.</p><p class="muted">W3M will automatically resume this audit in about <strong id="w3mRetryCountdown"></strong>.</p><p class="audit-error">'+esc(a.error_message||"Temporary AI service interruption.")+'</p><button class="btn btn-ghost" type="button" onclick="location.reload()">Refresh</button></div>';
  let left=wait;
  const tick=()=>{
   const el=document.getElementById("w3mRetryCountdown"); if(!el)return;
   if(left<=0){window.W3MResumeAudit&&window.W3MResumeAudit();return;}
   const h=Math.floor(left/3600),m=Math.floor((left%3600)/60),sec=left%60;
   el.textContent=(h?h+"h ":"")+(m?m+"m ":"")+sec+"s"; left--; setTimeout(tick,1000);
  }; tick();
 }else{
  root.innerHTML='<div class="audit-status"><h2>AI Analysis Temporarily Paused</h2><p class="muted">Gemini was temporarily unavailable. Completed chunks have been saved and will not be lost.</p><p class="audit-error">'+esc(a.error_message||"Temporary AI service interruption.")+'</p><button class="btn btn-primary" type="button" onclick="window.W3MResumeAudit&&window.W3MResumeAudit()">Resume AI Audit</button> <button class="btn btn-ghost" type="button" onclick="location.href=\'code-audit.html\'">New Audit</button></div>';
 }return true;}
if(a.status==="failed"){root.innerHTML='<div class="audit-status"><h2>Audit could not be completed</h2><p class="audit-error">'+esc(a.error_message||"The audit service failed without a detailed message.")+'</p><button class="btn btn-primary" type="button" onclick="location.href=\'code-audit.html\'">Try another audit</button></div>';return true;}
     await render(a);return true;
   }catch(e){root.innerHTML='<div class="audit-status"><h2>W3M AI Code Audit</h2><p class="audit-error">'+esc(e?.message||"Unable to load audit.")+"</p></div>";return true;}
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>openGuestReport().then(x=>{if(!x)return openExisting().then(y=>{if(!y)start()});}).catch(e=>{root.innerHTML='<div class="audit-status"><h2>Private report</h2><p class="audit-error">'+esc(e?.message||"Unable to open report.")+"</p></div>";}),{once:true});else openGuestReport().then(x=>{if(!x)return openExisting().then(y=>{if(!y)start()});}).catch(e=>{root.innerHTML='<div class="audit-status"><h2>Private report</h2><p class="audit-error">'+esc(e?.message||"Unable to open report.")+"</p></div>";});

 async function loadAuditHistory(){
   const panel=document.getElementById("auditHistory");
   if(!panel)return;
   if(auditId){panel.hidden=true;return;}
   const c=await ensureClient();
   const sessionResult=await c.auth.getSession();
   const session=sessionResult?.data?.session;
   const topbar=document.querySelector(".topbar nav");
   const accountLink=document.getElementById("auditAccountLink");
   if(session?.user){
     if(accountLink){accountLink.textContent="My Account";accountLink.href="login.html";accountLink.hidden=false;}
   }else{
     if(accountLink){accountLink.textContent="Sign in";accountLink.href="login.html?next="+encodeURIComponent("code-audit.html");accountLink.hidden=false;}
     const card=panel.querySelector(".audit-history-card");
     if(card)card.innerHTML='<div class="audit-kicker">MEMBERS AREA</div><h2 id="auditHistoryTitle">W3M AI Audit Activity &amp; History</h2><p class="muted">The community audit archive and statistics are available to signed-in members. Detailed audit findings remain restricted by account permissions.</p><div class="audit-history-controls"><a class="btn btn-primary" href="login.html?next='+encodeURIComponent("code-audit.html")+'">Sign in to view archive</a><a class="btn btn-ghost" href="register.html?next='+encodeURIComponent("code-audit.html")+'">Create account</a></div><p class="audit-history-footnote">Repository security details are not published in the public archive.</p>';
     return;
   }
   const dateInput=document.getElementById("auditHistoryDate");
   const countEl=document.getElementById("auditHistoryCount");
   const message=document.getElementById("auditHistoryMessage");
   const list=document.getElementById("auditHistoryList");
   const localDate=d=>{const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return y+"-"+m+"-"+day;};
   const calendar=document.getElementById("auditCalendar");
   const calendarToggle=document.getElementById("auditCalendarToggle");
   const monthNames=["January","February","March","April","May","June","July","August","September","October","November","December"];
   const weekdayNames=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
   const today=new Date();let shownMonth=new Date(today.getFullYear(),today.getMonth(),1);
   dateInput.value=localDate(today);
   const renderCalendar=()=>{
     if(!calendar)return;
     const year=shownMonth.getFullYear(),month=shownMonth.getMonth();
     const firstDay=new Date(year,month,1).getDay(),days=new Date(year,month+1,0).getDate();
     const selected=dateInput.value;
     let cells=weekdayNames.map(day=>'<span class="audit-calendar-weekday">'+day+'</span>').join("");
     for(let i=0;i<firstDay;i++)cells+='<span class="audit-calendar-empty" aria-hidden="true"></span>';
     for(let day=1;day<=days;day++){
       const value=year+"-"+String(month+1).padStart(2,"0")+"-"+String(day).padStart(2,"0");
       const active=value===selected?" selected":"";
       const isToday=value===localDate(today)?" today":"";
       cells+='<button type="button" class="audit-calendar-day'+active+isToday+'" data-date="'+value+'" aria-pressed="'+(value===selected?'true':'false')+'">'+day+'</button>';
     }
     calendar.innerHTML='<div class="audit-calendar-header"><button type="button" data-month="-1" aria-label="Previous month">‹</button><strong>'+monthNames[month]+' '+year+'</strong><button type="button" data-month="1" aria-label="Next month">›</button></div><div class="audit-calendar-grid">'+cells+'</div><div class="audit-calendar-footer"><button type="button" data-today="true">Today</button><button type="button" data-close="true">Close</button></div>';
   };
   const openCalendar=()=>{if(!calendar)return;calendar.hidden=false;dateInput.setAttribute("aria-expanded","true");calendarToggle?.setAttribute("aria-expanded","true");renderCalendar();};
   const closeCalendar=()=>{if(!calendar)return;calendar.hidden=true;dateInput.setAttribute("aria-expanded","false");calendarToggle?.setAttribute("aria-expanded","false");};
   calendarToggle?.addEventListener("click",()=>calendar?.hidden?openCalendar():closeCalendar());
   dateInput.addEventListener("click",openCalendar);
   calendar?.addEventListener("click",event=>{
     const btn=event.target.closest("button");if(!btn)return;
     if(btn.dataset.month){shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()+Number(btn.dataset.month),1);renderCalendar();return;}
     if(btn.dataset.close){closeCalendar();return;}
     if(btn.dataset.today){dateInput.value=localDate(today);shownMonth=new Date(today.getFullYear(),today.getMonth(),1);closeCalendar();load();return;}
     if(btn.dataset.date){dateInput.value=btn.dataset.date;const [y,m]=btn.dataset.date.split("-").map(Number);shownMonth=new Date(y,m-1,1);closeCalendar();load();}
   });
   const load=async()=>{
     const chosen=dateInput.value;
     if(!chosen){message.textContent="Choose a date to view its audit activity.";countEl.textContent="—";list.innerHTML="";return;}
     message.textContent="Loading audit records…";countEl.textContent="—";list.innerHTML="";
     try{
       const [y,m,d]=chosen.split("-").map(Number);
       const start=new Date(y,m-1,d),end=new Date(y,m-1,d+1);
       const r=await c.rpc("get_code_audit_archive",{p_start:start.toISOString(),p_end:end.toISOString()});
       if(r.error)throw r.error;
       const rows=r.data||[];countEl.textContent=String(rows.length);
       if(!rows.length){message.textContent="No audit records were found for "+chosen+".";return;}
       message.textContent="Showing "+rows.length+" recorded audit attempt"+(rows.length===1?"":"s")+" for "+chosen+".";
       list.innerHTML=rows.map(a=>{
         const repo=(a.repo_owner||"unknown-owner")+"/"+(a.repo_name||"repository");
         const repoLabel=esc(repo);
         const when=a.created_at?new Date(a.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"Time unavailable";
         const rawStatus=String(a.status||"unknown").toLowerCase();
         const status=["completed","failed","paused","running","pending","processing","queued","scanning","analyzing","retrying"].includes(rawStatus)?rawStatus:"unknown";
         const score=a.overall_score==null?"":'<div class="audit-history-score">'+esc(Number(a.overall_score).toFixed(1))+'/100</div>';
         const result=a.overall_score==null?esc(a.risk_level||"Result pending"):esc(a.risk_level||"Risk not rated");
         return '<article class="audit-history-row"><div><div class="audit-history-repo">'+repoLabel+'</div><div class="audit-history-meta">'+esc(when)+' · '+esc(a.files_scanned||0)+' files scanned'+'</div></div><div class="audit-history-result">'+score+'<div>'+result+'</div><span class="audit-history-status '+esc(status)+'">'+esc(status)+'</span></div></article>';
       }).join("");
     }catch(e){console.error("Unable to load public audit history",e);message.textContent="Audit history is temporarily unavailable. Please try again later.";countEl.textContent="—";}
   };
   await load();
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>loadAuditHistory(),{once:true});else loadAuditHistory();
})();