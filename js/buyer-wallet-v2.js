"use strict";
(function(){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function loadManager(){
    if(window.Web3MarketWalletManager)return Promise.resolve();
    return new Promise(resolve=>{
      const id="wm-wallet-manager-loader";let s=document.getElementById(id);
      if(!s){s=document.createElement("script");s.id=id;s.src="js/wallet-manager.js?v=20260921-walletfix15";s.async=false;s.onload=resolve;s.onerror=resolve;document.head.appendChild(s)}else s.addEventListener("load",resolve,{once:true});
      setTimeout(resolve,2500);
    });
  }
  function manager(){return window.Web3MarketWalletManager||null}
  function ensureModal(){
    let m=document.getElementById("buyerWalletModal");if(m)return m;
    m=document.createElement("div");m.id="buyerWalletModal";m.hidden=true;m.style.cssText="position:fixed;inset:0;z-index:99999;background:rgba(3,5,15,.78);backdrop-filter:blur(7px);display:grid;place-items:center;padding:18px";
    m.innerHTML='<div style="width:min(430px,100%);max-height:85vh;overflow:auto;background:#15132a;border:1px solid #443270;border-radius:18px;padding:18px;color:#fff"><div style="display:flex;justify-content:space-between;align-items:center"><div><strong style="font-size:17px">Connect Web3 Wallet</strong><div style="font-size:10px;color:#aaa3c3;margin-top:4px">Choose your wallet to connect and verify ownership</div></div><button id="buyerWalletClose" type="button" aria-label="Close wallet list" title="Close" style="pointer-events:auto;position:relative;z-index:100000;width:36px;height:36px;border:1px solid #4a3b68;border-radius:10px;background:#211b35;color:#fff;font-size:25px;line-height:1;cursor:pointer;display:grid;place-items:center;touch-action:manipulation">×</button></div><div id="buyerWalletList"></div><div id="buyerWalletNotice" style="font-size:10px;color:#a9a2bd;margin-top:10px;line-height:1.5"></div></div>';
    document.body.appendChild(m);
    m.addEventListener("click",e=>{if(e.target===m)closeModal(m)});
    const closeBtn=m.querySelector("#buyerWalletClose");
    if(closeBtn){
      ["click","pointerup","touchend"].forEach(type=>closeBtn.addEventListener(type,e=>{e.preventDefault();e.stopImmediatePropagation();closeModal(m)}, {capture:true,passive:false}));
    }
    return m;
  }
  function closeModal(m){
    if(!m)return;
    m.hidden=true;
    m.style.display="none";
    m.setAttribute("aria-hidden","true");
  }
  function showModal(m){
    m.style.display="grid";
    m.hidden=false;
    m.setAttribute("aria-hidden","false");
  }
  function installCloseGuard(){
    if(window.__wmBuyerWalletCloseGuard)return;
    window.__wmBuyerWalletCloseGuard=true;
    const guard=e=>{
      const t=e.target&&e.target.closest?e.target.closest("#buyerWalletClose"):null;
      if(!t)return;
      e.preventDefault();e.stopImmediatePropagation();
      closeModal(document.getElementById("buyerWalletModal"));
    };
    ["click","pointerup","touchend"].forEach(type=>document.addEventListener(type,guard,{capture:true,passive:false}));
  }
  async function waitForBuyerAuth(){
    for(let i=0;i<20;i++){
      try{
        const c=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
        if(c?.auth){
          const s=await c.auth.getSession();
          if(s?.data?.session?.access_token){
            const u=await c.auth.getUser();
            if(u?.data?.user?.id)return true;
          }
        }
        try{await window.Web3MarketSupabaseRestoreSession?.()}catch(e){}
      }catch(e){}
      await sleep(250);
    }
    return false;
  }
  async function connect(entry,name,m){
    const wm=manager(),notice=m.querySelector("#buyerWalletNotice"),card=document.querySelector(".wallet-card"),button=card?.querySelector(".btn.full");
    if(!wm){notice.textContent="Wallet connection is unavailable. Please refresh the page.";return}
    try{
      const isMobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent||"");
      if(isMobile && !entry.provider){closeModal(m);wm.launch(name,m.querySelector("#buyerWalletNotice"));return}
      if(!(await waitForBuyerAuth()))throw new Error("Your Web3Market login session is unavailable. Please sign in again.");
      if(button){button.disabled=true;button.textContent="Connecting…"}
      const result=await wm.connectAndVerify(entry.provider,name,{role:"buyer",purpose:"buyer_wallet_ownership",setNotice:v=>{notice.textContent=v}});
      closeModal(m);history.replaceState({},"",location.pathname);
      if(card){const a=card.querySelector(".wallet-address"),t=card.querySelector(".wallet-text");if(a)a.textContent=wm.short(result.address);if(t)t.textContent="Connected and ownership verified."}
      if(button){button.textContent="Disconnect";button.disabled=false}
      window.dispatchEvent(new CustomEvent("web3market:buyer-wallet-connected",{detail:{address:result.address,walletName:name}}));
    }catch(e){console.error("Web3Market buyer wallet connect:",e);notice.textContent=e?.message||"Wallet connection failed.";if(button){button.disabled=false;button.removeAttribute("disabled");button.style.pointerEvents="auto";button.style.cursor="pointer";button.textContent="Connect Wallet"}}
  }
  function open(){
    const wm=manager();if(!wm)return;const m=ensureModal(),list=m.querySelector("#buyerWalletList");list.innerHTML="";
    wm.listWallets().forEach(row=>{
      const b=document.createElement("button");b.type="button";b.style.cssText="width:100%;display:flex;align-items:center;gap:12px;margin:8px 0;padding:13px;border:1px solid #3a3158;border-radius:12px;background:#18152b;color:#fff;cursor:pointer;text-align:left;touch-action:manipulation";
      b.innerHTML='<span style="font-size:20px">◈</span><span style="flex:1"><strong style="display:block;font-size:12px">'+wm.esc(row.name)+'</strong><small style="display:block;color:#89829f;margin-top:3px">'+(row.detected?"Detected on this device":"Open wallet app / browser")+'</small></span><span style="color:#7c3aed">›</span>';
      b.addEventListener("click",e=>{
        e.preventDefault();e.stopPropagation();
        const mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent||"");
        if(row.provider) connect({provider:row.provider},row.name,m);
        else if(mobile){closeModal(m);wm.launch(row.name,null)}
        else{const notice=m.querySelector("#buyerWalletNotice");if(notice)notice.textContent="Open "+row.name+" in its browser or install the wallet app, then return here.";wm.launch(row.name,notice)}
      });
      list.appendChild(b);
    });
    showModal(m);
  }
  window.Web3MarketBuyerWalletOpen=open;
  window.Web3MarketBuyerWalletDisconnect=disconnect;
  async function refresh(){
    try{
      const c=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;if(!c?.auth)return;
      const user=(await c.auth.getUser())?.data?.user;if(!user)return;
      const p=(await c.from("profiles").select("wallet_address,wallet_verified").eq("id",user.id).maybeSingle())?.data,card=document.querySelector(".wallet-card");if(!card)return;
      const addr=p?.wallet_address||"",verified=p?.wallet_verified===true,a=card.querySelector(".wallet-address"),t=card.querySelector(".wallet-text"),b=card.querySelector(".btn.full");
      if(a)a.textContent=addr?manager().short(addr):"Not connected";if(t)t.textContent=verified?"Connected and ownership verified.":addr?"Wallet connected, but ownership is not verified. Verify the wallet to continue.":"Connect and verify a Web3 wallet for buyer activity.";if(b){b.textContent=verified?"Disconnect":addr?"Verify Wallet":"Connect Wallet";b.disabled=false;b.removeAttribute("disabled");b.style.pointerEvents="auto";b.style.cursor="pointer";}
    }catch(e){console.warn("Web3Market wallet state:",e)}
  }
  async function disconnect(){
    const card=document.querySelector(".wallet-card"),button=card?.querySelector(".btn.full"),notice=document.getElementById("buyerNotice");
    try{
      if(button){button.disabled=true;button.textContent="Disconnecting…"}
      const c=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
      const {data:{session}}=await c.auth.getSession();
      if(!session?.access_token)throw new Error("Your Web3Market login session is unavailable. Please sign in again.");
      const r=await fetch("https://hzhqlexnhtukfljcvnyd.supabase.co/functions/v1/verify-wallet",{method:"POST",headers:{apikey:"sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI",Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"},body:JSON.stringify({action:"disconnect"})});
      const data=await r.json().catch(()=>null);
      if(!r.ok||!data?.disconnected)throw new Error(data?.error||"Wallet disconnect failed.");
      await refresh();if(notice)notice.textContent="Wallet disconnected from your Buyer profile.";
    }catch(e){if(button){button.disabled=false;button.textContent="Disconnect"}if(notice)notice.textContent=e?.message||"Wallet disconnect failed."}
  }
  function bind(){
    document.querySelectorAll("#walletBtn,.wallet-card .btn.full").forEach(b=>{
      if(b.dataset.walletModalBound)return;
      b.dataset.walletModalBound="1";b.removeAttribute("href");b.setAttribute("type","button");b.disabled=false;b.style.pointerEvents="auto";b.style.cursor="pointer";
      b.onclick=function(e){if(e){e.preventDefault();e.stopPropagation()}if(String(b.textContent||"").trim()==="Disconnect")disconnect();else open();return false};
    });
    refresh();
  }
  async function boot(){await loadManager();if(!manager())return;installCloseGuard();bind();new MutationObserver(bind).observe(document.documentElement,{childList:true,subtree:true})}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();