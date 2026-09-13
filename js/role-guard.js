/* Web3Market role guard — passive role marker only.
   Authentication/session ownership belongs to the dashboard controller.
   This prevents role-guard and dashboard JS from racing over the same Supabase session. */
"use strict";
(function(){
  const path=(location.pathname||"").toLowerCase();
  const requiredRole=path.endsWith("/buyer-dashboard.html")?"buyer":path.endsWith("/seller-dashboard.html")?"seller":null;
  if(!requiredRole)return;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function client(){return window.Web3MarketSupabase?.getClient?.()||window.Web3MarketSupabase?.client||window.supabaseClient||window.web3marketSupabase||null}
  async function markRole(){
    let sb=null;
    for(let i=0;i<50;i++){
      sb=client();
      if(sb?.auth)break;
      await sleep(100);
    }
    if(!sb?.auth)return;

    // Do not redirect and do not call setSession here. The dashboard controller
    // is the single owner of authentication/session restoration.
    let session=null;
    try{session=(await sb.auth.getSession()).data?.session||null}catch(e){}
    if(!session?.user){
      try{session=await window.Web3MarketSupabaseRestoreSession?.()}catch(e){}
    }
    if(!session?.user)return;

    try{
      const {data,error}=await sb.from("profiles").select("role").eq("id",session.user.id).maybeSingle();
      if(!error&&data?.role){
        const role=String(data.role).trim().toLowerCase();
        document.documentElement.dataset.web3marketRole=role;
        document.documentElement.dataset.web3marketRequiredRole=requiredRole;
      }
    }catch(e){}
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",markRole,{once:true});else markRole();
})();