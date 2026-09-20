"use strict";
(function(){
  const DEAL_ID=new URLSearchParams(location.search).get('deal')||new URLSearchParams(location.search).get('id');
  const SB_URL='https://hzhqlexnhtukfljcvnyd.supabase.co';
  const API_KEY='sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI';
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function getClient(){for(let i=0;i<80;i++){const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;if(sb)return sb;await sleep(250)}return null}
  async function render(){
    const box=document.querySelector('#safeReleaseStatus'); if(!box||!DEAL_ID||box.dataset.releaseFix==='1')return;
    const sb=await getClient(); if(!sb)return;
    const q=await sb.from('deals').select('delivery_status,buyer_approved_at').eq('id',DEAL_ID).maybeSingle();
    if(q.error||!q.data)return;
    const accepted=String(q.data.delivery_status||'').toLowerCase()==='accepted'||Boolean(q.data.buyer_approved_at); if(!accepted)return;
    const tx=await sb.from('deal_multisig_transactions').select('safe_tx_hash,operation,status,confirmations_count').eq('deal_id',DEAL_ID).eq('action','release_to_seller').maybeSingle();
    const t=tx.data; box.dataset.releaseFix='1';
    if(t?.safe_tx_hash&&Number(t.operation)===1)return;
    box.innerHTML='<div class="wallet-box" style="background:#eff6ff;border-color:#bfdbfe;color:#1e40af"><strong>Safe Release</strong><div class="info" style="margin-top:6px">✓ Delivery accepted. Prepare the corrected Safe transaction. No funds move during preparation.</div><button id="releaseFixPrepare" class="btn primary" type="button" style="margin-top:10px">Prepare Safe Release</button><div id="releaseFixNote" class="info" style="margin-top:6px">Uses DELEGATECALL (operation 1), then requires 2-of-3 Safe owner signatures.</div></div>';
    const btn=document.querySelector('#releaseFixPrepare'),note=document.querySelector('#releaseFixNote');
    btn.onclick=async()=>{
      btn.disabled=true;btn.textContent='Preparing…';note.textContent='Preparing corrected Safe transaction…';
      try{
        const s=await sb.auth.getSession(),token=s?.data?.session?.access_token;if(!token)throw new Error('Session expired. Please sign in again.');
        const call=async fn=>{const r=await fetch(SB_URL+'/functions/v1/'+fn,{method:'POST',headers:{'Content-Type':'application/json','apikey':API_KEY,'Authorization':'Bearer '+token},body:JSON.stringify({deal_id:DEAL_ID})});const raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{}}catch(_){}if(!r.ok||!d.ok)throw new Error(String(d.error||d.message||('HTTP '+r.status)));return d};
        await call('prepare-deal-release'); await call('prepare-safe-release-tx');
        note.textContent='✓ Prepared with DELEGATECALL (1). Reloading to show Sign Safe Release…';await sleep(800);location.reload();
      }catch(e){note.textContent='Preparation failed: '+String(e?.message||e);btn.disabled=false;btn.textContent='Prepare Safe Release'}
    };
  }
  (async()=>{for(let i=0;i<80;i++){try{await render()}catch(e){console.error('release-signing-fix',e)}await sleep(500)}})();
})();