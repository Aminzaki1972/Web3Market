"use strict";
(function () {
  var SUPABASE_URL = "https://hzhqlexnhtukfljcvnyd.supabase.co";
  var SUPABASE_KEY = "sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI";
  var VERIFY_FN = SUPABASE_URL + "/functions/v1/verify-wallet";
  var AUTH_USER = SUPABASE_URL + "/auth/v1/user";
  var AUTH_TOKEN = SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token";
  var STORAGE_KEY = "web3market-auth";
  var CHAIN_HEX = "0x38";
  var VERSION = "REST-AUTH-20260918-7";

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
  function getAuth() {
    var s = saved();
    return authUser(s && s.access_token).then(function (user) {
      if (user && user.id) return { session: s, user: user };
      if (!s || !s.refresh_token) return null;
      return fetch(AUTH_TOKEN, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: s.refresh_token })
      }).then(function (r) {
        if (!r.ok) return null;
        return r.json();
      }).then(function (next) {
        if (!next || !next.access_token) return null;
        var merged = {};
        Object.keys(s).forEach(function (k) { merged[k] = s[k]; });
        Object.keys(next).forEach(function (k) { merged[k] = next[k]; });
        if (!merged.refresh_token) merged.refresh_token = s.refresh_token;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        return authUser(merged.access_token).then(function (u) {
          return u && u.id ? { session: merged, user: u } : null;
        });
      }).catch(function () { return null; });
    });
  }
  function providers() {
    var out = [];
    var eth = window.ethereum;
    if (eth) out.push(eth);
    if (eth && eth.providers && eth.providers.length) {
      eth.providers.forEach(function (p) { if (p && out.indexOf(p) === -1) out.push(p); });
    }
    return out;
  }
  function detect() {
    var p = providers();
    return {
      metamask: p.find(function (x) { return x.isMetaMask && !x.isBraveWallet; }),
      trust: p.find(function (x) { return x.isTrust; }),
      coinbase: p.find(function (x) { return x.isCoinbaseWallet; }),
      okx: p.find(function (x) { return x.isOkxWallet || x.isOKExWallet; }),
      safepal: p.find(function (x) { return x.isSafePal; }),
      binance: p.find(function (x) { return x.isBinance; })
    };
  }
  function findByName(name) {
    var n = String(name || "").toLowerCase().split(" ")[0];
    var p = providers();
    for (var i = 0; i < p.length; i++) {
      var label = String((p[i].info && p[i].info.name) || p[i].name || "").toLowerCase();
      if (label.indexOf(n) !== -1) return p[i];
    }
    return null;
  }
  function listWallets() {
    var d = detect();
    return [
      {name:"MetaMask",provider:d.metamask,icon:"https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg"},
      {name:"Trust Wallet",provider:d.trust,icon:"https://trustwallet.com/assets/images/media/assets/TWT.png"},
      {name:"OKX Wallet",provider:d.okx},
      {name:"SafePal",provider:d.safepal},
      {name:"Coinbase Wallet",provider:d.coinbase},
      {name:"Binance Wallet",provider:d.binance}
    ].map(function (x) { x.detected = !!x.provider; return x; });
  }
  function getDetected(name) { return findByName(name); }
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
    var hexMessage = utf8Hex(message);
    try {
      return await withTimeout(provider.request({method:"personal_sign",params:[hexMessage,address]}), 45000, "Wallet signature request timed out. Please approve the signature in your wallet and return to Web3Market.");
    } catch (firstError) {
      notice("The wallet did not return the signature. Retrying the ownership signature…");
      return await withTimeout(provider.request({method:"personal_sign",params:[message,address]}), 45000, firstError && firstError.message ? firstError.message : "Wallet signature was not received.");
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
              return {address:address,user:auth.user,walletName:walletName,verified:true,data:data};
            });
          });
        });
      });
    });
  }
  function launch(name, notice) {
    var n = String(name || "").toLowerCase();
    var mobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!mobile) { if (notice) notice("Open " + name + " in this browser, then connect again."); return false; }
    var urls = {
      "metamask":"https://metamask.app.link/dapp/" + location.host + location.pathname,
      "trust wallet":"https://link.trustwallet.com/open_url?coin_id=20000714&url=" + encodeURIComponent(location.href),
      "okx wallet":"okx://wallet/dapp/details?dappUrl=" + encodeURIComponent(location.href),
      "safepal":"safepalwallet://dapp?url=" + encodeURIComponent(location.href),
      "coinbase wallet":"https://go.cb-w.com/dapp?cb_url=" + encodeURIComponent(location.href),
      "binance wallet":"bnc://app.binance.com/cedefi/dapp?url=" + encodeURIComponent(location.href)
    };
    var u = urls[n];
    if (!u) { if (notice) notice("Open your wallet browser and visit Web3Market again."); return false; }
    location.href = u;
    return true;
  }

  window.Web3MarketWalletManager = {
    connectAndVerify: connectAndVerify,
    listWallets: listWallets,
    getDetected: getDetected,
    launch: launch,
    short: short,
    esc: esc,
    detect: detect,
    version: VERSION
  };
})();