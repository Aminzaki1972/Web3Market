"use strict";
(function(){
  async function enforceActiveListings(){
    try{
      var sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
      if(!sb||!window.Web3MarketMarketplace?.renderProjects)return;
      var q=await sb.from("projects").select("*").eq("status","active").order("created_at",{ascending:false});
      if(q.error)throw q.error;
      var projects=Array.isArray(q.data)?q.data:[];
      window.Web3MarketMarketplace.renderProjects(projects);
      window.dispatchEvent(new CustomEvent("web3market:active-listings-enforced",{detail:{count:projects.length}}));
    }catch(e){console.warn("Web3Market active listing filter unavailable",e)}
  }
  function boot(){setTimeout(enforceActiveListings,50);setTimeout(enforceActiveListings,1000);setTimeout(enforceActiveListings,2500)}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
