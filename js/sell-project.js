"use strict";
(function(){
 const form=document.querySelector('#projectForm'),out=document.querySelector('#formStatus');
 const sb=()=>window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 const val=(fd,n)=>{const v=fd.get(n);return v===null?'':String(v).trim()};
 const num=(fd,n)=>{const v=val(fd,n);return v===''?null:Number(v)};
 form.addEventListener('submit',async e=>{
  e.preventDefault(); out.textContent='Checking your seller account…';
  const client=sb(); if(!client){out.textContent='Database connection unavailable.';return}
  const {data:{user},error:ue}=await client.auth.getUser();
  if(ue||!user){out.textContent='Please sign in before listing a project.';return}
  const {data:profile,error:pe}=await client.from('profiles').select('role').eq('id',user.id).maybeSingle();
  if(pe){console.error(pe);out.textContent='Unable to verify your account role.';return}
  if(String(profile?.role||user.user_metadata?.role||'').toLowerCase()!=='seller'){
   out.textContent='This page is for Seller accounts. Please sign in with a Seller account.';return;
  }
  const fd=new FormData(form),title=val(fd,'title'),short=val(fd,'short_description'),description=val(fd,'description');
  if(!title||short.length<20||description.length<50){out.textContent='Please complete the required project information.';return}
  const payload={owner_id:user.id,title,description:(short+'\n\n'+description).trim(),category:val(fd,'category')||null,price:num(fd,'asking_price'),currency:'USD',status:'draft'};
  const optional={blockchain:val(fd,'blockchain')||null,sale_type:val(fd,'sale_type')||'fixed_price',monthly_revenue:num(fd,'monthly_revenue'),monthly_profit:num(fd,'monthly_profit'),users_count:num(fd,'users_count'),monthly_volume:num(fd,'monthly_volume'),project_url:val(fd,'project_url')||null,github_url:val(fd,'github_url')||null,logo_url:val(fd,'logo_url')||null};
  Object.assign(payload,optional);
  out.textContent='Creating draft…';
  let result=await client.from('projects').insert(payload).select('id').single();
  if(result.error && /column .* does not exist/i.test(String(result.error.message||''))){Object.keys(optional).forEach(k=>delete payload[k]);result=await client.from('projects').insert(payload).select('id').single();}
  if(result.error){console.error(result.error);out.textContent=result.error.message||'Unable to create listing.';return}
  out.innerHTML=`Draft created successfully. <a href="project.html?id=${encodeURIComponent(result.data.id)}">Open project</a>`;
  form.reset();
 });
})();
