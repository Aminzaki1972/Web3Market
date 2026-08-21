"use strict";
(async function(){
 const root=document.querySelector('#checkoutApp');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 const dealId=new URLSearchParams(location.search).get('deal');
 if(!root||!sb||!dealId){if(root)root.innerHTML='<div class="status">Deal information is unavailable.</div>';return;}
 const {data:{user},error:authError}=await sb.auth.getUser();
 if(authError||!user){root.innerHTML='<div class="status">Please sign in.</div>';return;}
 const {data:deal,error}=await sb.from('deals').select('id,project_id,buyer_id,seller_id,amount,currency,status').eq('id',dealId).maybeSingle();
 if(error||!deal){root.innerHTML='<div class="status">Deal not found.</div>';return;}
 if(deal.buyer_id!==user.id&&deal.seller_id!==user.id){root.innerHTML='<div class="status">You are not a participant in this deal.</div>';return;}
 const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
 root.innerHTML=`<h2>Deal Checkout</h2><p>Amount: <strong>${Number(deal.amount).toLocaleString()} ${esc(deal.currency||'USD')}</strong></p><p>Status: <strong>${esc(deal.status)}</strong></p><p>This screen prepares the protected deal workflow. No funds are moved by this page.</p><a class="btn" href="deal-room.html?deal=${encodeURIComponent(deal.id)}">Open Deal Room</a>`;
})();
