"use strict";
(function(){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function loadManager(){
    if(window.Web3MarketWalletManager)return Promise.resolve();
    return new Promise(resolve=>{
      const id="wm-wallet-manager-loader";let s=document.getElementById(id);
      if(!s){s=document.createElement("script");s.id=id;s.src="js/wallet-manager.js?v=20261118-wallet-signature-autoconnect-v4";s.async=false;s.onload=resolve;s.onerror=resolve;document.head.appendChild(s)}else s.addEventListener("load",resolve,{once:true});
      setTimeout(resolve,2500);
    });
  }
  function manager(){return window.Web3MarketWalletManager||null}
  function activate(button,action){
    // Use the trusted click event only. Preventing pointerup on Android Chrome
    // can suppress the subsequent click and break external wallet app handoff.
    button.disabled=false;button.removeAttribute("disabled");
    button.style.pointerEvents="auto";button.style.touchAction="manipulation";
    button.style.position="relative";button.style.zIndex="2";
    button.onclick=function(e){
      if(e){e.preventDefault();e.stopPropagation();if(e.isTrusted===false)return;}
      try{action(e)}catch(err){console.error("Buyer wallet action failed",err);const n=document.getElementById("buyerWalletNotice");if(n)n.textContent=err&&err.message?err.message:"Wallet action failed."}
      return false;
    };
  }
  function ensureModal(){
    let m=document.getElementById("buyerWalletModal");if(m)return m;
    m=document.createElement("div");m.id="buyerWalletModal";m.hidden=true;m.style.cssText="position:fixed;inset:0;z-index:2147483647;pointer-events:auto;background:rgba(3,5,15,.78);backdrop-filter:blur(7px);display:grid;place-items:center;padding:18px";
    m.innerHTML='<div style="width:min(430px,100%);max-height:85vh;overflow:auto;background:#15132a;border:1px solid #443270;border-radius:18px;padding:18px;color:#fff"><div style="display:flex;justify-content:space-between;align-items:center"><div><strong style="font-size:17px">Connect Web3 Wallet</strong><div style="font-size:10px;color:#aaa3c3;margin-top:4px">Choose your wallet to connect and verify ownership</div></div><button id="buyerWalletClose" type="button" aria-label="Close wallet list" title="Close" style="width:44px;height:44px;display:grid;place-items:center;border:1px solid #4a3b68;border-radius:12px;background:#211b35;color:#fff;font-size:28px;line-height:1;cursor:pointer;pointer-events:auto;touch-action:manipulation;-webkit-tap-highlight-color:transparent;flex:0 0 auto">×</button></div><div id="buyerWalletList"></div><div id="buyerWalletNotice" style="font-size:10px;color:#a9a2bd;margin-top:10px;line-height:1.5"></div></div>';
    document.body.appendChild(m);
    m.addEventListener("click",e=>{if(e.target===m)closeModal(m)});m.addEventListener("touchstart",e=>{if(e.target===m)closeModal(m)},{passive:true});
    const closeBtn=m.querySelector("#buyerWalletClose");
    if(closeBtn)activate(closeBtn,()=>closeModal(m));
    return m;
  }
  function closeModal(m){
    if(!m)return;
    m.hidden=true;
    m.style.display="none";
    m.setAttribute("aria-hidden","true");
  }
  function showModal(m){
    m.style.setProperty("display","grid","important");
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
  function ensureBuyerWalletStyles(){
    if(document.getElementById("w3m-buyer-wallet-premium-style"))return;
    const style=document.createElement("style");style.id="w3m-buyer-wallet-premium-style";
    style.textContent=`
      #buyerWalletModal{padding:16px!important;backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px)}
      #buyerWalletModal>div{width:min(460px,100%)!important;max-height:min(82vh,720px);overflow:auto;padding:24px!important;border:1px solid #e8eaf2!important;background:#fff!important;color:#111827!important;box-shadow:0 28px 90px rgba(10,16,35,.32)!important}
      #buyerWalletModal>div>div:first-child strong{font-size:20px!important;letter-spacing:-.45px;color:#111827}
      #buyerWalletClose{width:36px!important;height:36px!important;padding:0!important;border-radius:11px!important;background:#f3f4f6!important;border:0!important;color:#475569!important;font-size:22px!important}
      #buyerWalletList{display:grid;grid-template-columns:1fr;gap:10px;margin-top:16px}
      #buyerWalletList .w3m-wallet-option{width:100%;min-height:76px;box-sizing:border-box;display:grid;grid-template-columns:48px minmax(0,1fr) 22px;align-items:center;gap:14px;margin:0!important;padding:12px 15px!important;text-align:left;border:1px solid #e5e7eb!important;border-radius:15px!important;background:#fff!important;color:#111827!important;box-shadow:0 2px 7px rgba(15,23,42,.035);cursor:pointer!important;transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}
      #buyerWalletList .w3m-wallet-option:active{transform:scale(.985);border-color:#7c3aed!important}
      #buyerWalletList .w3m-wallet-option:hover{border-color:#a5b4fc!important;box-shadow:0 8px 22px rgba(79,70,229,.10)}
      #buyerWalletList .w3m-wallet-icon{width:48px;height:48px;display:grid;place-items:center;border-radius:13px;background:#f6f7fb;color:#4f46e5;font-size:24px;overflow:hidden}
      #buyerWalletList .w3m-wallet-icon img{width:34px;height:34px;object-fit:contain}
      #buyerWalletList strong{display:block;font-size:14px;font-weight:800;line-height:1.35;color:#111827}
      #buyerWalletList small{display:block;margin-top:4px;font-size:11px;line-height:1.35;color:#64748b}
      #buyerWalletList .w3m-wallet-arrow{font-size:25px;color:#94a3b8;text-align:center}
      @media(max-width:480px){#buyerWalletModal>div{padding:18px!important;border-radius:18px!important}#buyerWalletList .w3m-wallet-option{min-height:70px;grid-template-columns:42px minmax(0,1fr) 18px;gap:11px;padding:10px 12px!important}#buyerWalletList .w3m-wallet-icon{width:42px;height:42px}}
    `;
    document.head.appendChild(style);
  }
  function open(){
    ensureBuyerWalletStyles();
    const wm=manager();if(!wm)return;const m=ensureModal(),list=m.querySelector("#buyerWalletList");list.innerHTML="";
    wm.listWallets().forEach(row=>{
      const b=document.createElement("button");b.type="button";b.className="w3m-wallet-option";b.style.cssText="touch-action:manipulation;pointer-events:auto;position:relative;z-index:2";
      b.innerHTML='<span class="w3m-wallet-icon" style="pointer-events:none">'+(row.icon?'<img src="'+wm.esc(row.icon)+'" alt="">':'◈')+'</span><span style="flex:1;pointer-events:none"><strong>'+wm.esc(row.name)+'</strong><small>'+(row.detected?"Detected on this device":"Open wallet app / browser")+'</small></span><span class="w3m-wallet-arrow" style="pointer-events:none">›</span>';
      activate(b,()=>{
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
  async function autoConnect(){
    const target=new URLSearchParams(location.search).get("wm_wallet");
    if(!target)return;
    const wm=manager(),m=ensureModal();
    if(!wm)return;
    showModal(m);
    const notice=m.querySelector("#buyerWalletNotice");
    if(notice)notice.textContent="Returning to "+target+"… detecting the wallet and preparing your free ownership signature.";
    try{await wm.refreshWalletProviders?.()}catch(e){}
    for(let i=0;i<40;i++){
      const provider=wm.getDetected(target);
      if(provider){
        if(notice)notice.textContent=target+" detected. Requesting wallet connection now; approve the connection and free ownership signature in your wallet.";
        await connect({provider},target,m);
        return;
      }
      await sleep(250);
    }
    if(notice)notice.textContent=target+" opened, but its provider was not detected. Open this page inside the wallet browser, then choose the detected wallet below.";
    open();
  }
  function bind(){
    document.querySelectorAll("#walletBtn,.wallet-card .btn.full").forEach(b=>{
      if(b.dataset.walletModalBound)return;
      b.dataset.walletModalBound="1";b.removeAttribute("href");b.setAttribute("type","button");b.disabled=false;b.style.pointerEvents="auto";b.style.cursor="pointer";
      b.onclick=function(e){if(e){e.preventDefault();e.stopPropagation()}if(String(b.textContent||"").trim()==="Disconnect")disconnect();else open();return false};
    });
    refresh();
  }
  async function boot(){await loadManager();if(!manager())return;installCloseGuard();bind();await manager().refreshWalletProviders?.();autoConnect();new MutationObserver(bind).observe(document.documentElement,{childList:true,subtree:true})}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();