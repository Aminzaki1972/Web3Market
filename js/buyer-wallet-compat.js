/* Compatibility bridge for the wallet launcher. */
(function () {
  'use strict';
  window.Web3MarketWalletCompat = {
    isMobile: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
    getProvider: function () { return window.ethereum || null; },
    open: function (url) {
      if (!url) return false;
      if (this.isMobile) {
        window.location.href = url;
        return true;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    }
  };
})();