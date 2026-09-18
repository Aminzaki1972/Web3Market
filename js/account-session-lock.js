"use strict";
(function(){
  const SUPABASE_URL="https://hzhqlexnhtukfljcvnyd.supabase.co";
  const ENDPOINT=SUPABASE_URL+"/functions/v1/account-session-lock";
  const HEARTBEAT_MS=60000;
  let timer=null,claimed=false,session=null;

  function client(){return window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase||null}
  async function getSession(){
    const sb=client(); if(!sb?.auth)return null;
    try{return (await sb.auth.getSession()).data?.session||null}catch(_){return null}
  }
  async function call(action,keepalive=false){
    const s=await getSession(); if(!s?.access_token)return {ok:false,error:"NO_SESSION"};
    session=s;
    const res=await fetch(ENDPOINT,{method:"POST",headers:{Authorization:"Bearer "+s.access_token,"Content-Type":"application/json"},body:JSON.stringify({action}),cache:"no-store",keepalive});
    const data=await res.json().catch(()=>({}));
    return {ok:res.ok,...data,status:res.status};
  }
  function blockedUI(){
    const root=document.getElementById("sellerGrid")||document.getElementById("buyerRoot");
    if(root){
      root.style.visibility="visible";
      root.innerHTML='<section style="max-width:620px;margin:60px auto;padding:28px;border:1px solid #fecaca;border-radius:16px;background:#fff7f7;color:#7f1d1d;text-align:center;font-family:system-ui,-apple-system,Segoe UI,sans-serif"><div style="font-size:34px;margin-bottom:10px">🔒</div><h2 style="margin:0 0 10px">This account is already open</h2><p style="margin:0 0 18px;line-height:1.6">This Web3Market account is currently active on another device. Close that session and try again.</p><a href="login.html" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#635bff;color:#fff;text-decoration:none;font-weight:800">Return to Login</a></section>';
    }
  }
  async function claim(){
    const result=await call("claim");
    if(!result.ok){
      claimed=false;
      const sb=client();
      try{await sb?.auth?.signOut({scope:"local"})}catch(_){}
      blockedUI();
      return false;
    }
    claimed=true;
    const root=document.getElementById("sellerGrid")||document.getElementById("buyerRoot");
    if(root)root.style.visibility="visible";
    if(timer)clearInterval(timer);
    timer=setInterval(async()=>{
      if(!claimed)return;
      const r=await call("touch");
      if(!r.ok){claimed=false;clearInterval(timer);try{await client()?.auth?.signOut({scope:"local"})}catch(_){}blockedUI();}
    },HEARTBEAT_MS);
    return true;
  }
  async function release(){
    if(!claimed)return;
    claimed=false;
    if(timer)clearInterval(timer);
    try{await call("release",true)}catch(_){}
  }
  async function signOut(){
    await release();
    const sb=client();
    if(sb?.auth)return sb.auth.signOut({scope:"local"});
  }
  async function loginClaim(){
    const ok=await claim();
    if(!ok)throw new Error("ACCOUNT_ALREADY_OPEN");
    return true;
  }
  window.Web3MarketAccountLock={claim,release,signOut,loginClaim,isClaimed:()=>claimed};
  window.addEventListener("pagehide",()=>{release()});
  window.addEventListener("beforeunload",()=>{release()});
  const isDashboard=/\/((seller|buyer)-dashboard)\.html$/i.test(location.pathname||"");
  if(isDashboard){
    const root=document.getElementById("sellerGrid")||document.getElementById("buyerRoot");
    if(root)root.style.visibility="hidden";
    const start=async()=>{for(let i=0;i<80;i++){if(client()?.auth)break;await new Promise(r=>setTimeout(r,100))}await claim()};
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
  }
})();