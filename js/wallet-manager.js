"use strict";
(function () {
  var SUPABASE_URL = "https://hzhqlexnhtukfljcvnyd.supabase.co";
  var SUPABASE_KEY = "sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI";
  var VERIFY_FN = SUPABASE_URL + "/functions/v1/verify-wallet";
  var AUTH_USER = SUPABASE_URL + "/auth/v1/user";
  var AUTH_TOKEN = SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token";
  var STORAGE_KEY = "web3market-auth";
  var CHAIN_HEX = "0x38";
  var VERSION = "ROLE-ACCOUNT-WALLET-20260920-3";
  var LINKED_PROVIDER_KEY = "web3market-linked-wallet-provider";
  var LINKED_ROUTE_PREFIX = "web3market-wallet-route:";

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>\"']/g, function (m) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m];
    });
  }
  function short(a) { return a ? a.slice(0, 6) + "…" + a.slice(-4) : ""; }
  function saved() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (e) { return null; }
  }
  function authUser(token) {
    if (!token) return Promise.resolve(null);
    return fetch(AUTH_USER, {
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + token },
      cache: "no-store"
    }).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).catch(function () { return null; });
  }
  async function getAuth() {
    for (var attempt = 0; attempt < 40; attempt++) {
      try {
        var unified = window.Web3MarketSupabase && (
          (typeof window.Web3MarketSupabase.getClient === "function" && window.Web3MarketSupabase.getClient()) ||
          window.Web3MarketSupabase.client ||
          window.Web3MarketSupabase.supabase
        );
        if (unified && unified.auth) {
          var current = await unified.auth.getSession();
          var session = current && current.data && current.data.session;
          if (!session) {
            try {
              if (typeof window.Web3MarketSupabaseRestoreSession === "function") {
                await window.Web3MarketSupabaseRestoreSession();
                current = await unified.auth.getSession();
                session = current && current.data && current.data.session;
              }
            } catch (restoreError) {
              console.warn("Web3Market session restore failed", restoreError);
            }
          }
          if (session && session.access_token) {
            var me = await unified.auth.getUser();
            var user = me && me.data && me.data.user;
            if (user && user.id) return {session:session,user:user};
          }
        }
      } catch (e) {
        console.warn("Web3Market unified auth session unavailable", e);
      }
      await new Promise(function(resolve){ setTimeout(resolve, 250); });
    }
    return null;
  }
  function providers() {
    var out = [];
    var eth = window.ethereum;
    if (eth) out.push(eth);
    if (window.safepalProvider && out.indexOf(window.safepalProvider) === -1) out.push(window.safepalProvider);
    if (eth && eth.providers && eth.providers.length) {
      eth.providers.forEach(function (p) { if (p && out.indexOf(p) === -1) out.push(p); });
    }
    return out;
  }
  function isTrustWalletBrowser() { try { return /trustwallet|trust wallet/i.test(String(navigator.userAgent || "")) || /trustwallet|trust wallet/i.test(String(navigator.vendor || "")); } catch (_) { return false; } }
  function detect() {
    var p = providers();
    var generic = p.length ? p[0] : null;
    var trust = p.find(function (x) { return x.isTrust || x.isTrustWallet; }) || (isTrustWalletBrowser() ? generic : null);
    return {
      metamask: p.find(function (x) { return x.isMetaMask && !x.isBraveWallet; }),
      trust: trust,
      coinbase: p.find(function (x) { return x.isCoinbaseWallet; }),
      okx: p.find(function (x) { return x.isOkxWallet || x.isOKExWallet; }),
      safepal: (window.safepalProvider || p.find(function (x) { return x.isSafePal; })),
      binance: p.find(function (x) { return x.isBinance; })
    };
  }
  function findByName(name) {
    var requested = String(name || "").toLowerCase().trim();
    if (requested === "trust wallet" && isTrustWalletBrowser()) { var trustDetected = detect().trust; if (trustDetected) return trustDetected; }
    var n = requested.split(" ")[0];
    var p = providers();
    for (var i = 0; i < p.length; i++) {
      var label = String((p[i].info && p[i].info.name) || p[i].name || "").toLowerCase();
      if (label.indexOf(n) !== -1) return p[i];
    }
    return null;
  }
  function listWallets() {
    var d = detect();
    var linked = getLinkedWalletName();
    var rows = [
      {name:"MetaMask",provider:d.metamask,icon:"https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg"},
      {name:"Trust Wallet",provider:d.trust,icon:"https://trustwallet.com/assets/images/media/assets/TWT.png"},
      {name:"OKX Wallet",provider:d.okx},
      {name:"SafePal",provider:d.safepal},
      {name:"Coinbase Wallet",provider:d.coinbase},
      {name:"Binance Wallet",provider:d.binance}
    ];
    // SafePal must never be preferred merely because its provider exists.
    // Keep it in the list only when it is the wallet recorded for this account.
    if(linked && linked.toLowerCase()!=="safepal"){
      rows=rows.filter(function(x){ return String(x.name).toLowerCase()!=="safepal"; });
    } else if(!linked && d.trust){
      // If Trust Wallet is the detected provider and no provider metadata has
      // been saved yet, do not allow the legacy SafePal fallback to win.
      rows=rows.filter(function(x){ return String(x.name).toLowerCase()!=="safepal"; });
    }
    return rows.map(function (x) { x.detected = !!x.provider; return x; });
  }
  function getDetected(name) { return findByName(name); }
  async function refreshWalletProviders() {
    var announced = [];
    function onAnnounce(event) { var detail = event && event.detail; if (detail && detail.provider && announced.indexOf(detail.provider) === -1) announced.push(detail.provider); }
    try { window.addEventListener("eip6963:announceProvider", onAnnounce); window.dispatchEvent(new Event("eip6963:requestProvider")); await new Promise(function(resolve){ setTimeout(resolve, 350); }); }
    finally { window.removeEventListener("eip6963:announceProvider", onAnnounce); }
    announced.forEach(function(provider){ var info = provider && provider._web3marketEip6963Info; if (info && ((info.rdns && /trust/i.test(info.rdns)) || (info.name && /trust wallet/i.test(info.name)))) provider.isTrust = true; });
    return announced;
  }
  function getLinkedWalletName() { try { return localStorage.getItem(LINKED_PROVIDER_KEY) || ""; } catch (_) { return ""; } }
  function routeKey(address) { return LINKED_ROUTE_PREFIX + String(address || "").toLowerCase(); }
  function getLinkedWalletForAddress(address) { try { return localStorage.getItem(routeKey(address)) || ""; } catch (_) { return ""; } }
  function saveWalletRoute(address, walletName) { try { if (/^0x[a-fA-F0-9]{40}$/.test(String(address || "")) && walletName) localStorage.setItem(routeKey(address), String(walletName)); } catch (_) {} }
  function switchBSC(provider) {
    return provider.request({method:"wallet_switchEthereumChain",params:[{chainId:CHAIN_HEX}]}).catch(function (e) {
      if (!e || e.code !== 4902) throw e;
      return provider.request({method:"wallet_addEthereumChain",params:[{
        chainId:CHAIN_HEX,
        chainName:"BNB Smart Chain",
        nativeCurrency:{name:"BNB",symbol:"BNB",decimals:18},
        rpcUrls:["https://bsc-dataseed.binance.org"],
        blockExplorerUrls:["https://bscscan.com"]
      }]});
    });
  }
  function buildMessage(address, user, role, purpose) {
    return [
      "Web3Market Wallet Ownership Verification", "",
      "I am connecting this wallet to my authenticated Web3Market account.", "",
      "Domain: " + location.host,
      "Account: " + user.id,
      "Role: " + role,
      "Purpose: " + purpose,
      "Wallet: " + address,
      "Chain ID: 56 (BNB Smart Chain)",
      "Timestamp: " + new Date().toISOString(), "",
      "This signature does not authorize any transaction or transfer of funds.",
      "This signature is proof of wallet ownership only.",
      "It does not authorize a transaction, token approval, or transfer of funds."
    ].join("\n");
  }
  function utf8Hex(text) {
    try {
      var bytes = new TextEncoder().encode(text), out = "";
      for (var i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
      return "0x" + out;
    } catch (e) { return text; }
  }
  function withTimeout(promise, ms, message) {
    return Promise.race([promise, new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error(message)); }, ms);
    })]);
  }
  async function requestOwnershipSignature(provider, address, message, notice) {
    try {
      return await withTimeout(provider.request({method:"personal_sign",params:[message,address]}), 45000, "Wallet signature request timed out. Please approve the signature in your wallet and return to Web3Market.");
    } catch (firstError) {
      var code = firstError && firstError.code;
      var text = String(firstError && firstError.message || "").toLowerCase();
      var shouldRetry = code === -32602 || text.indexOf("invalid params") !== -1 || text.indexOf("invalid parameter") !== -1;
      if (!shouldRetry) throw firstError;
      notice("Preparing the wallet signature in a compatible format…");
      return await withTimeout(provider.request({method:"personal_sign",params:[utf8Hex(message),address]}), 45000, firstError && firstError.message ? firstError.message : "Wallet signature was not received.");
    }
  }
  function connectAndVerify(provider, walletName, opts) {
    opts = opts || {};
    if (!provider) return Promise.reject(new Error(walletName + " wallet provider was not detected. Open its wallet browser and try again."));
    var notice = opts.setNotice || function () {};
    notice("Connecting to " + walletName + "…");
    return provider.request({method:"eth_requestAccounts"}).then(function (accounts) {
      var address = accounts && accounts[0];
      if (!/^0x[a-fA-F0-9]{40}$/.test(address || "")) throw new Error("Wallet address could not be read.");
      notice("Wallet connected. Preparing free ownership signature…");
      return switchBSC(provider).then(function () { return getAuth(); }).then(function (auth) {
        if (!auth) throw new Error("Your Web3Market login session is unavailable. Please sign in again.");
        var role = opts.role || "seller";
        var purpose = opts.purpose || "wallet_ownership";
        var msg = buildMessage(address, auth.user, role, purpose);
        notice("Approve the ownership signature in your wallet. No funds will move.");
        return requestOwnershipSignature(provider,address,msg,notice).then(function (signature) {
          if (!signature) throw new Error("Wallet signature was not received.");
          notice("Signature received. Verifying wallet ownership and saving it…");
          var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
          var verifyTimer = controller ? setTimeout(function(){controller.abort();}, 20000) : null;
          return fetch(VERIFY_FN, {
            method:"POST",
            headers:{apikey:SUPABASE_KEY,Authorization:"Bearer "+auth.session.access_token,"Content-Type":"application/json"},
            body:JSON.stringify({address:address,message:msg,signature:signature,chain_id:56,purpose:purpose,role:role}),
            signal: controller ? controller.signal : undefined,
            cache:"no-store"
          }).then(function (r) {
            if (verifyTimer) clearTimeout(verifyTimer);
            return r.json().catch(function () { return null; }).then(function (data) {
              if (!r.ok || !data || !data.ok || !data.verified) throw new Error((data && (data.error || data.message)) || ("Wallet verification failed (" + r.status + ")."));
              notice("Wallet ownership verified and saved ✓");
              try { localStorage.setItem(LINKED_PROVIDER_KEY, String(walletName || "")); } catch (_) {}
              saveWalletRoute(address, walletName);
              // Persist the provider/launch route against the authenticated
              // profile as well as localStorage. The address remains the
              // authoritative identity; provider is only a transport route.
              try {
                var client = window.Web3MarketSupabase && (
                  (typeof window.Web3MarketSupabase.getClient === "function" && window.Web3MarketSupabase.getClient()) ||
                  window.Web3MarketSupabase.client || window.Web3MarketSupabase.supabase
                );
                if (client && client.from) {
                  await client.from("profiles").update({
                    wallet_provider:String(walletName || ""),
                    wallet_route:String(walletName || ""),
                    updated_at:new Date().toISOString()
                  }).eq("id",auth.user.id).eq("wallet_address",address);
                }
              } catch (persistError) {
                console.warn("Wallet provider route persistence skipped", persistError);
              }
              return {address:address,user:auth.user,walletName:walletName,verified:true,data:data};
            });
          });
        });
      });
    });
  }
  function launch(name, notice) {
    var requested = String(name || "").trim();
    var n = requested.toLowerCase();
    var mobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!mobile) { if (notice) notice("Open " + requested + " in this browser, then connect again."); return false; }
    var linked = getLinkedWalletName();
    // The old Deal Room passed "SafePal" as a hard-coded fallback. Do not
    // silently redirect users to SafePal: if the linked provider is known,
    // open that provider; otherwise show a one-time wallet chooser and
    // remember the user's selection for future role-based signing.
    if (n === "safepal" && linked && linked.toLowerCase() !== "safepal") {
      return launch(linked, notice);
    }
    if (n === "safepal" && !linked) {
      var choices = [
        ["Trust Wallet","https://link.trustwallet.com/open_url?coin_id=20000714&url="],
        ["MetaMask","https://metamask.app.link/dapp/"],
        ["OKX Wallet","okx://wallet/dapp/details?dappUrl="],
        ["SafePal","safepalwallet://dapp?url="],
        ["Coinbase Wallet","https://go.cb-w.com/dapp?cb_url="],
        ["Binance Wallet","bnc://app.binance.com/cedefi/dapp?url="]
      ];
      var modal=document.createElement("div");
      modal.style.cssText="position:fixed;inset:0;background:rgba(15,23,42,.78);display:flex;align-items:center;justify-content:center;padding:20px;z-index:20000";
      var card=document.createElement("div");
      card.style.cssText="background:#fff;color:#111827;border-radius:16px;max-width:420px;width:100%;padding:18px";
      card.innerHTML="<strong>Select the wallet linked to your Web3Market account</strong><div style='font-size:12px;color:#64748b;margin:8px 0 12px'>The wallet address will still be checked before signing.</div>";
      choices.forEach(function(item){
        var b=document.createElement("button");
        b.type="button"; b.className="btn"; b.style.cssText="display:block;width:100%;margin-top:8px;background:#f8fafc;color:#111827;border:1px solid #dbe4ef;text-align:left";
        b.textContent=item[0];
        b.onclick=function(){
          try{localStorage.setItem(LINKED_PROVIDER_KEY,item[0]);}catch(_){}
          var prefix=item[1];
          var u=prefix+(item[0]==="Trust Wallet" ? encodeURIComponent(location.href) : item[0]==="MetaMask" ? location.host+location.pathname : encodeURIComponent(location.href));
          location.href=u;
        };
        card.appendChild(b);
      });
      var close=document.createElement("button"); close.type="button"; close.className="btn"; close.style.cssText="display:block;width:100%;margin-top:12px;background:#fff;color:#374151;border:1px solid #dbe4ef"; close.textContent="Cancel"; close.onclick=function(){modal.remove();};
      card.appendChild(close); modal.appendChild(card); document.body.appendChild(modal);
      if(notice) notice("Select the wallet linked to this account.");
      return true;
    }
    var urls = {
      "metamask":"https://metamask.app.link/dapp/" + location.host + location.pathname,
      "trust wallet":"https://link.trustwallet.com/open_url?coin_id=20000714&url=" + encodeURIComponent(location.href),
      "okx wallet":"okx://wallet/dapp/details?dappUrl=" + encodeURIComponent(location.href),
      "safepal":"safepalwallet://dapp?url=" + encodeURIComponent(location.href),
      "coinbase wallet":"https://go.cb-w.com/dapp?cb_url=" + encodeURIComponent(location.href),
      "binance wallet":"bnc://app.binance.com/cedefi/dapp?url=" + encodeURIComponent(location.href)
    };
    var u = urls[n];
    if (n === "safepal" && window.safepalProvider) { if (notice) notice("SafePal provider detected. Connect again to continue."); return false; }
    if (!u) { if (notice) notice("Open your wallet browser and visit Web3Market again."); return false; }
    location.href = u;
    return true;
  }

  window.Web3MarketWalletManager = {
    connectAndVerify: connectAndVerify,
    listWallets: listWallets,
    getDetected: getDetected,
    getLinkedWalletName: getLinkedWalletName,
    getLinkedWalletForAddress: getLinkedWalletForAddress,
    saveWalletRoute: saveWalletRoute,
    refreshWalletProviders: refreshWalletProviders,
    launch: launch,
    short: short,
    esc: esc,
    detect: detect,
    version: VERSION
  };
})();