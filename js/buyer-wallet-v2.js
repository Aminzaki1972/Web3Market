"use strict";
(function(){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function loadManager(){
    if(window.Web3MarketWalletManager)return Promise.resolve();
    return new Promise(resolve=>{
      const id="wm-wallet-manager-loader";let s=document.getElementById(id);
      if(!s){s=document.createElement("script");s.id=id;s.src="js/wallet-manager.js?v=20260918-walletmanager1";s.async=false;s.onload=resolve;s.onerror=resolve;document.head.appendChild(s)}else s.addEventListener("load",resolve,{once:true});
      setTimeout(resolve,2500);
    });
  }
  function manager(){return window.Web3MarketWalletManager||null}
  function ensureModal(){
    let m=document.getElementById("buyerWalletModal");if(m)return m;
    m=document.createElement("div");m.id="buyerWalletModal";m.hidden=true;m.style.cssText="position:fixed;inset:0;z-index:99999;background:rgba(3,5,15,.78);backdrop-filter:blur(7px);display:grid;place-items:center;padding:18px";
    m.innerHTML='<div style="width:min(430px,100%);max-height:85vh;overflow:auto;background:#15132a;border:1px solid #443270;border-radius:18px;padding:18px;color:#fff"><div style="display:flex;justify-content:space-between;align-items:center"><div><strong style="font-size:17px">Connect Web3 Wallet</strong><div style="font-size:10px;color:#aaa3c3;margin-top:4px">Choose your wallet to connect and verify ownership</div></div><button id="buyerWalletClose" type="button" style="border:0;background:transparent;color:#aaa3c3;font-size:24px">×</button></div><div id="buyerWalletList"></div><div id="buyerWalletNotice" style="font-size:10px;color:#a9a2bd;margin-top:10px;line-height:1.5"></div></div>';
    document.body.appendChild(m);m.addEventListener("click",e=>{if(e.target===m)m.hidden=true});m.querySelector("#buyerWalletClose").onclick=()=>m.hidden=true;return m;
  }
  async function connect(entry,name,m){
    const wm=manager(),notice=m.querySelector("#buyerWalletNotice"),card=document.querySelector(".wallet-card"),button=card?.querySelector(".btn.full");
    if(!wm){notice.textContent="Wallet connection is unavailable. Please refresh the page.";return}
    try{
      if(button){button.disabled=true;button.textContent="Connecting…"}
      const result=await wm.connectAndVerify(entry.provider,name,{role:"buyer",purpose:"buyer_wallet_ownership",setNotice:v=>{notice.textContent=v}});
      m.hidden=true;history.replaceState({},"",location.pathname);
      if(card){const a=card.querySelector(".wallet-address"),t=card.querySelector(".wallet-text");if(a)a.textContent=wm.short(result.address);if(t)t.textContent="Connected and ownership verified."}
      if(button){button.textContent="Manage Wallet";button.disabled=false}
      window.dispatchEvent(new CustomEvent("web3market:buyer-wallet-connected",{detail:{address:result.address,walletName:name}}));
    }catch(e){console.error("Web3Market buyer wallet connect:",e);notice.textContent=e?.message||"Wallet connection failed.";if(button){button.disabled=false;button.textContent="Connect Wallet"}}
  }
  function open(){
    const wm=manager();if(!wm)return;const m=ensureModal(),list=m.querySelector("#buyerWalletList");list.innerHTML="";
    wm.listWallets().forEach(row=>{
      const b=document.createElement("button");b.type="button";b.style.cssText="width:100%;display:flex;align-items:center;gap:12px;margin:8px 0;padding:13px;border:1px solid #3a3158;border-radius:12px;background:#18152b;color:#fff;cursor:pointer;text-align:left;touch-action:manipulation";
      b.innerHTML='<span style="font-size:20px">◈</span><span style="flex:1"><strong style="display:block;font-size:12px">'+wm.esc(row.name)+'</strong><small style="display:block;color:#89829f;margin-top:3px">'+(row.detected?"Detected on this device":"Open wallet app / browser")+'</small></span><span style="color:#7c3aed">›</span>';
      b.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();if(row.provider)connect({provider:row.provider},row.name,m);else wm.launch(row.name,m.querySelector("#buyerWalletNotice"))});list.appendChild(b);
    });m.hidden=false;
  }
  async function refresh(){
    try{
      const c=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;if(!c?.auth)return;
      const user=(await c.auth.getUser())?.data?.user;if(!user)return;
      const p=(await c.from("profiles").select("wallet_address,wallet_verified").eq("id",user.id).maybeSingle())?.data,card=document.querySelector(".wallet-card");if(!card)return;
      const addr=p?.wallet_address||"",verified=p?.wallet_verified===true,a=card.querySelector(".wallet-address"),t=card.querySelector(".wallet-text"),b=card.querySelector(".btn.full");
      if(a)a.textContent=addr?manager().short(addr):"Not connected";if(t)t.textContent=verified?"Connected and ownership verified.":addr?"Wallet connected, but ownership is not verified. Verify the wallet to continue.":"Connect and verify a Web3 wallet for buyer activity.";if(b)b.textContent=verified?"Manage Wallet":addr?"Verify Wallet":"Connect Wallet";
    }catch(e){console.warn("Web3Market wallet state:",e)}
  }
  function bind(){document.querySelectorAll(".wallet-card .btn.full").forEach(b=>{if(b.dataset.walletModalBound)return;b.dataset.walletModalBound="1";b.href="#";b.addEventListener("click",e=>{e.preventDefault();open()})});refresh()}
  async function boot(){await loadManager();if(!manager())return;bind();new MutationObserver(bind).observe(document.documentElement,{childList:true,subtree:true})}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
