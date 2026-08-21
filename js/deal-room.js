"use strict";
(async function(){
 const root=document.querySelector('#dealApp');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 const dealId=new URLSearchParams(location.search).get('deal');
 if(!root||!sb||!dealId){if(root)root.innerHTML='<div class="status">Deal information is unavailable.</div>';return;}
 const {data:{user},error:ue}=await sb.auth.getUser();if(ue||!user){root.innerHTML='<div class="status">Please sign in.</div>';return;}
 const {data:deal,error}=await sb.from('deals').select('*').eq('id',dealId).maybeSingle();
 if(error||!deal){root.innerHTML='<div class="status">Deal not found.</div>';return;}
 if(deal.buyer_id!==user.id&&deal.seller_id!==user.id){root.innerHTML='<div class="status">You are not a participant in this deal.</div>';return;}
 const {data:events}=await sb.from('deal_messages').select('message,created_at,sender_id').eq('deal_id',deal.id).order('created_at',{ascending:false});
 root.innerHTML=`<h2>Deal status: <strong>${deal.status}</strong></h2><p>Amount: <strong>${Number(deal.amount).toLocaleString()} ${deal.currency||'USD'}</strong></p><p>This workspace tracks the acquisition lifecycle. Funding, custody and asset transfer require a separately audited escrow integration.</p><h3>Messages</h3>${(events||[]).map(e=>`<p>${String(e.message||'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]))}<br><small>${new Date(e.created_at).toLocaleString()}</small></p>`).join('')||'<p>No messages yet.</p>'}`;
})();
