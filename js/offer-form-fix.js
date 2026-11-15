"use strict";

/**
 * Legacy offer-form guard for pages that may still load this compatibility
 * script. Direct browser inserts into deals/deal_messages are not permitted
 * while the server-authoritative Deal Management API is unavailable.
 */
(function () {
  document.addEventListener("submit", function (event) {
    const form = event.target;
    if (!form || form.id !== "offerForm") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const status = document.getElementById("offerStatus");
    if (status) {
      status.textContent =
        "Offer submission is temporarily disabled while the new Deal Management workflow is completed. No deal or message was created.";
    }
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
  }, true);
})();
