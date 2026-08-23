"use strict";
(async function(){
 const root=document.querySelector('#dealApp');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 if(!root){return;}
 if(!sb){root.innerHTML='<div class="status">Database connection unavailable.</div>';return;}
 const {data:{user},error:ue}=await sb.auth.getUser();
 if(ue||!user){root.innerHTML='<div class="status">Please sign in.</div>';return;}
 let dealId=new URLSearchParams(location.search).get('deal');
 let deal=null, error=null;
 if(dealId){({data:deal,error}=await sb.from('deals').select('*').eq('id',dealId).maybeSingle());}
 // Fallback: if the page was opened from an old dashboard link without ?deal=ID,
 // locate the buyer's most recent accepted/active deal automatically.
 if(!deal){
   const r=await sb.from('deals').select('*').eq('buyer_id',user.id).in('status',['accepted','active','in_progress','pending']).order('created_at',{ascending:false}).limit(1).maybeSingle();
   deal=r.data||null; error=r.error||error; dealId=deal?.id||null;
 }
 if(error||!deal){root.innerHTML='<div class="status">Deal information is unavailable.</div>';return;}
 if(String(deal.buyer_id)!==String(user.id)&&String(deal.seller_id)!==String(user.id)){root.innerHTML='<div class="status">You are not a participant in this deal.</div>';return;}
 const {data:events}=await sb.from('deal_messages').select('message,created_at,sender_id').eq('deal_id',deal.id).order('created_at',{ascending:false});
 const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
 const status=String(deal.status||'pending').replace(/[_-]+/g,' ');
 root.innerHTML=`<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><div><h2>Deal status: <strong>${esc(status)}</strong></h2><p>Deal ID: <small>${esc(deal.id)}</small></p></div><span class="status">${esc(status)}</span></div><p>Amount: <strong>${Number(deal.amount||0).toLocaleString()} ${esc(deal.currency||'USD')}</strong></p><p>This workspace tracks the acquisition lifecycle. Funding, custody and asset transfer require a separately audited escrow integration.</p><h3>Messages</h3>${(events||[]).map(e=>`<p>${esc(e.message||'')}<br><small>${e.created_at?new Date(e.created_at).toLocaleString():''}</small></p>`).join('')||'<p>No messages yet.</p>'}`;
})();