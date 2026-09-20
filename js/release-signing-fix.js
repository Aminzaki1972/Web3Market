"use strict";
(function(){
  const DEAL_ID = new URLSearchParams(location.search).get('deal') || new URLSearchParams(location.search).get('id');
  const SB_URL = 'https://hzhqlexnhtukfljcvnyd.supabase.co';
  const API_KEY = 'sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI';

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function getClient(){
    for(let i=0;i<60;i++){
      const sb = window.Web3MarketSupabase?.getClient?.() || window.supabaseClient || window.web3marketSupabase;
      if(sb) return sb;
      await sleep(250);
    }
    return null;
  }
  const esc=v=>String(v??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

  async function prepare(){
    const sb=await getClient();
    if(!sb) throw new Error('Supabase client unavailable. Refresh the page.');
    const s=await sb.auth.getSession();
    const token=s?.data?.session?.access_token;
    if(!token) throw new Error('Session expired. Please sign in again.');
    const call=async fn=>{
      const r=await fetch(SB_URL+'/functions/v1/'+fn,{
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':API_KEY,'Authorization':'Bearer '+token},
        body:JSON.stringify({deal_id:DEAL_ID})
      });
      const raw=await r.text(); let d={}; try{d=raw?JSON.parse(raw):{}}catch(_){}
      if(!r.ok || !d.ok) throw new Error(String(d.error||d.message||('HTTP '+r.status)));
      return d;
    };
    await call('prepare-deal-release');
    return await call('prepare-safe-release-tx');
  }

  async function render(){
    const box=document.querySelector('#safeReleaseStatus');
    if(!box || !DEAL_ID) return;
    if(box.dataset.releaseFix==='1') return;
    const text=box.textContent||'';
    if(!/No prepared Safe transaction is currently available/i.test(text)) return;

    const btn=document.createElement('button');
    btn.className='btn primary';
    btn.type='button';
    btn.textContent='Prepare Safe Release';
    btn.style.marginTop='10px';
    const note=document.createElement('div');
    note.className='info';
    note.style.marginTop='6px';
    note.textContent='Creates the corrected Safe transaction using DELEGATECALL (operation 1). No funds move.';
    box.appendChild(btn);
    box.appendChild(note);
    box.dataset.releaseFix='1';

    btn.onclick=async()=>{
      btn.disabled=true; btn.textContent='Preparing…'; note.textContent='Preparing corrected Safe transaction…';
      try{
        const out=await prepare();
        note.innerHTML='<strong>✓ Safe transaction prepared.</strong> Operation is DELEGATECALL (1). Reloading…';
        await sleep(700);
        location.reload();
      }catch(e){
        note.textContent='Preparation failed: '+String(e?.message||e);
        btn.disabled=false; btn.textContent='Prepare Safe Release';
      }
    };
  }

  const start=async()=>{
    for(let i=0;i<80;i++){
      await render();
      if(document.querySelector('#safeReleaseStatus')) await sleep(500);
      else await sleep(250);
    }
  };
  start().catch(e=>console.error('release-signing-fix',e));
})();