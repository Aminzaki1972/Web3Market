"use strict";
(async function(){
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;if(!sb)return;
 const esc=v=>String(v??"").replace(/[&<>\"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
 const score=v=>v==null?"—":`${Math.round(Number(v))}/100`;
 const money=v=>{const n=Number(v);return Number.isFinite(n)&&n>0?`USD ${new Intl.NumberFormat("en-US",{maximumFractionDigits:0}).format(n)}`:"Valuation pending"};
 const range=(lo,mid,hi)=>{if(Number.isFinite(Number(lo))&&Number.isFinite(Number(hi))&&Number(lo)>0&&Number(hi)>0)return `USD ${Number(lo).toLocaleString()} – ${Number(hi).toLocaleString()}`;return money(mid)};
 const wait=()=>new Promise(r=>{let n=0;const t=setInterval(()=>{if(document.querySelector(".project-card[data-project-id]")){clearInterval(t);r()}if(++n>50){clearInterval(t);r()}},100)});
 try{
  await wait();
  const {data:projects,error}=await sb.from("projects").select("id,price,currency,verification,ai_score").eq("status","active").limit(50);
  const activeIds=new Set((projects||[]).map(p=>p.id));
  document.querySelectorAll(".project-card[data-project-id]").forEach(card=>{if(!activeIds.has(card.getAttribute("data-project-id")))card.remove()});
  if(error||!projects?.length)return;
  const ids=projects.map(p=>p.id);
  const {data:intel}=await sb.from("project_intelligence").select("project_id,overall_score,confidence_score,risk_level,valuation_mid,valuation_low,valuation_high,price_position,valuation_method").in("project_id",ids);
  const im=Object.fromEntries((intel||[]).map(x=>[x.project_id,x]));
  if(!document.getElementById("wm-intel-v2-style")){const s=document.createElement("style");s.id="wm-intel-v2-style";s.textContent=".wm-intel-v2{margin:12px 0 0;padding:10px;border:1px solid #e3e5ee;border-radius:12px;background:#fafaff}.wm-intel-v2-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.wm-intel-v2-item{padding:7px 8px;background:#fff;border:1px solid #eceef3;border-radius:8px}.wm-intel-v2-item small{display:block;color:#737b88;font-size:8px;font-weight:800}.wm-intel-v2-item b{display:block;margin-top:2px;font-size:12px;color:#171b23}.wm-intel-v2-note{margin-top:7px;color:#737b88;font-size:8px}@media(max-width:620px){.wm-intel-v2-grid{gap:5px}.wm-intel-v2-item{padding:6px}.wm-intel-v2-item b{font-size:11px}}";document.head.appendChild(s)}
  projects.forEach(p=>{const card=document.querySelector(`.project-card[data-project-id="${CSS.escape(p.id)}"]`);if(!card)return;card.querySelector(".wm-intel-v2")?.remove();const i=im[p.id]||{};const ai=p.verification?.ai||{};const projectScore=i.overall_score??p.ai_score??ai.score;const confidence=i.confidence_score??ai.confidence_score;const fair=i.valuation_mid??null;const valuation=range(i.valuation_low,i.valuation_mid,i.valuation_high);const el=document.createElement("div");el.className="wm-intel-v2";el.innerHTML=`<div class="wm-intel-v2-grid"><div class="wm-intel-v2-item"><small>AI Project Score</small><b>${esc(score(projectScore))}</b></div><div class="wm-intel-v2-item"><small>Confidence Score</small><b>${esc(score(confidence))}</b></div><div class="wm-intel-v2-item"><small>AI Fair Value</small><b>${esc(valuation)}</b></div><div class="wm-intel-v2-item"><small>Risk Level</small><b>${esc(i.risk_level||ai.risk_level||"Unrated")}</b></div></div><div class="wm-intel-v2-note">${i.valuation_method&&i.valuation_method!=="insufficient_evidence"?`AI valuation method: ${esc(i.valuation_method.replaceAll("_"," "))}.`:`AI valuation pending: insufficient independent evidence. Asking price remains unchanged.`}</div>`;card.appendChild(el)});
 }catch(e){console.warn("Web3Market intelligence v2 unavailable",e)}
})();
