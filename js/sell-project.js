"use strict";
(function(){
 const form=document.querySelector('#projectForm'),out=document.querySelector('#formStatus');
 if(!form)return;
 const sb=()=>window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 const val=(fd,n)=>{const v=fd.get(n);return v===null?'':String(v).trim()};
 const num=(fd,n)=>{const v=val(fd,n);return v===''?null:Number(v)};
 form.addEventListener('submit',async e=>{
  e.preventDefault();
  const client=sb(); if(!client){out.textContent='Database connection unavailable.';return}
  out.textContent='Checking your seller account…';
  const {data:{user},error:ue}=await client.auth.getUser();
  if(ue||!user){out.textContent='Please sign in before listing a project.';return}
  const {data:profile,error:pe}=await client.from('profiles').select('role').eq('id',user.id).maybeSingle();
  if(pe){console.error(pe);out.textContent='Unable to verify your account role.';return}
  if(String(profile?.role||user.user_metadata?.role||'').toLowerCase()!=='seller'){
   out.textContent='This page is for Seller accounts. Please sign in with a Seller account.';return;
  }
  const fd=new FormData(form),title=val(fd,'title'),short=val(fd,'short_description'),description=val(fd,'description');
  if(!title||short.length<20||description.length<50){out.textContent='Please complete the required project information.';return}
  // Save only the core fields known to be supported by the projects table.
  // The remaining wizard fields stay in the form for Preview/AI Review and are not
  // sent as individual columns, preventing schema-cache failures.
  const payload={owner_id:user.id,title,description:(short+'\n\n'+description).trim(),price:num(fd,'asking_price'),currency:val(fd,'currency')||'USD',status:'draft'};
  out.textContent='Saving draft…';
  let result=await client.from('projects').insert(payload).select('id').single();
  if(result.error){
   console.error(result.error);
   out.textContent=result.error.message||'Unable to create listing.';
   return;
  }
  localStorage.setItem('web3market_project_id',String(result.data.id));
  out.innerHTML=`Draft created successfully. <a href="project.html?id=${encodeURIComponent(result.data.id)}">Open project</a>`;
 });
})();
