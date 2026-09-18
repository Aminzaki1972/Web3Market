"use strict";
(function(){
  const SUPABASE_URL="https://hzhqlexnhtukfljcvnyd.supabase.co";
  const ENDPOINT=SUPABASE_URL+"/functions/v1/account-session-lock";
  let claimed=false,session=null;

  function client(){return window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase||null}
  async function getSession(){
    const sb=client(); if(!sb?.auth)return null;
    try{return (await sb.auth.getSession()).data?.session||null}catch(_){return null}
  }
  async function call(action,keepalive=false){
    const sb=client();
    const s=await getSession();
    if(!sb?.auth||!s?.access_token)return {ok:false,error:"NO_SESSION"};
    session=s;
    try{
      if(sb.functions?.invoke){
        const {data,error}=await sb.functions.invoke("account-session-lock",{body:{action}});
        if(error){
          console.error("Web3Market account lock:",error);
          return {ok:false,error:error.message||"ACCOUNT_LOCK_REQUEST_FAILED"};
        }
        return {ok:true,...(data||{})};
      }
    }catch(e){
      console.error("Web3Market account lock invoke:",e);
      return {ok:false,error:e?.message||"ACCOUNT_LOCK_REQUEST_FAILED"};
    }
    try{
      const res=await fetch(ENDPOINT,{method:"POST",headers:{Authorization:"Bearer "+s.access_token,apikey:""+(sb.supabaseKey||""),"Content-Type":"application/json"},body:JSON.stringify({action}),cache:"no-store",keepalive});
      const data=await res.json().catch(()=>({}));
      return {ok:res.ok,...data,status:res.status};
    }catch(e){
      return {ok:false,error:e?.message||"ACCOUNT_LOCK_REQUEST_FAILED"};
    }
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
    bindLogout();
    return true;
  }
  async function release(){
    if(!claimed)return;
    claimed=false;
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
  function bindLogout(){const b=document.getElementById("accountLogoutButton");if(!b||b.dataset.bound==="1")return;b.dataset.bound="1";b.addEventListener("click",async()=>{b.disabled=true;b.textContent="Signing out…";try{await signOut()}catch(_){}location.replace("login.html")})}
  window.Web3MarketAccountLock={claim,release,signOut,loginClaim,isClaimed:()=>claimed};
  bindLogout();
  const isDashboard=/\/((seller|buyer)-dashboard)\.html$/i.test(location.pathname||"");
  if(isDashboard){
    const root=document.getElementById("sellerGrid")||document.getElementById("buyerRoot");
    if(root)root.style.visibility="hidden";
    const start=async()=>{for(let i=0;i<80;i++){if(client()?.auth)break;await new Promise(r=>setTimeout(r,100))}await claim()};
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
  }
})();