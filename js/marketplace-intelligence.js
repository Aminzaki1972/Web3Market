"use strict";
(async function(){
  const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
  if(!sb)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const score=v=>v==null?'—':`${Math.round(Number(v))}/100`;
  const money=(v,c='USD')=>{const n=Number(v);if(!Number.isFinite(n)||n<=0)return '—';return `${esc(c)} ${new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n)}`};
  const card=(label,value)=>`<div class="wm-intel-card"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  try{
    const styleId='web3market-intelligence-style';
    if(!document.getElementById(styleId)){
      const style=document.createElement('style');
      style.id=styleId;
      style.textContent='.wm-intelligence{margin-top:12px;padding:12px;border:1px solid #e2e4ff;border-radius:13px;background:linear-gradient(135deg,#f7f6ff,#fff);font-size:10px}.wm-intel-top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:9px}.wm-intel-top b{font-size:10px;color:#5149db}.wm-intel-top span{padding:3px 7px;border-radius:999px;background:#eef0f4;color:#596170;font-size:9px;font-weight:800;text-transform:capitalize}.wm-intel-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.wm-intel-card{min-width:0;padding:8px;border:1px solid #e7e9ee;border-radius:9px;background:#fff}.wm-intel-card span{display:block;color:#7b8390;font-size:8px;font-weight:800}.wm-intel-card strong{display:block;margin-top:3px;color:#171b23;font-size:12px}.wm-intel-sub{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px;color:#6d7582;font-size:8px;font-weight:700}.wm-intel-sub span{padding:4px 6px;border-radius:7px;background:#f2f3f6}.wm-intel-sub b{color:#171b23}@media(max-width:620px){.wm-intelligence{padding:10px}.wm-intel-card{padding:7px}.wm-intel-card strong{font-size:11px}}';
      document.head.appendChild(style);
    }
    const {data,error}=await sb.from('projects').select('id,title,price,currency,category,owner_id,status').eq('status','active').order('created_at',{ascending:false}).limit(12);
    if(error||!data?.length)return;
    const ids=data.map(p=>p.id);
    const [iRes,dRes,vRes,rRes,sRes]=await Promise.all([
      sb.from('project_intelligence').select('project_id,overall_score,investment_score,technical_score,security_score,revenue_score,market_score,acquisition_readiness_score,confidence_score,risk_level,ai_summary,valuation_low,valuation_mid,valuation_high,valuation_method,price_position').in('project_id',ids),
      sb.from('deal_intelligence').select('project_id,deal_score,deal_rating,trust_score').in('project_id',ids),
      sb.from('project_valuation_history').select('project_id,fair_value,valuation_low,valuation_high,price_position,created_at').in('project_id',ids).order('created_at',{ascending:false}),
      sb.from('web3market_reputation').select('user_id,reputation_score,completed_deals,wallet_verified,ownership_verified,github_verified,domain_verified').in('user_id',data.map(p=>p.owner_id)),
      sb.from('project_verification_summary').select('project_id,verification_score,ownership_verified,domain_verified,github_verified,identity_verified,business_verified').in('project_id',ids)
    ]);
    const map=(arr,key)=>Object.fromEntries((arr||[]).map(x=>[x[key],x]));
    const intel=map(iRes.data,'project_id'), deal=map(dRes.data,'project_id'), verify=map(sRes.data,'project_id'), rep=map(rRes.data,'user_id');
    const vals={};for(const v of (vRes.data||[])){if(!vals[v.project_id])vals[v.project_id]=v;}
    data.forEach(p=>{
      const anchors=[...document.querySelectorAll(`a[href*="project.html?id=${p.id}"]`),...document.querySelectorAll(`a[href*="project-details.html?id=${p.id}"]`)];
      const anchor=anchors[0];
      if(!anchor)return;
      const listing=anchor.closest('.listing');if(!listing)return;
      const old=listing.querySelector('.wm-intelligence');if(old)old.remove();
      const i=intel[p.id]||{},d=deal[p.id]||{},v=vals[p.id]||{},s=verify[p.id]||{},r=rep[p.owner_id]||{};
      const fairValue=v.fair_value??i.valuation_mid;
      const pricePosition=v.price_position??i.price_position;
      const trust=d.trust_score??r.reputation_score??s.verification_score;
      const html=`<div class="wm-intelligence" aria-label="Web3Market Intelligence"><div class="wm-intel-top"><b>Web3Market Intelligence</b><span>${esc(i.risk_level||'unrated')}</span></div><div class="wm-intel-grid">${card('Project Score',score(i.overall_score))}${card('Fair Value',money(fairValue,p.currency))}${card('Deal Score',score(d.deal_score))}${card('Trust Score',score(trust))}</div><div class="wm-intel-sub"><span>Acquisition Readiness <b>${score(i.acquisition_readiness_score)}</b></span><span>Verification <b>${score(s.verification_score)}</b></span><span>${pricePosition?esc(pricePosition.replaceAll('_',' ')):'valuation pending'}</span></div></div>`;
      listing.insertAdjacentHTML('beforeend',html);
    });
  }catch(e){console.warn('Web3Market intelligence UI unavailable',e);}
})();
