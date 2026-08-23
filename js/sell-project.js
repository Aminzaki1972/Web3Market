"use strict";
(function(){
 const form=document.querySelector('#projectForm'),out=document.querySelector('#formStatus');
 if(!form)return;
 const sb=()=>window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 const val=(fd,n)=>{const v=fd.get(n);return v===null?'':String(v).trim()};
 const num=(fd,n)=>{const v=val(fd,n);return v===''?null:Number(v)};
 const optional={blockchain:'Blockchain',sale_type:'Sale Type',monthly_revenue:'Monthly Revenue',monthly_profit:'Monthly Profit',users_count:'Users Count',monthly_volume:'Monthly Volume',project_url:'Project URL',github_url:'GitHub URL',logo_url:'Logo URL'};
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
  const extras={blockchain:val(fd,'blockchain')||null,sale_type:val(fd,'sale_type')||'fixed_price',monthly_revenue:num(fd,'monthly_revenue'),monthly_profit:num(fd,'monthly_profit'),users_count:num(fd,'users_count'),monthly_volume:num(fd,'monthly_volume'),project_url:val(fd,'project_url')||null,github_url:val(fd,'github_url')||null,logo_url:val(fd,'logo_url')||null};
  Object.assign(payload,extras);
  out.textContent='Saving draft…';
  let result=await client.from('projects').insert(payload).select('id').single();
  if(result.error && /schema cache|column .* does not exist/i.test(String(result.error.message||''))){
    // The deployed REST schema may lag behind the database. Retry with only stable columns.
    const stable={owner_id:payload.owner_id,title:payload.title,description:payload.description,category:payload.category,price:payload.price,currency:payload.currency,status:payload.status};
    result=await client.from('projects').insert(stable).select('id').single();
  }
  if(result.error){console.error(result.error);out.textContent=result.error.message||'Unable to create listing.';return}
  localStorage.setItem('web3market_project_id',String(result.data.id));
  out.innerHTML=`Draft created successfully. <a href="project.html?id=${encodeURIComponent(result.data.id)}">Open project</a>`;
 });
})();
