/* Web3Market role guard — restores the authenticated session before checking the role. */
"use strict";
(function(){
const path=location.pathname.toLowerCase();
const requiredRole=path.endsWith("/buyer-dashboard.html")?"buyer":path.endsWith("/seller-dashboard.html")?"seller":null;
if(!requiredRole)return;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function client(){return window.Web3MarketSupabase?.getClient?.()||window.Web3MarketSupabase?.client||window.supabaseClient||window.web3marketSupabase||null}
async function guard(){
 let sb=null;
 for(let i=0;i<50;i++){sb=client();if(sb?.auth)break;await sleep(100)}
 if(!sb?.auth){location.replace("login.html");return}
 let user=null;
 for(let i=0;i<8&&!user;i++){
  try{const {data}=await sb.auth.getUser();if(data?.user)user=data.user}catch(e){}
  if(!user){try{await window.Web3MarketSupabaseRestoreSession?.()}catch(e){}await sleep(250)}
 }
 if(!user){try{const raw=localStorage.getItem("web3market-auth"),saved=raw?JSON.parse(raw):null;if(saved?.access_token&&saved?.refresh_token){const r=await sb.auth.setSession({access_token:saved.access_token,refresh_token:saved.refresh_token});user=r?.data?.user||r?.data?.session?.user||null}}catch(e){}}
 if(!user){location.replace("login.html?next="+encodeURIComponent(location.pathname.split('/').pop()));return}
 let profile=null;
 for(let i=0;i<8&&!profile;i++){try{const q=await sb.from("profiles").select("role").eq("id",user.id).maybeSingle();if(!q.error&&q.data?.role)profile=q.data}catch(e){}if(!profile)await sleep(250)}
 if(!profile?.role)return;
 const role=String(profile.role).trim().toLowerCase();
 if(role!==requiredRole){location.replace(role==="buyer"?"buyer-dashboard.html":role==="seller"?"seller-dashboard.html":"index.html");return}
 document.documentElement.dataset.web3marketRole=role;
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",guard,{once:true});else guard();
})();