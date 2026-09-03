"use strict";
(function(){
 const page=document.querySelector('#page');
 const sb=()=>window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
 const money=(v,c)=>v==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD',maximumFractionDigits:0}).format(Number(v));
 async function load(){
  const id=new URLSearchParams(location.search).get('id'); if(!id){page.textContent='Project not specified.';return}
  const client=sb(); if(!client){page.textContent='Database connection unavailable.';return}
  const {data:p,error}=await client.from('projects').select('*').eq('id',id).maybeSingle();
  if(error||!p){page.textContent='Project not found or unavailable.';return}
  document.title=`${p.title} | Web3Market`;
  page.className='';
  page.innerHTML=`<section class="hero-copy" style="max-width:1000px;margin:auto"><span class="eyebrow">${esc(p.category||'Web3 Project')} · ${esc(p.status)}</span><h1>${esc(p.title)}</h1><p>${esc(p.description||'No description provided.')}</p><div class="hero-actions"><strong style="font-size:28px">${money(p.price,p.currency)}</strong> <a class="btn btn-ghost" href="ai-due-diligence.html?id=${encodeURIComponent(p.id)}">AI Due-Diligence</a></div><div class="grid" style="margin-top:30px"><div class="card"><h2>Project overview</h2><p class="desc" style="white-space:pre-wrap">${esc(p.description||'')}</p></div><div class="card"><h2>Make an offer</h2><p class="desc">Submit an offer. Funds are not collected by this form.</p><form id="offerForm"><label>Offer amount<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Message<textarea name="message" maxlength="5000" placeholder="Introduce yourself and your terms"></textarea></label><button class="btn btn-primary" type="submit">Send offer</button><div id="offerStatus" class="status"></div></form></div></div></section>`;
  document.querySelector('#offerForm').addEventListener('submit',e=>offer(e,p));
 }
 async function offer(e,p){
  e.preventDefault(); const out=document.querySelector('#offerStatus'),fd=new FormData(e.currentTarget),client=sb();
  const {data:{user},error:ue}=await client.auth.getUser(); if(ue||!user){out.textContent='Please sign in before making an offer.';return}
  if(p.owner_id===user.id){out.textContent='You cannot make an offer on your own project.';return}
  const amount=Number(fd.get('amount')); if(!Number.isFinite(amount)||amount<=0){out.textContent='Enter a valid amount.';return}
  const {data:deal,error}=await client.from('deals').insert({project_id:p.id,buyer_id:user.id,seller_id:p.owner_id,amount,currency:p.currency||'USD',status:'pending'}).select('id').single();
  if(error){console.error(error);out.textContent=error.message||'Unable to submit offer.';return}
  const message=String(fd.get('message')||'').trim(); if(message){const {error:me}=await client.from('deal_messages').insert({deal_id:deal.id,sender_id:user.id,message});if(me)console.warn('Offer message was not saved:',me)}
  out.textContent='Offer submitted successfully.'; e.currentTarget.reset();
 }
 load();
})();
