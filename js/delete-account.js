"use strict";
(function(){
  const SUPABASE_URL="https://hzhqlexnhtukfljcvnyd.supabase.co";
  const FUNCTION_URL=SUPABASE_URL+"/functions/v1/delete-account";
  const esc=v=>String(v??"").replace(/[&<>\"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
  let inserted=false;

  function getClient(){
    return window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase||null;
  }

  function mount(){
    const root=document.getElementById("sellerGrid")||document.getElementById("buyerRoot");
    if(!root||inserted)return;
    if(!root.innerHTML||/Loading seller dashboard|Loading Buyer Center/i.test(root.textContent||""))return;
    inserted=true;
    const box=document.createElement("section");
    box.id="deleteAccountPanel";
    box.style.cssText="margin:24px 0;padding:18px;border:1px solid #fecaca;border-radius:14px;background:#fff7f7;color:#7f1d1d";
    box.innerHTML='<div style="font-weight:900;font-size:14px;margin-bottom:5px">Delete your Web3Market account</div><div style="font-size:12px;line-height:1.6;color:#991b1b">This permanently removes your login and profile. Projects owned by you will be removed when they are not linked to a deal. Accounts with deal history are protected and must be closed through support.</div><button id="deleteAccountBtn" type="button" style="margin-top:12px;padding:10px 14px;border:0;border-radius:9px;background:#dc2626;color:#fff;font-weight:800;cursor:pointer">Delete My Account</button><div id="deleteAccountMsg" style="margin-top:9px;font-size:12px;font-weight:700"></div>';
    root.appendChild(box);
    document.getElementById("deleteAccountBtn").addEventListener("click",deleteAccount);
  }

  async function deleteAccount(){
    const btn=document.getElementById("deleteAccountBtn"),msg=document.getElementById("deleteAccountMsg");
    if(!confirm("Delete your Web3Market account permanently? This cannot be undone."))return;
    const sb=getClient();
    if(!sb?.auth){msg.textContent="Authentication is unavailable. Please refresh and try again.";return;}
    btn.disabled=true;btn.style.opacity=".65";msg.textContent="Checking your account…";
    try{
      const session=(await sb.auth.getSession())?.data?.session;
      if(!session?.access_token){msg.textContent="Your session has expired. Please sign in again.";btn.disabled=false;btn.style.opacity="1";return;}
      const res=await fetch(FUNCTION_URL,{method:"POST",headers:{Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"}});
      const data=await res.json().catch(()=>({}));
      if(!res.ok){
        msg.textContent=data.error||"Account deletion failed.";
        btn.disabled=false;btn.style.opacity="1";
        return;
      }
      await sb.auth.signOut();
      try{localStorage.removeItem("web3market-auth")}catch(e){}
      msg.textContent="Account deleted. Redirecting…";
      setTimeout(()=>location.href="index.html",500);
    }catch(e){
      console.error("Delete account:",e);
      msg.textContent="Could not complete account deletion. Please try again.";
      btn.disabled=false;btn.style.opacity="1";
    }
  }

  function boot(){
    mount();
    const root=document.getElementById("sellerGrid")||document.getElementById("buyerRoot");
    if(root){
      const obs=new MutationObserver(()=>mount());
      obs.observe(root,{childList:true,subtree:false});
      setTimeout(mount,500);setTimeout(mount,1500);setTimeout(mount,3000);
    }
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();