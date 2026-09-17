/* Web3Market — mobile wallet launcher + ownership verification
 * Safe change: this file only handles wallet connection/signature. No payment logic.
 */
(function () {
  'use strict';

  const BSC_CHAIN_ID = '0x38';
  const APP_URL = window.location.origin + window.location.pathname;

  const WALLETS = [
    { id:'metamask', name:'MetaMask', icon:'🦊', deep:'https://metamask.app.link/dapp/' },
    { id:'okx', name:'OKX Wallet', icon:'◈', deep:'okx://wallet/dapp/url?dappUrl=' },
    { id:'safepal', name:'SafePal', icon:'◉', deep:'https://link.safepal.io/dapp?url=' },
    { id:'trust', name:'Trust Wallet', icon:'🛡️', deep:'https://link.trustwallet.com/open_url?coin_id=20000714&url=' },
    { id:'coinbase', name:'Coinbase Wallet', icon:'🔵', deep:'https://go.cb-w.com/dapp?cb_url=' }
  ];

  function mobile() { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent); }
  function currentDappUrl() { return encodeURIComponent(window.location.href); }

  function openWallet(wallet) {
    const url = currentDappUrl();
    let target = '';
    if (wallet.id === 'metamask') {
      target = wallet.deep + window.location.host + window.location.pathname + window.location.search;
    } else if (wallet.id === 'okx') {
      target = wallet.deep + url;
    } else {
      target = wallet.deep + url;
    }
    if (mobile()) {
      window.location.href = target;
      setTimeout(() => { if (!document.hidden) window.open(target, '_blank'); }, 900);
    } else {
      window.open(target, '_blank', 'noopener,noreferrer');
    }
  }

  async function connectInjected(provider) {
    const accounts = await provider.request({ method:'eth_requestAccounts' });
    if (!accounts || !accounts[0]) throw new Error('No wallet account returned');
    try { await provider.request({ method:'wallet_switchEthereumChain', params:[{chainId:BSC_CHAIN_ID}] }); } catch (e) {
      if (e && e.code === 4902) {
        await provider.request({ method:'wallet_addEthereumChain', params:[{
          chainId:BSC_CHAIN_ID, chainName:'BNB Smart Chain', nativeCurrency:{name:'BNB',symbol:'BNB',decimals:18},
          rpcUrls:['https://bsc-dataseed.binance.org/'], blockExplorerUrls:['https://bscscan.com/']
        }] });
      }
    }
    return accounts[0];
  }

  function getProvider() {
    if (window.ethereum) return window.ethereum;
    return null;
  }

  window.Web3MarketWalletLauncher = { WALLETS, openWallet, connectInjected, getProvider };
})();