"use strict";

/**
 * Read-only checkout shell for the isolated Deal Management prototype.
 *
 * Legacy Safe creation and legacy payment verification are intentionally
 * disabled here. The new server-authoritative agreement/deposit workflow is
 * not yet implemented. This file must not create a Safe, request a wallet
 * signature, submit a token transfer, or invoke a production payment function.
 */
(async function () {
  const root = document.querySelector("#checkoutApp");
  const dealId = new URLSearchParams(location.search).get("deal");
  const supabase = window.Web3MarketSupabase?.getClient?.() ||
    window.supabaseClient || window.web3marketSupabase || null;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[char]);

  if (!root || !dealId) {
    if (root) root.innerHTML = '<div class="status">Deal information is unavailable.</div>';
    return;
  }
  if (!supabase) {
    root.innerHTML = '<div class="status">Database connection unavailable. Please refresh the page.</div>';
    return;
  }

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      root.innerHTML = '<div class="status">Please sign in.</div>';
      return;
    }

    const { data: deal, error } = await supabase.from("deals")
      .select("id,project_id,buyer_id,seller_id,amount,currency,status,payment_status,payment_tx_hash,chain_id,safe_address,token_contract,token_symbol")
      .eq("id", dealId).maybeSingle();

    if (error || !deal) {
      root.innerHTML = '<div class="status">Deal not found.</div>';
      return;
    }
    if (String(deal.buyer_id) !== String(user.id) &&
        String(deal.seller_id) !== String(user.id)) {
      root.innerHTML = '<div class="status">You are not a participant in this deal.</div>';
      return;
    }

    const amount = esc(deal.amount);
    const currency = esc(deal.token_symbol || deal.currency || "USDT");
    const paymentStatus = esc(deal.payment_status || "pending");
    const legacyPaymentRecorded = Boolean(deal.payment_tx_hash) ||
      String(deal.payment_status || "").toLowerCase() === "confirmed";

    root.innerHTML = `
      <h2>Deal Checkout</h2>
      <div class="card">
        <p>Deal amount: <strong>${amount} ${currency}</strong></p>
        <p>Deal status: <strong>${esc(deal.status || "unknown")}</strong></p>
        <p>Existing payment record: <strong>${paymentStatus}</strong></p>
        <p class="status" role="status">
          The previous checkout payment flow is disabled in this prototype.
          ${legacyPaymentRecorded
            ? "A legacy payment record exists, but it is not accepted as proof for the new workflow."
            : "No new deposit can be initiated from this page."}
          The new agreement, Safe validation and deposit-verification backend
          must be completed and tested before deposits are enabled.
        </p>
        <a class="btn" href="deal-room.html?deal=${encodeURIComponent(deal.id)}">Open Deal Room</a>
      </div>`;
  } catch (error) {
    console.error("Read-only Deal Checkout failed", error);
    root.innerHTML = '<div class="status">Could not load deal information. No payment action was attempted.</div>';
  }
})();
