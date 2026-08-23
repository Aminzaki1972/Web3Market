"use strict";
(function(){
 const form=document.querySelector('#projectForm'),out=document.querySelector('#formStatus');
 if(!form)return;
 const sb=()=>window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 const val=(fd,n)=>{const v=fd.get(n);return v===null?'':String(v).trim()};
 const num=(fd,n)=>{const v=val(fd,n);if(v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
 const vals=(fd,n)=>fd.getAll(n).map(v=>String(v).trim()).filter(Boolean);
 const url=(fd,n)=>val(fd,n)||null;
 form.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!out)return;
  out.textContent='Checking your seller account…';
  const client=sb();
  if(!client){out.textContent='Database connection unavailable.';return;}
  const {data:{user},error:ue}=await client.auth.getUser();
  if(ue||!user){out.textContent='Please sign in before listing a project.';return;}
  const {data:profile,error:pe}=await client.from('profiles').select('role').eq('id',user.id).maybeSingle();
  if(pe){console.error(pe);out.textContent='Unable to verify your account role.';return;}
  if(String(profile?.role||user.user_metadata?.role||'').toLowerCase()!=='seller'){
   out.textContent='This page is for Seller accounts. Please sign in with a Seller account.';return;
  }
  const fd=new FormData(form);
  const title=val(fd,'title'),short=val(fd,'short_description'),description=val(fd,'description');
  if(!title||short.length<20||description.length<50){out.textContent='Please complete the required project information.';return;}
  const social={
   facebook:url(fd,'facebook_url'),twitter:url(fd,'twitter_url'),github:url(fd,'github_url'),linkedin:url(fd,'linkedin_url'),instagram:url(fd,'instagram_url'),telegram:url(fd,'telegram_url'),discord:url(fd,'discord_url'),youtube:url(fd,'youtube_url'),tiktok:url(fd,'tiktok_url'),reddit:url(fd,'reddit_url'),medium:url(fd,'medium_url'),other:url(fd,'other_social_url'),app_store:url(fd,'app_store_url'),documentation:url(fd,'documentation_url'),demo:url(fd,'demo_url')
  };
  Object.keys(social).forEach(k=>{if(!social[k])delete social[k]});
  const financials={
   has_revenue:val(fd,'has_revenue'),revenue_period:val(fd,'revenue_period'),monthly_revenue:num(fd,'monthly_revenue'),yearly_revenue:num(fd,'yearly_revenue'),monthly_profit:num(fd,'monthly_profit'),yearly_profit:num(fd,'yearly_profit'),monthly_expenses:num(fd,'monthly_expenses'),growth_rate:val(fd,'growth_rate'),revenue_sources:val(fd,'revenue_sources'),financial_notes:val(fd,'financial_notes')
  };
  const performance={
   users_count:num(fd,'users_count'),active_users:num(fd,'active_users'),customers_count:num(fd,'customers_count'),monthly_visits:num(fd,'monthly_visits'),total_sales:num(fd,'total_sales'),monthly_volume:num(fd,'monthly_volume'),conversion_rate:val(fd,'conversion_rate'),last_active_date:val(fd,'last_active_date'),traffic_sources:val(fd,'traffic_sources'),tech_stack:val(fd,'tech_stack'),development_stage:val(fd,'development_stage'),market_opportunity:val(fd,'market_opportunity')
  };
  const verification={
   domain_ownership:val(fd,'domain_ownership'),github_ownership:val(fd,'github_ownership'),business_verification:val(fd,'business_verification'),identity_verification:val(fd,'identity_verification'),ownership_declaration:val(fd,'ownership_declaration')
  };
  const payload={
   owner_id:user.id,
   title,
   description,
   short_description:short,
   full_description:description,
   website_url:url(fd,'project_url'),
   category:val(fd,'primary_type')||'Web3 / Blockchain',
   project_status:val(fd,'project_status')||null,
   year_created:num(fd,'year_created'),
   logo_url:url(fd,'logo_url'),
   demo_url:url(fd,'demo_url'),
   project_types:vals(fd,'project_types'),
   services:vals(fd,'services'),
   target_audience:vals(fd,'audience'),
   target_markets:val(fd,'target_markets')||null,
   business_model:val(fd,'business_model')||null,
   competitive_advantage:val(fd,'competitive_advantage')||null,
   competitors:val(fd,'competitors')||null,
   social_accounts:social,
   financials:financials,
   performance:performance,
   assets:vals(fd,'assets'),
   sale_type:val(fd,'sale_type')||null,
   negotiable:val(fd,'negotiable')?val(fd,'negotiable').toLowerCase()==='yes':true,
   transfer_terms:val(fd,'transfer_terms')||null,
   verification:verification,
   blockchain:val(fd,'blockchain')||null,
   price:num(fd,'asking_price'),
   currency:val(fd,'currency')||'USD',
   status:'draft',
   ai_status:'pending'
  };
  out.textContent='Saving draft…';
  const {data,error}=await client.from('projects').insert(payload).select('id').single();
  if(error){console.error(error);out.textContent=error.message||'Unable to create listing.';return;}
  localStorage.setItem('web3market_project_id',String(data.id));
  out.innerHTML=`Draft created successfully. <a href="project.html?id=${encodeURIComponent(data.id)}">Open project</a>`;
 });
})();
