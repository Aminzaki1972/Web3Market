"use strict";
(async function(){
 const root=document.querySelector('#checkoutApp');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 const dealId=new URLSearchParams(location.search).get('deal');
 if(!root||!sb||!dealId){if(root)root.innerHTML='<div class="status">Deal information is unavailable.</div>';return;}
 const {data:{user},error:authError}=await sb.auth.getUser();
 if(authError||!user){root.innerHTML='<div class="status">Please sign in.</div>';return;}
 const {data:deal,error}=await sb.from('deals').select('id,project_id,buyer_id,seller_id,amount,currency,status,platform_fee_percent,platform_fee,seller_net_amount,fee_locked_at').eq('id',dealId).maybeSingle();
 if(error||!deal){root.innerHTML='<div class="status">Deal not found.</div>';return;}
 if(deal.buyer_id!==user.id&&deal.seller_id!==user.id){root.innerHTML='<div class="status">You are not a participant in this deal.</div>';return;}
 const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
 const amount=Number(deal.amount||0);
 const fee=Number(deal.platform_fee ?? amount*0.075);
 const net=Number(deal.seller_net_amount ?? (amount-fee));
 const currency=esc(deal.currency||'USDT');
 const pct=Number(deal.platform_fee_percent||7.5);
 root.innerHTML=`<h2>Deal Checkout</h2>
 <div class="card">
  <p>Deal amount: <strong>${amount.toLocaleString()} ${currency}</strong></p>
  <p>Web3Market fee: <strong>${fee.toLocaleString()} ${currency}</strong> (${pct.toFixed(2)}%)</p>
  <p>Seller net amount: <strong>${net.toLocaleString()} ${currency}</strong></p>
  <p>Status: <strong>${esc(deal.status)}</strong></p>
  <p class="status">The 7.5% Web3Market fee is locked into this deal record. This page does not custody or move funds.</p>
  <a class="btn" href="deal-room.html?deal=${encodeURIComponent(deal.id)}">Open Deal Room</a>
 </div>`;
})();
