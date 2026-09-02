"use strict";(function(){
const BSC="0x38";
const short=a=>a.slice(0,8)+"…"+a.slice(-6);
const getSb=()=>window.Web3MarketSupabase?.getClient?.()||window.Web3MarketSupabase?.client||window.Web3MarketSupabase?.supabase||window.supabaseClient||window.web3marketSupabase;
function getProvider(){
 try{
  if(window.ethereum&&typeof window.ethereum.request==="function")return window.ethereum;
 }catch(_){ }
 return null;
}
async function connect(e){
 e.preventDefault();
 const link=e.currentTarget,card=link.closest(".wallet-card"),sb=getSb(),old=link.textContent;
 try{
  const provider=getProvider();
  if(!provider)return;
  link.style.pointerEvents="none";
  const accounts=await provider.request({method:"eth_requestAccounts"}),address=accounts?.[0];
  if(!address)return;
  let chain=await provider.request({method:"eth_chainId"});
  if(chain!==BSC){
   try{await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:BSC}]})}
   catch(err){
    if(err?.code===4902)await provider.request({method:"wallet_addEthereumChain",params:[{chainId:BSC,chainName:"BNB Smart Chain",nativeCurrency:{name:"BNB",symbol:"BNB",decimals:18},rpcUrls:["https://bsc-dataseed.binance.org/"],blockExplorerUrls:["https://bscscan.com/"]}]});
    else throw err;
   }
  }
  if(await provider.request({method:"eth_chainId"})!==BSC)return;
  if(!sb?.auth)return;
  const {data:{session}}=await sb.auth.getSession();
  if(!session)return;
  const message=`Web3Market Buyer Wallet Verification\n\nI am connecting this wallet to my Web3Market buyer account.\n\nWallet: ${address}\nChain: BNB Smart Chain\nTimestamp: ${new Date().toISOString()}\n\nThis signature does not authorize any transaction or transfer of funds.`;
  const signature=await provider.request({method:"personal_sign",params:[message,address]});
  if(!signature)return;
  const response=await fetch("https://hzhqlexnhtukfljcvnyd.supabase.co/functions/v1/verify-wallet",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+session.access_token},body:JSON.stringify({address,message,signature})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)return;
  const addr=card?.querySelector(".wallet-address"),txt=card?.querySelector(".wallet-text");
  if(addr)addr.textContent=short(address);
  if(txt)txt.textContent="Wallet connected and verified.";
  link.textContent="Wallet Connected ✓";
 }catch(_){
  link.textContent=old;
  link.style.pointerEvents="auto";
 }
}
function bind(){document.querySelectorAll(".wallet-card .btn.full").forEach(btn=>{if(btn.dataset.walletBound)return;btn.dataset.walletBound="1";btn.href="#";btn.addEventListener("click",connect)})}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind);else bind();
new MutationObserver(bind).observe(document.documentElement,{childList:true,subtree:true});
})();
