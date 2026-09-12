"use strict";
(function(){
 const id=new URLSearchParams(location.search).get('id');
 if(!id)return;
 const returnTo='project.html?id='+encodeURIComponent(id);
 const save=()=>{try{sessionStorage.setItem('web3market_offer_return_to',returnTo);sessionStorage.setItem('web3market_offer_flow','1')}catch(_) {}};
 document.addEventListener('click',e=>{
  const a=e.target.closest?.('a[href*="register.html?role=buyer"]');
  if(a)save();
 },true);
 document.addEventListener('submit',e=>{
  if(e.target?.id==='offerForm')save();
 },true);
})();
