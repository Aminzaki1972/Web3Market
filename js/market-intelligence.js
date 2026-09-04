"use strict";
(async function(){
 const root=document.getElementById('app');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 if(!root)return;
 if(!sb){root.innerHTML='<div class="status">Database connection unavailable.</div>';return;}
 const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
 const money=v=>{const n=Number(v||0);if(!n)return '—';return new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n)};
 try{
  const {data:{user}}=await sb.auth.getUser();
  if(!user){root.innerHTML='<div class="status">Please sign in to view Market Intelligence.</div>';return;}
  const [market,deal,cats]=await Promise.all([
   sb.rpc('get_market_statistics'),sb.rpc('get_deal_analytics'),sb.rpc('get_market_category_stats')
  ]);
  if(market.error||deal.error||cats.error){console.error(market.error,deal.error,cats.error);root.innerHTML='<div class="status">Unable to load market intelligence.</div>';return;}
  const m=market.data||{},d=deal.data||{},rows=Array.isArray(cats.data)?cats.data:[];
  const card=(label,value)=>`<div class="card"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  const categoryRows=rows.length?rows.map(x=>`<div class="row"><b>${esc(x.category)}</b><span>${money(x.project_count)}</span><span>${money(x.average_price)}</span><span>${money(x.median_price)}</span><span>${x.average_score==null?'—':Math.round(Number(x.average_score))+'/100'}</span></div>`).join(''):'<div class="status">No active project categories yet.</div>';
  root.innerHTML=`<section class="section"><h2>Marketplace</h2><div class="grid">${card('Active Projects',money(m.active_projects))}${card('Average Asking Price',money(m.average_asking_price))}${card('Median Asking Price',money(m.median_asking_price))}${card('Average Project Score',m.average_project_score?Math.round(Number(m.average_project_score))+'/100':'—')}${card('Lowest Asking Price',money(m.lowest_asking_price))}${card('Highest Asking Price',money(m.highest_asking_price))}${card('Average Valuation',money(m.average_valuation))}${card('Total Projects',money(m.total_projects))}</div></section><section class="section"><h2>Deal Activity</h2><div class="grid">${card('Total Deals',money(d.total_deals))}${card('Active Deals',money(d.active_deals))}${card('Completed Deals',money(d.completed_deals))}${card('Disputed Deals',money(d.disputed_deals))}${card('Completed GMV',money(d.total_gmv))}${card('Average Deal Value',money(d.average_deal_value))}${card('Platform Fees',money(d.platform_fees))}${card('Avg. Days to Completion',d.avg_days_to_completion?Number(d.avg_days_to_completion).toFixed(1):'—')}</div></section><section class="section card"><h2>Category Intelligence</h2><div class="table"><div class="row head"><span>Category</span><span>Projects</span><span>Avg Price</span><span>Median</span><span>Avg Score</span></div>${categoryRows}</div></section>`;
 }catch(e){console.error(e);root.innerHTML='<div class="status">Unable to load market intelligence.</div>';}
})();
