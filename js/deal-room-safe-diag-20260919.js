"use strict";
(async function(){
 const root=document.querySelector('#dealApp')||document.querySelector('.room');
 if(!root)return;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 let sb=null,lastInitError='';
 // Use the shared client first, but also initialize directly as a fallback.
 // This prevents the Deal Room from failing when supabase.js loads before the CDN client is ready.
 for(let i=0;i<80;i++){
  sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase||null;
  if(!sb&&window.supabase&&typeof window.supabase.createClient==='function'){
   try{
    sb=window.supabase.createClient('https://hzhqlexnhtukfljcvnyd.supabase.co','sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'web3market-auth'}});
    window.Web3MarketSupabase=window.Web3MarketSupabase||{};
    window.Web3MarketSupabase.client=sb;
    window.Web3MarketSupabase.supabase=sb;
    window.Web3MarketSupabase.getClient=()=>sb;
    window.supabaseClient=sb;
    window.web3marketSupabase=sb;
   }catch(e){lastInitError=e?.message||String(e)}
  }
  if(sb)break;
  await sleep(100);
 }
 if(!sb){
  root.innerHTML='<div class="status">Database connection unavailable. Please refresh the page.<br><small style="font-weight:400">The Supabase client could not be initialized'+(lastInitError?': '+String(lastInitError).replace(/[<>]/g,''):'')+'.</small></div>';
  console.error('Deal Room Supabase client unavailable',lastInitError);
  return;
 }
 const {data:{user},error:ue}=await sb.auth.getUser();
 if(ue||!user){location.replace('login.html?next='+encodeURIComponent(location.pathname+location.search));return}
 let profile=null;
 let canonicalWalletAddress='';
 let canonicalWalletVerified=false;
 const loadCanonicalWallet=async()=>{
  const {data,error}=await sb.from('profiles').select('role,wallet_address,wallet_verified,wallet_verified_at').eq('id',user.id).maybeSingle();
  if(error) throw error;
  profile=data||null;
  canonicalWalletAddress=String(profile?.wallet_address||'').trim();
  canonicalWalletVerified=profile?.wallet_verified===true && /^0x[a-fA-F0-9]{40}$/.test(canonicalWalletAddress);
  return profile;
 };
 try{await loadCanonicalWallet()}catch(e){console.error('canonical wallet profile load',e)}
 const isAdmin=String(profile?.role||'').toLowerCase()==='admin';
 const params=new URLSearchParams(location.search),dealId=params.get('deal')||params.get('id');
 if(!dealId){root.innerHTML='<div class="status">Deal not specified.</div>';return}
 const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
 let deal=null,participant=null,channel=null,disposed=false,safeDeploymentError='',safeDeploymentBusy=false,safeDeploymentLog=[];

 const setStatus=(text,kind='')=>{const el=document.querySelector('#dealStatus');if(el){el.textContent=text;el.className='status'+(kind?' '+kind:'')}};
 const safeLogBox=()=>document.querySelector('#safeStatus');
 const addSafeLog=(message)=>{safeDeploymentLog.push(new Date().toLocaleTimeString()+' — '+String(message));const box=safeLogBox();if(box){box.innerHTML='<div class="safe-panel warn"><strong>Safe deployment diagnostic</strong><hr><pre style="white-space:pre-wrap;margin:0;font:inherit">'+esc(safeDeploymentLog.join('\n'))+'</pre><small>No payment is enabled and no USDT was moved.</small></div>'}};
 const loadDeal=async()=>{
  const {data,error}=await sb.from('deals').select('*').eq('id',dealId).maybeSingle();
  if(error||!data){console.error('deal load',error);return false}
  const nextParticipant=String(data.buyer_id)===String(user.id)?'buyer':String(data.seller_id)===String(user.id)?'seller':isAdmin?'platform':null;
  if(!nextParticipant){setStatus('You are not a participant in this deal.','warn');return false}
  deal=data;participant=nextParticipant;
  const money=v=>Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})+' '+(deal.currency||'USD');
  const meta=document.querySelector('#dealMeta');if(meta)meta.textContent=`Deal ${deal.id} · ${money(deal.amount)}`;
  setStatus(String(deal.status||'pending').replace(/[_-]+/g,' '));
  const paid=Boolean(deal.payment_tx_hash)||String(deal.payment_status||'').toLowerCase()==='confirmed'||String(deal.status||'').toLowerCase()==='payment_confirmed';
  const details=document.querySelector('#details');
  if(details)details.innerHTML=`<p>Amount: <strong>${esc(money(deal.amount))}</strong></p><p>Platform fee: <strong>${esc(money(deal.platform_fee_amount??deal.platform_fee??0))}</strong> (${Number(deal.platform_fee_percent??7.5).toFixed(2)}%)</p><p>Seller net: <strong>${esc(money(deal.seller_net_amount??Number(deal.amount||0)-Number(deal.platform_fee_amount??deal.platform_fee??0)))}</strong></p><p>Payment: <strong>${paid?'Verified on-chain':'Pending'}</strong></p><p>Role: <strong>${participant}</strong></p>${deal.payment_tx_hash?`<p>TX: <code>${esc(deal.payment_tx_hash)}</code></p>`:''}`;
  return true;
 };

 if(!await loadDeal()){if(!deal){root.innerHTML='<div class="status">Deal information is unavailable.</div>';return}}
 function renderDealWalletState(){
  const status=document.querySelector('#dealWalletStatus'),btn=document.querySelector('#dealConnectWallet');
  if(!status||!btn)return;
  if(canonicalWalletVerified){
   status.innerHTML='Connected & verified ✓ <code>'+esc(canonicalWalletAddress)+'</code><br><small>Using your verified Web3Market profile wallet.</small>';
   btn.textContent='Wallet Verified ✓'; btn.disabled=true; return;
  }
  status.textContent='Not verified. Connect and verify your wallet from your Web3Market profile.';
  btn.textContent='Connect & Verify Wallet'; btn.disabled=false;
 }
 async function connectDealWallet(){
  try{await loadCanonicalWallet();}catch(e){console.error('wallet state refresh',e)}
  if(canonicalWalletVerified){renderDealWalletState();return;}
  const wm=window.Web3MarketWalletManager;
  const btn=document.querySelector('#dealConnectWallet'),status=document.querySelector('#dealWalletStatus'),notice=document.querySelector('#dealWalletNotice');
  if(!wm){if(notice)notice.textContent='Wallet connection engine unavailable. Please refresh the page.';return}
  let modal=document.querySelector('#dealWalletModal');
  if(!modal){
   modal=document.createElement('div');
   modal.id='dealWalletModal';
   modal.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.65);display:flex;align-items:center;justify-content:center;padding:20px;z-index:9999';
   modal.innerHTML='<div style="background:#fff;border-radius:16px;max-width:420px;width:100%;padding:18px"><div style="display:flex;justify-content:space-between;align-items:center"><strong>Connect Web3 Wallet</strong><button id="dealWalletClose" type="button" class="btn">×</button></div><div id="dealWalletList" style="display:grid;gap:8px;margin-top:14px"></div><div id="dealWalletModalNotice" class="info" style="margin-top:10px">Choose your wallet. Ownership verification uses a free signature only.</div></div>';
   document.body.appendChild(modal);
   modal.addEventListener('click',e=>{if(e.target===modal)modal.remove()});
   modal.querySelector('#dealWalletClose').onclick=()=>modal.remove();
  }
  const list=modal.querySelector('#dealWalletList'),mn=modal.querySelector('#dealWalletModalNotice');
  list.innerHTML='';
  wm.listWallets().forEach(row=>{
   const b=document.createElement('button');b.type='button';b.className='btn';b.style.cssText='width:100%;background:#f8fafc;color:#111827;border:1px solid #dbe4ef;text-align:left';
   b.innerHTML='<strong>'+wm.esc(row.name)+'</strong><br><small>'+ (row.detected?'Detected on this device':'Open wallet app / browser')+'</small>';
   b.onclick=async()=>{
    try{
     if(row.provider){
      modal.remove();
      if(btn){btn.disabled=true;btn.textContent='Connecting…'}
      const result=await wm.connectAndVerify(row.provider,row.name,{role:participant,purpose:'deal_room_wallet_ownership',setNotice:v=>{if(notice)notice.textContent=v}});
      if(status)status.innerHTML='Connected & verified ✓ <code>'+wm.esc(result.address)+'</code>';
      if(btn){btn.textContent='Wallet Verified ✓';btn.disabled=false}
     }else{
      mn.textContent='Opening '+row.name+'…';
      wm.launch(row.name,mn);
     }
    }catch(e){
     console.warn('Deal Room wallet verification failed',e);
     if(notice)notice.textContent=e?.message||'Wallet verification failed.';
     if(btn){btn.disabled=false;btn.textContent='Connect & Verify Wallet'}
     modal.remove();
    }
   };
   list.appendChild(b);
  });
  modal.hidden=false;
 }
 await loadCanonicalWallet().catch(e=>console.error('wallet state refresh before render',e));
 const dealWalletBtn=document.querySelector('#dealConnectWallet');
 if(dealWalletBtn)dealWalletBtn.addEventListener('click',connectDealWallet);
 const createSafeBtn=document.querySelector('#createSafeBtn');
 if(createSafeBtn)createSafeBtn.addEventListener('click',async()=>{safeDeploymentError='';safeDeploymentLog=[];await ensureSafeDeployment(true);if(deal?.safe_address)await renderSafe()});

 async function loadAgreement(){
  const {data,error}=await sb.from('deal_party_agreements').select('party_role,party_id,agreed_at').eq('deal_id',deal.id);
  if(error){console.error('agreement',error);return []}return data||[];
 }
 async function loadMessages(){
  if(!deal)return;
  const {data,error}=await sb.from('deal_messages').select('message,created_at,sender_id').eq('deal_id',deal.id).order('created_at',{ascending:true});
  if(error){console.error('messages',error);return}
  const box=document.querySelector('#messages');if(!box)return;
  box.innerHTML=(data||[]).map(m=>`<div class="msg ${String(m.sender_id)===String(user.id)?'mine':''}"><span class="translation-text">${esc(m.message)}</span><small>${new Date(m.created_at).toLocaleString()}</small></div>`).join('')||'<div class="info">No messages yet.</div>';
  box.scrollTop=box.scrollHeight;
 }
 async function ensureSafeDeployment(manual=false){
  if(safeDeploymentBusy)return false;
  safeDeploymentBusy=true;
  if(manual)safeDeploymentLog=[];
  addSafeLog('Starting Safe deployment flow.');
  const createBtn=document.querySelector('#createSafeBtn');
  if(createBtn){createBtn.disabled=true;createBtn.textContent='Creating Safe…'}
  if(!deal || String(deal.status||'').toLowerCase()!=='accepted'){addSafeLog('Stopped: deal is not in accepted status.');return false;}
  addSafeLog('Deal verified: accepted / BNB Smart Chain (56).');
  if(String(deal.safe_deployment_status||'').toLowerCase()==='deployed' && /^0x[a-fA-F0-9]{40}$/.test(String(deal.safe_address||''))){addSafeLog('Safe is already deployed: '+deal.safe_address);return true;}
  const box=document.querySelector('#safeStatus');
  addSafeLog('Preparing a dedicated 2-of-3 Safe for this deal.');
  addSafeLog('The platform wallet is intended to pay the BNB deployment gas.');
  addSafeLog('No USDT is moved during Safe creation.');
  if(canonicalWalletAddress)addSafeLog('Current verified profile wallet: '+canonicalWalletAddress);
  try{
   let session=null;
   try{
    const current=await sb.auth.getSession();
    session=current?.data?.session||null;
   }catch(e){
    console.warn('Deal Room getSession failed',e);
   }
   if(!session && typeof window.Web3MarketSupabaseRestoreSession==='function'){
    try{
     await window.Web3MarketSupabaseRestoreSession();
     const restored=await sb.auth.getSession();
     session=restored?.data?.session||null;
    }catch(e){
     console.warn('Deal Room session restore failed',e);
    }
   }
   if(!session){
    for(let i=0;i<20&&!session;i++){
     await sleep(250);
     try{
      const retry=await sb.auth.getSession();
      session=retry?.data?.session||null;
     }catch(e){
      console.warn('Deal Room session retry failed',e);
     }
    }
   }
   if(!session?.access_token){addSafeLog('Authentication session is missing or expired.');throw new Error('Session expired. Please sign in again.');}
   addSafeLog('Testing safe-sdk-test (Safe Protocol Kit runtime) from the same authenticated browser session…');
   try{
    const sdkProbe=await sb.functions.invoke('safe-sdk-test',{body:{probe:'deal-room-safe-sdk'}});
    if(sdkProbe?.error){
     addSafeLog('safe-sdk-test result: '+(sdkProbe.error.name||'error')+' — '+(sdkProbe.error.message||String(sdkProbe.error)));
    }else{
     addSafeLog('safe-sdk-test result: '+JSON.stringify(sdkProbe?.data||{}));
    }
   }catch(sdkProbeError){
    addSafeLog('safe-sdk-test exception: '+String(sdkProbeError?.message||sdkProbeError));
   }
   addSafeLog('Testing safe-connect-test from the same authenticated browser session…');
   try{
    const probe=await sb.functions.invoke('safe-connect-test',{body:{probe:'deal-room'}});
    if(probe?.error){
     addSafeLog('safe-connect-test result: '+(probe.error.name||'error')+' — '+(probe.error.message||String(probe.error)));
    }else{
     addSafeLog('safe-connect-test result: '+JSON.stringify(probe?.data||{}));
    }
   }catch(probeError){
    addSafeLog('safe-connect-test exception: '+String(probeError?.message||probeError));
   }
   addSafeLog('Authenticated session ready. Calling create-safe Edge Function…');
   const invokeResult=await sb.functions.invoke('create-safe',{body:{deal_id:deal.id},headers:{Authorization:'Bearer '+session.access_token}});
   let result=invokeResult?.data||{};
   let invokeError=invokeResult?.error||null;
   addSafeLog('create-safe SDK invocation completed.');
   addSafeLog('create-safe raw response: '+JSON.stringify(result||{}));
   console.error('create-safe response',invokeError,result);
   if(invokeError || !result.success){
    const detail=[
     invokeError?.name ? 'name='+invokeError.name : '',
     invokeError?.message ? 'message='+invokeError.message : '',
     invokeError?.status ? 'status='+invokeError.status : '',
     invokeError?.context ? 'context='+String(invokeError.context) : '',
     invokeError?.cause ? 'cause='+String(invokeError.cause) : ''
    ].filter(Boolean).join(' | ');
    if(detail)addSafeLog('SDK error detail: '+detail);
    const isFetchError=String(invokeError?.name||'').toLowerCase().includes('fetch')||String(invokeError?.message||'').toLowerCase().includes('failed to send a request');
    if(invokeError){
     addSafeLog('SDK could not expose the HTTP response. Running a direct Edge Function diagnostic…');
     try{
      const direct=await fetch('https://hzhqlexnhtukfljcvnyd.supabase.co/functions/v1/create-safe',{
       method:'POST',
       headers:{
        'Content-Type':'application/json',
        'apikey':'sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI',
        'Authorization':'Bearer '+session.access_token
       },
       body:JSON.stringify({deal_id:deal.id})
      });
      const raw=await direct.text();
      let parsed={};
      try{parsed=raw?JSON.parse(raw):{};}catch(_){}
      addSafeLog('Direct create-safe HTTP status: '+direct.status+' '+direct.statusText);
      addSafeLog('Direct response: '+(parsed?.error||parsed?.message||raw||'(empty response)'));
      if(direct.ok && parsed?.success){
       result=parsed; invokeError=null;
      }else{
       safeDeploymentError=String(parsed?.error||parsed?.message||('HTTP '+direct.status));
       return false;
      }
     }catch(fetchError){
      safeDeploymentError='Direct Edge Function fetch failed: '+String(fetchError?.message||fetchError);
      addSafeLog('ERROR: '+safeDeploymentError);
      return false;
     }
    }else{
     safeDeploymentError=invokeError?.message||String(result.error||result.message||'create-safe returned an error');
     addSafeLog('ERROR: '+safeDeploymentError);
     return false;
    }
   }
   if(!result.success){
    safeDeploymentError=String(result.error||result.message||'create-safe returned an error');
    addSafeLog('ERROR: '+safeDeploymentError);
    return false;
   }
   const refreshed=await sb.from('deals').select('*').eq('id',deal.id).maybeSingle();
   if(refreshed.data) deal=refreshed.data;
   addSafeLog('create-safe reported success. Deal record refreshed.');
   return true;
  }catch(e){
   console.error('Safe deployment',e); safeDeploymentError='Fetch/Network error: '+String(e?.message||'Unknown error');
   addSafeLog('ERROR: '+safeDeploymentError);
   addSafeLog('ERROR: '+safeDeploymentError);
   return false;
  }finally{
   safeDeploymentBusy=false;
   const createBtn=document.querySelector('#createSafeBtn');
   if(createBtn){createBtn.disabled=false;createBtn.textContent='Create / Retry Safe'}
  }
 }
 async function renderSafe(){
  if(!deal)return;
  const box=document.querySelector('#safeStatus');if(!box)return;
  const safe=String(deal.safe_address||'').trim(),chain=Number(deal.chain_id||0);
  if(!/^0x[a-fA-F0-9]{40}$/.test(safe)){
   if(safeDeploymentLog.length)return;
   if(safeDeploymentError){box.innerHTML='<div class="safe-panel warn"><strong>Safe deployment diagnostic</strong><br>'+esc(safeDeploymentError)+'<br><small>No payment is enabled and no USDT was moved.</small></div>';return}
   box.innerHTML='<div class="safe-panel warn"><strong>Safe not configured.</strong><br>Payment and release remain disabled until a verified Safe is attached.</div>';return}
  if(chain!==56){box.innerHTML=`<div class="safe-panel warn"><strong>Chain mismatch.</strong><br>Expected BNB Smart Chain (56), got ${esc(chain||'unknown')}.</div>`;return}
  try{
   if(!window.ethers?.JsonRpcProvider)throw new Error('Safe verification library unavailable');
   const provider=new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org');
   const c=new ethers.Contract(safe,['function getOwners() view returns (address[])','function getThreshold() view returns (uint256)','function nonce() view returns (uint256)'],provider);
   const [owners,threshold,nonce]=await Promise.all([c.getOwners(),c.getThreshold(),c.nonce()]);
   const code=await provider.getCode(safe),ok=code!=='0x'&&owners.length===3&&Number(threshold)===2;
   box.innerHTML=`<div class="safe-panel ${ok?'ok':'warn'}"><strong>Safe 2-of-3 verification</strong><br>${code!=='0x'?'Contract detected':'Not a contract'} · ${owners.length} owner(s) · threshold ${Number(threshold)}<br>Nonce: ${esc(nonce)}<div class="safe-note">${ok?'The Safe configuration is valid. Web3Market cannot release funds alone.':'Expected exactly 3 owners with a 2-signature threshold.'}</div>${ok?`<a class="btn primary" href="https://app.safe.global/transactions/queue?safe=bnb:${encodeURIComponent(safe)}" target="_blank" rel="noopener noreferrer">Open Safe Queue</a>`:''}</div>`;
  }catch(e){console.error('safe verification',e);box.innerHTML='<div class="safe-panel warn"><strong>Safe could not be verified.</strong><br>No release action will be enabled.</div>'}
 }
 async function renderTerms(){
  if(!deal)return;
  const rows=await loadAgreement(),mine=rows.find(x=>x.party_role===participant&&String(x.party_id)===String(user.id)),buyer=rows.find(x=>x.party_role==='buyer')?.agreed_at,seller=rows.find(x=>x.party_role==='seller')?.agreed_at,actions=document.querySelector('#actions');
  if(!actions)return;
  actions.innerHTML=`<div class="notice"><strong>Dispute Resolution — Model B</strong><br>Buyer and Seller agree that Web3Market acts as the dispute resolution party. Funds are held by the 2-of-3 Safe, not by Web3Market. ${buyer?'Buyer ✓':'Buyer pending'} · ${seller?'Seller ✓':'Seller pending'}</div>${participant==='platform'?'<div class="notice ok">Platform moderator view — monitoring and dispute resolution only.</div>':''}<button id="agreeBtn" class="btn primary" ${participant==='platform'||mine?.agreed_at?'disabled':''}>${mine?.agreed_at?'Terms Accepted':'I Agree to Deal Terms'}</button><button id="disputeBtn" class="btn" style="background:#fff7ed;color:#9a3412">Open Dispute</button>`;
  const agreeBtn=document.querySelector('#agreeBtn');
  if(agreeBtn&&!mine?.agreed_at&&participant!=='platform')agreeBtn.onclick=async()=>{agreeBtn.disabled=true;const {error}=await sb.from('deal_party_agreements').upsert({deal_id:deal.id,party_role:participant,party_id:user.id,agreed_at:new Date().toISOString()},{onConflict:'deal_id,party_role,party_id'});if(error){alert(error.message||'Could not save agreement');agreeBtn.disabled=false;return}await renderTerms()};
  const db=document.querySelector('#disputeBtn');
  if(db)db.onclick=async()=>{const reason=prompt('Describe the dispute');if(!reason)return;const {error}=await sb.from('deal_disputes').insert({deal_id:deal.id,opened_by:user.id,reason,status:'open'});if(error)alert(error.message||'Could not open dispute');else alert('Dispute opened for Web3Market review.')};
 }
 renderDealWalletState();
 await loadMessages();await renderTerms();
 // Safe deployment is manual-only from the Deal Room button to prevent automatic rerenders from hiding diagnostics or starting repeated deployment attempts.
 if(String(deal.safe_deployment_status||'').toLowerCase()==='deployed' && deal.safe_address) await renderSafe();
 const form=document.querySelector('#chatForm');
 if(form&&participant!=='platform')form.addEventListener('submit',async e=>{e.preventDefault();const input=document.querySelector('#messageInput'),message=input?.value.trim();if(!message)return;const btn=form.querySelector('button');btn.disabled=true;const {error}=await sb.from('deal_messages').insert({deal_id:deal.id,sender_id:user.id,message});btn.disabled=false;if(error){alert(error.message||'Unable to send message.');return}input.value='';await loadMessages()});
 channel=sb.channel('deal-room-'+deal.id)
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'deal_messages',filter:'deal_id=eq.'+deal.id},loadMessages)
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'deals',filter:'id=eq.'+deal.id},async()=>{if(disposed)return;if(await loadDeal()){await renderTerms();if(String(deal.safe_deployment_status||'').toLowerCase()==='deployed' && deal.safe_address)await renderSafe()}})
  .subscribe();
 window.addEventListener('beforeunload',()=>{disposed=true;if(channel)sb.removeChannel(channel)});
})();