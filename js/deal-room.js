"use strict";
(async function(){
 const root=document.querySelector('#dealApp');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 if(!root)return;
 if(!sb){root.innerHTML='<div class="status">Database connection unavailable.</div>';return;}
 const {data:{user},error:ue}=await sb.auth.getUser();
 if(ue||!user){root.innerHTML='<div class="status">Please sign in.</div>';return;}
 const dealId=new URLSearchParams(location.search).get('deal');
 let deal=null,error=null;
 if(dealId)({data:deal,error}=await sb.from('deals').select('*').eq('id',dealId).maybeSingle());
 if(!deal){const r=await sb.from('deals').select('*').eq('buyer_id',user.id).in('status',['accepted','funded','in_progress','pending','disputed']).order('created_at',{ascending:false}).limit(1).maybeSingle();deal=r.data||null;error=r.error||error;}
 if(error||!deal){root.innerHTML='<div class="status">Deal information is unavailable.</div>';return;}
 if(String(deal.buyer_id)!==String(user.id)&&String(deal.seller_id)!==String(user.id)){root.innerHTML='<div class="status">You are not a participant in this deal.</div>';return;}
 const [{data:events},{data:assets}]=await Promise.all([
  sb.from('deal_messages').select('message,created_at,sender_id').eq('deal_id',deal.id).order('created_at',{ascending:true}),
  sb.from('deal_assets').select('*').eq('deal_id',deal.id).order('created_at',{ascending:true})
 ]);
 const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
 const amount=Number(deal.amount||0),fee=Number(deal.platform_fee||0),net=Number(deal.seller_net_amount||amount-fee),pct=Number(deal.platform_fee_percent||7.5),currency=esc(deal.currency||'USDT');
 const status=String(deal.status||'pending').replace(/[_-]+/g,' ');
 const assetRows=(assets||[]).map(a=>`<div class="card"><strong>${esc(a.asset_name)}</strong><span class="status">${esc(a.status)}</span>${a.delivery_url?`<p><a href="${esc(a.delivery_url)}" target="_blank" rel="noopener">View delivery</a></p>`:''}${a.evidence?`<p>${esc(a.evidence)}</p>`:''}</div>`).join('')||'<p>No delivery items have been added yet.</p>';
 root.innerHTML=`<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><div><h2>Deal status: <strong>${esc(status)}</strong></h2><p>Deal ID: <small>${esc(deal.id)}</small></p></div><span class="status">${esc(status)}</span></div>
 <p>Deal amount: <strong>${amount.toLocaleString()} ${currency}</strong></p><p>Web3Market fee: <strong>${fee.toLocaleString()} ${currency}</strong> (${pct.toFixed(2)}%)</p><p>Seller net: <strong>${net.toLocaleString()} ${currency}</strong></p>
 <p class="status">This room records the deal lifecycle. Payment status must be verified from the blockchain before it is treated as confirmed.</p>
 <h3>Delivery checklist</h3>${assetRows}
 <div style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0">${deal.buyer_id===user.id&&['funded','in_progress'].includes(deal.status)?'<button id="confirmDelivery" class="btn">Confirm Delivery</button>':''}${['pending','funded','in_progress','accepted'].includes(deal.status)?'<button id="openDispute" class="btn">Open Dispute</button>':''}</div>
 <h3>Messages</h3>${(events||[]).map(e=>`<p>${esc(e.message||'')}<br><small>${e.created_at?new Date(e.created_at).toLocaleString():''}</small></p>`).join('')||'<p>No messages yet.</p>'}`;
 const confirm=document.querySelector('#confirmDelivery');
 if(confirm)confirm.onclick=async()=>{if(!confirm('Confirm that all listed project assets have been received?'))return;confirm.disabled=true;const {error}=await sb.rpc('confirm_deal_delivery',{p_deal_id:deal.id});if(error){alert(error.message);confirm.disabled=false;return;}location.reload();};
 const dispute=document.querySelector('#openDispute');
 if(dispute)dispute.onclick=async()=>{const reason=prompt('Describe the problem with this deal.');if(!reason)return;dispute.disabled=true;const {error}=await sb.rpc('open_deal_dispute',{p_deal_id:deal.id,p_reason:reason});if(error){alert(error.message);dispute.disabled=false;return;}location.reload();};
})();
