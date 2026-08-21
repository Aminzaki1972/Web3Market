"use strict";
(function(){
 const form=document.querySelector('#projectForm'),out=document.querySelector('#formStatus');
 const sb=()=>window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 function val(fd,n){const v=fd.get(n);return v===null?'':String(v).trim()}
 form.addEventListener('submit',async e=>{
  e.preventDefault();out.textContent='Checking your account…';const client=sb();if(!client){out.textContent='Database connection unavailable.';return}
  const {data:{user},error:ue}=await client.auth.getUser();if(ue||!user){out.textContent='Please sign in before listing a project.';return}
  const fd=new FormData(form),title=val(fd,'title');if(!title){out.textContent='Project name is required.';return}
  const description=val(fd,'description'),short=val(fd,'short_description');
  const payload={owner_id:user.id,title,description:(short?short+'\n\n':'')+description,category:val(fd,'category')||null,price:Number(val(fd,'asking_price'))||null,currency:'USD',status:'draft'};
  out.textContent='Creating draft…';
  const {data,error}=await client.from('projects').insert(payload).select('id').single();
  if(error){console.error(error);out.textContent=error.message||'Unable to create listing.';return}
  out.innerHTML=`Draft created successfully. <a href="project.html?id=${encodeURIComponent(data.id)}">Open project</a>`;form.reset();
 });
})();
