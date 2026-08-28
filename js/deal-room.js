"use strict";
(async function(){
 const root=document.querySelector('#dealApp')||document.querySelector('.room');
 if(!root)return;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 let sb=null;
 for(let i=0;i<40;i++){
  sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase||null;
  if(sb)break;
  await sleep(100);
 }
 // Defensive fallback: initialize the same Supabase project used by Web3Market
 // if the shared supabase.js boot did not expose its client in time.
 if(!sb && window.supabase?.createClient){
  try{
   sb=window.supabase.createClient(
    'https://hzhqlexnhtukfljcvnyd.supabase.co',
    'sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI',
    {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'web3market-auth'}}
   );
   window.supabaseClient=sb;
  }catch(e){console.error('Deal Room Supabase init:',e)}
 }
 if(!sb){root.innerHTML='<div class="status">Database connection unavailable. Please refresh the page.</div>';return;}
 const {data:{user},error:ue}=await sb.auth.getUser();
 if(ue||!user){location.replace('login.html?next='+encodeURIComponent(location.pathname+location.search));return;}
 const params=new URLSearchParams(location.search),dealId=params.get('deal')||params.get('id');
 if(!dealId){root.innerHTML='<div class="status">Deal not specified.</div>';return;}
 const {data:deal,error}=await sb.from('deals').select('*').eq('id',dealId).maybeSingle();
 if(error||!deal){console.error('Deal load error:',error);root.innerHTML='<div class="status">Deal information is unavailable.</div>';return;}
 if(String(deal.buyer_id)!==String(user.id)&&String(deal.seller_id)!==String(user.id)){root.innerHTML='<div class="status">You are not a participant in this deal.</div>';return;}
 const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
 const money=(v,c)=>Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})+' '+(c||'USDT');
 async function loadMessages(){
  const {data,error}=await sb.from('deal_messages').select('message,created_at,sender_id').eq('deal_id',deal.id).order('created_at',{ascending:true});
  if(error){console.error('Messages load error:',error);return;}
  const box=document.querySelector('#messages');if(!box)return;
  box.innerHTML=(data||[]).map(m=>`<div class="msg ${String(m.sender_id)===String(user.id)?'mine':''}">${esc(m.message)}<small>${new Date(m.created_at).toLocaleString()}</small></div>`).join('')||'<div class="info">No messages yet.</div>';
  box.scrollTop=box.scrollHeight;
 }
 const status=String(deal.status||'pending').replace(/[_-]+/g,' ');
 const amount=money(deal.amount,deal.currency),fee=money(deal.platform_fee_amount ?? deal.platform_fee,deal.currency),net=money(deal.seller_net_amount ?? (Number(deal.amount||0)-Number(deal.platform_fee_amount||deal.platform_fee||0)),deal.currency);
 document.querySelector('#dealMeta').textContent=`Deal ${deal.id} · ${amount}`;
 document.querySelector('#dealStatus').textContent=status;
 document.querySelector('#details').innerHTML=`<p>Amount: <strong>${esc(amount)}</strong></p><p>Platform fee: <strong>${esc(fee)}</strong></p><p>Seller net: <strong>${esc(net)}</strong></p><p>Buyer: <code>${esc(deal.buyer_id)}</code></p><p>Seller: <code>${esc(deal.seller_id)}</code></p><p>Payment: <strong>${esc(deal.payment_status||'pending')}</strong></p>`;
 await loadMessages();
 const form=document.querySelector('#chatForm');
 if(form)form.addEventListener('submit',async e=>{e.preventDefault();const input=document.querySelector('#messageInput'),message=input?.value.trim();if(!message)return;const btn=form.querySelector('button');btn.disabled=true;const {error}=await sb.from('deal_messages').insert({deal_id:deal.id,sender_id:user.id,message});btn.disabled=false;if(error){alert(error.message||'Unable to send message.');return;}input.value='';await loadMessages();});
 const channel=sb.channel('deal-messages-'+deal.id).on('postgres_changes',{event:'INSERT',schema:'public',table:'deal_messages',filter:'deal_id=eq.'+deal.id},()=>loadMessages()).subscribe();
 window.addEventListener('beforeunload',()=>sb.removeChannel(channel));
})();
