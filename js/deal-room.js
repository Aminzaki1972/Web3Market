"use strict";
(async function(){
 const root=document.querySelector('#dealApp')||document.querySelector('.room'); if(!root)return;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms)); let sb=null;
 for(let i=0;i<40;i++){sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase||null;if(sb)break;await sleep(100)}
 if(!sb&&window.supabase?.createClient){try{sb=window.supabase.createClient('https://hzhqlexnhtukfljcvnyd.supabase.co','sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'web3market-auth'}});window.supabaseClient=sb}catch(e){console.error(e)}}
 if(!sb){root.innerHTML='<div class="status">Database connection unavailable. Please refresh the page.</div>';return}
 const {data:{user},error:ue}=await sb.auth.getUser(); if(ue||!user){location.replace('login.html?next='+encodeURIComponent(location.pathname+location.search));return}
 const params=new URLSearchParams(location.search),dealId=params.get('deal')||params.get('id'); if(!dealId){root.innerHTML='<div class="status">Deal not specified.</div>';return}
 const {data:deal,error}=await sb.from('deals').select('*').eq('id',dealId).maybeSingle();
 if(error||!deal){console.error(error);root.innerHTML='<div class="status">Deal information is unavailable.</div>';return}
 const participant=String(deal.buyer_id)===String(user.id)?'buyer':String(deal.seller_id)===String(user.id)?'seller':null;
 if(!participant){root.innerHTML='<div class="status">You are not a participant in this deal.</div>';return}
 const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
 const money=v=>Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})+' '+(deal.currency||'USDT');
 document.querySelector('#dealMeta').textContent=`Deal ${deal.id} · ${money(deal.amount)}`; document.querySelector('#dealStatus').textContent=String(deal.status||'pending').replace(/[_-]+/g,' ');
 const details=document.querySelector('#details'); if(details)details.innerHTML=`<p>Amount: <strong>${esc(money(deal.amount))}</strong></p><p>Multisig: <strong>${esc(deal.multisig_mode||'2-of-3')}</strong></p><p>Signers: Buyer · Seller · Web3Market</p><p>Payment: <strong>${esc(deal.payment_status||'pending')}</strong></p><p>Role: <strong>${participant}</strong></p><p>Platform fee: <strong>${esc(money(deal.platform_fee_amount??deal.platform_fee))}</strong></p>`;
 async function loadAgreement(){const {data,error}=await sb.from('deal_party_agreements').select('party_role,party_id,agreed_at').eq('deal_id',deal.id);if(error){console.error('agreement',error);return null}return data||[]}
 async function loadMessages(){const {data,error}=await sb.from('deal_messages').select('message,created_at,sender_id').eq('deal_id',deal.id).order('created_at',{ascending:true});if(error){console.error(error);return}const box=document.querySelector('#messages');if(!box)return;box.innerHTML=(data||[]).map(m=>`<div class="msg ${String(m.sender_id)===String(user.id)?'mine':''}">${esc(m.message)}<small>${new Date(m.created_at).toLocaleString()}</small></div>`).join('')||'<div class="info">No messages yet.</div>';box.scrollTop=box.scrollHeight}
 async function renderSafeStatus(){
  const box=document.querySelector('#safeStatus'); if(!box)return;
  const safe=String(deal.safe_address||'').trim(),chain=Number(deal.chain_id||0);
  if(!/^0x[a-fA-F0-9]{40}$/.test(safe)){box.innerHTML='<div class="notice warn"><strong>Safe not configured for this deal.</strong><br>No funds should be released until a verified Safe address is attached.</div>';return}
  if(chain!==56){box.innerHTML=`<div class="notice warn"><strong>Safe chain mismatch.</strong><br>This release flow is configured for BNB Smart Chain (56), but this deal uses ${esc(chain||'unknown')}.</div>`;return}
  let owners=[],threshold=null,nonce=null,code='';
  try{
   if(!window.ethers?.JsonRpcProvider){box.innerHTML='<div class="notice warn">Safe verification library is unavailable. Refresh the page.</div>';return}
   const provider=new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org');
   const abi=['function getOwners() view returns (address[])','function getThreshold() view returns (uint256)','function nonce() view returns (uint256)'];
   const c=new ethers.Contract(safe,abi,provider);
   [owners,threshold,nonce]=await Promise.all([c.getOwners(),c.getThreshold(),c.nonce()]);
   code=await provider.getCode(safe);
  }catch(e){console.error('safe verification',e);box.innerHTML='<div class="notice warn"><strong>Safe could not be verified.</strong><br>We will not mark this deal as Safe-ready until the address responds correctly on BNB Smart Chain.</div>';return}
  const isContract=code&&code!=='0x',is23=owners.length===3&&Number(threshold)===2;
  const safeUrl='https://app.safe.global/transactions/queue?safe=bnb:'+encodeURIComponent(safe);
  const fee=Number(deal.platform_fee_amount ?? deal.platform_fee ?? 0);
  const sellerNet=Number(deal.seller_net_amount ?? (Number(deal.amount||0)-fee));
  box.innerHTML=`<div class="safe-panel ${is23&&isContract?'ok':'warn'}"><strong>Safe 2-of-3 verification</strong><br><span>${isContract?'Contract detected':'Address is not a contract'} · ${owners.length} owner(s) · threshold ${threshold??'?'}</span><br><span>Safe nonce: ${esc(nonce??'—')}</span>${is23&&isContract?`<hr><div class="safe-release"><strong>Release target:</strong> Seller<br><strong>Seller net:</strong> ${esc(money(sellerNet))}<br><strong>Platform fee:</strong> ${esc(money(fee))}</div><a class="btn primary" href="${safeUrl}" target="_blank" rel="noopener noreferrer">Open Safe Queue</a><div class="safe-note">The Safe transaction must be created and approved by the required Safe owners. Web3Market cannot release funds alone.</div>`:'<div class="safe-note">Expected configuration is exactly 3 owners with a 2-signature threshold. No release action is enabled here when that condition is not verified.</div>'}</div>`;
 }
 async function renderTerms(){const rows=await loadAgreement(),mine=rows.find(x=>x.party_role===participant&&String(x.party_id)===String(user.id)),buyer=rows.find(x=>x.party_role==='buyer')?.agreed_at,seller=rows.find(x=>x.party_role==='seller')?.agreed_at,actions=document.querySelector('#actions');if(!actions)return;actions.innerHTML=`<div class="notice"><strong>Dispute Resolution — Model B</strong><br>Buyer and Seller agree that Web3Market acts as the dispute resolution party. Funds are held by the 2-of-3 multisig, not by Web3Market. ${buyer?'Buyer ✓':'Buyer pending'} · ${seller?'Seller ✓':'Seller pending'}</div><button id="agreeBtn" class="btn primary" ${mine?.agreed_at?'disabled':''}>${mine?.agreed_at?'✓ Agreement Accepted':'I Agree to Deal Terms'}</button><button id="disputeBtn" class="btn" style="background:#fff7ed;color:#9a3412">Open Dispute</button>`;
 const agreeBtn=document.querySelector('#agreeBtn');if(agreeBtn&&!mine?.agreed_at)agreeBtn.onclick=async()=>{agreeBtn.disabled=true;let {data:row}=await sb.from('deal_party_agreements').select('id').eq('deal_id',deal.id).eq('party_role',participant).eq('party_id',user.id).maybeSingle();let error;if(row){({error}=await sb.from('deal_party_agreements').update({agreed_at:new Date().toISOString()}).eq('id',row.id))}else{({error}=await sb.from('deal_party_agreements').insert({deal_id:deal.id,party_role:participant,party_id:user.id,agreed_at:new Date().toISOString()}))}if(error){alert(error.message||'Could not save agreement');agreeBtn.disabled=false;return}await renderTerms()};
 const db=document.querySelector('#disputeBtn');if(db)db.onclick=async()=>{const reason=prompt('Describe the dispute');if(!reason)return;const {error}=await sb.from('deal_disputes').insert({deal_id:deal.id,opened_by:user.id,reason,status:'open'});if(error)alert(error.message||'Could not open dispute');else alert('Dispute opened for Web3Market review.')};}
 await loadMessages();await renderTerms();await renderSafeStatus();
 const form=document.querySelector('#chatForm');if(form)form.addEventListener('submit',async e=>{e.preventDefault();const input=document.querySelector('#messageInput'),message=input?.value.trim();if(!message)return;const btn=form.querySelector('button');btn.disabled=true;const {error}=await sb.from('deal_messages').insert({deal_id:deal.id,sender_id:user.id,message});btn.disabled=false;if(error){alert(error.message||'Unable to send message.');return}input.value='';await loadMessages()});
 const channel=sb.channel('deal-messages-'+deal.id).on('postgres_changes',{event:'INSERT',schema:'public',table:'deal_messages',filter:'deal_id=eq.'+deal.id},loadMessages).subscribe();window.addEventListener('beforeunload',()=>sb.removeChannel(channel));
})();
