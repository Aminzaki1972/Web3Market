"use strict";
(() => {
  const panel = document.getElementById("w3mProtocolPanel");
  if (!panel) return;
  const params = new URLSearchParams(location.search);
  const dealId = params.get("deal") || params.get("id");
  if (!dealId) return;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const setStep = (name, state, message) => {
    const node = panel.querySelector('[data-w3m-step="' + name + '"]');
    if (!node) return;
    node.dataset.state = state || "pending";
    const detail = node.querySelector("span");
    if (detail) detail.textContent = message;
  };
  async function getClient() {
    for (let i = 0; i < 40; i++) {
      const client = window.Web3MarketSupabase?.getClient?.() ||
        window.supabaseClient || window.web3marketSupabase;
      if (client?.from) return client;
      await sleep(250);
    }
    return null;
  }
  async function refresh(client) {
    const dealResult = await client.from("deals")
      .select("id,status,payment_status,payment_tx_hash,delivery_status,buyer_approved_at,release_tx_hash,safe_address")
      .eq("id", dealId).maybeSingle();
    if (dealResult.error || !dealResult.data) {
      setStep("payment", "pending", "Deal state is temporarily unavailable.");
      setStep("delivery", "pending", "Waiting for deal state.");
      setStep("signatures", "pending", "Waiting for Safe authorization data.");
      setStep("settlement", "pending", "No server-confirmed settlement state is available.");
      return;
    }
    const deal = dealResult.data;
    const paid = Boolean(deal.payment_tx_hash) ||
      String(deal.payment_status || "").toLowerCase() === "confirmed";
    const delivered = String(deal.delivery_status || "").toLowerCase() === "accepted" ||
      Boolean(deal.buyer_approved_at);
    const completed = ["completed", "released", "closed"].includes(
      String(deal.status || "").toLowerCase()
    ) && /^0x[a-fA-F0-9]{64}$/.test(String(deal.release_tx_hash || ""));
    const txResult = await client.from("deal_multisig_transactions")
      .select("confirmations_count,status,tx_hash,safe_tx_hash")
      .eq("deal_id", dealId).eq("action", "release_to_seller").maybeSingle();
    const tx = txResult.error ? null : txResult.data;
    const signatures = Number(tx?.confirmations_count || 0);
    setStep("payment", paid ? "done" : "current",
      paid ? "Payment recorded for this deal." : "Awaiting verified buyer payment.");
    setStep("delivery", delivered ? "done" : (paid ? "current" : "pending"),
      delivered ? "Buyer acceptance is recorded." : "Seller delivery and buyer acceptance are not both complete.");
    setStep("signatures", signatures >= 2 ? "done" : (delivered ? "current" : "pending"),
      signatures + " / 2 Safe owner confirmations recorded.");
    setStep("settlement", completed ? "done" : (signatures >= 2 ? "current" : "pending"),
      completed ? "Deal completion and release transaction are recorded." :
        "Settlement is not complete until the server verifies the exact Safe receipt.");
  }
  getClient().then(client => {
    if (!client) {
      setStep("payment", "pending", "Supabase client is unavailable; refresh to retry.");
      return;
    }
    refresh(client).catch(error => {
      console.error("W3M Deal Room status refresh", error);
      setStep("settlement", "pending", "Status refresh failed; no settlement success is assumed.");
    });
    window.setInterval(() => refresh(client).catch(error =>
      console.warn("W3M Deal Room status refresh", error)
    ), 10000);
  }).catch(error => console.error("W3M Deal Room status boot", error));
})();
