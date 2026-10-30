(function(){
"use strict";
const root=document.getElementById("buyerRoot");
if(!root)return;
const esc=v=>String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let mounted=false, client=null, user=null;
function mount(){
 if(mounted || !document.getElementById("buyerNotice") || !window.Web3MarketSupabase?.getClient)return;
 client=window.Web3MarketSupabase.getClient(); if(!client)return;
 mounted=true;
 const section=document.createElement("section");
 section.className="panel section-panel";
 section.id="buyerDueDiligence";
 section.style.margin="22px 0";
 section.innerHTML='<div class="section-title"><div><h2>Buyer Due Diligence</h2><p>Review a marketplace project before making an offer. Reports and notes are private to your buyer account.</p></div></div><div style="display:flex;gap:10px;flex-wrap:wrap"><select id="ddProject" aria-label="Choose marketplace project" style="flex:1;min-width:220px;padding:12px;border:1px solid #ccd6e0;border-radius:9px"><option value="">Loading projects…</option></select><button class="btn primary" id="ddCreate" type="button">Analyze project</button></div><p id="ddMessage" class="muted" role="status">Loading available projects…</p><div id="ddReports"></div>';
 const anchor=root.querySelector(".grid") || root.firstElementChild;
 if(anchor)root.insertBefore(section,anchor);else root.appendChild(section);
 section.querySelector("#ddCreate").addEventListener("click",createReport);
 load();
}
async function load(){
 const msg=document.getElementById("ddMessage"),select=document.getElementById("ddProject");
 const session=await client.auth.getSession(); user=session.data?.session?.user;
 if(!user){msg.textContent="Sign in to use Buyer Due Diligence.";return}
 const projects=await client.from("projects").select("id,title").eq("status","active").order("title").limit(200);
 if(projects.error){msg.textContent="Marketplace projects could not be loaded.";return}
 select.innerHTML='<option value="">Choose a marketplace project…</option>'+(projects.data||[]).map(p=>'<option value="'+esc(p.id)+'">'+esc(p.title)+'</option>').join("");
 msg.textContent="Choose a project to create a private due diligence report.";
 await renderReports();
}
async function createReport(){
 const id=document.getElementById("ddProject").value,msg=document.getElementById("ddMessage"),btn=document.getElementById("ddCreate");
 if(!id){msg.textContent="Choose a project first.";return}
 btn.disabled=true;msg.textContent="Preparing the buyer report…";
 try{
  const result=await client.functions.invoke("buyer-dd-create",{body:{project_id:id}});
  if(result.error||result.data?.error)throw new Error(result.data?.error||result.error?.message||"Request failed");
  msg.textContent="Report saved. A missing audit is clearly marked as unavailable, not safe.";
  await renderReports();
 }catch(e){msg.textContent=e.message||"Could not create the report."}
 finally{btn.disabled=false}
}
async function renderReports(){
 const host=document.getElementById("ddReports");
 const q=await client.from("buyer_due_diligence_reports").select("id,project_id,status,audit_source_status,audit_snapshot,created_at").order("created_at",{ascending:false}).limit(30);
 if(q.error){host.textContent="Saved reports are temporarily unavailable.";return}
 const ids=[...new Set((q.data||[]).map(r=>r.project_id))];
 const p=ids.length?await client.from("projects").select("id,title").in("id",ids):{data:[]};
 const names=new Map((p.data||[]).map(x=>[x.id,x.title]));
 if(!q.data?.length){host.innerHTML='<p class="muted">No reports yet.</p>';return}
 host.innerHTML=q.data.map(r=>{
  const s=r.audit_snapshot||{}, available=r.audit_source_status==="available";
  return '<article style="border-top:1px solid #e4eaf0;padding:16px 0;margin-top:12px"><h3>'+esc(names.get(r.project_id)||"Marketplace project")+'</h3><p><b>'+(available?"Code audit available":"No completed code audit found")+'</b> · '+esc(new Date(r.created_at).toLocaleString())+'</p>'+
  (available?'<p>Score: '+esc(s.score??"N/A")+' / 100 · Risk: '+esc(s.risk_level??"Not rated")+' · Files scanned: '+esc(s.files_scanned??"N/A")+' · Coverage: '+esc(s.coverage_percent??"N/A")+'%</p><p>Commit: <code>'+esc(s.commit_sha||"Not recorded")+'</code></p>':'<p>This project has no linked completed code audit. This does not mean the project is safe.</p>')+
  '<ul>'+(s.limitations||["Automated review is limited and is not a security guarantee."]).map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul>'+
  '<label for="dd-note-'+r.id+'">Private buyer notes</label><textarea id="dd-note-'+r.id+'" rows="3" maxlength="10000" style="display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:10px;border:1px solid #ccd6e0;border-radius:8px" placeholder="Only you can read these notes…"></textarea><button class="btn" data-save-note="'+r.id+'" type="button">Save private note</button><span class="muted" id="dd-note-status-'+r.id+'"></span></article>';
 }).join("");
 host.querySelectorAll("[data-save-note]").forEach(b=>b.addEventListener("click",()=>saveNote(b.dataset.saveNote)));
 const noteRows=await client.from("buyer_due_diligence_private_notes").select("report_id,note").in("report_id",q.data.map(r=>r.id));
 if(!noteRows.error)(noteRows.data||[]).forEach(n=>{const el=document.getElementById("dd-note-"+n.report_id);if(el)el.value=n.note});
}
async function saveNote(reportId){
 const field=document.getElementById("dd-note-"+reportId),status=document.getElementById("dd-note-status-"+reportId);
 if(!field||!user)return;
 const result=await client.from("buyer_due_diligence_private_notes").upsert({report_id:reportId,buyer_id:user.id,note:field.value},{onConflict:"report_id,buyer_id"});
 status.textContent=result.error?" Could not save note.":" Saved privately.";
}
const observer=new MutationObserver(mount);observer.observe(root,{childList:true,subtree:true});mount();
})();