import {
  prepareW3MSafeRelease,
  signW3MSafeRelease,
  executeW3MDealReleaseFromWallet,
  recordW3MSafeWalletSubmission,
  verifyW3MDealReleaseFromServer,
} from "./w3m-safe-wallet-execution-client.js?v=20261106-w3m-v1";

"use strict";
(() => {
  const params = new URLSearchParams(location.search);
  const DEAL_ID = params.get("deal") || params.get("id");
  const SB_URL = "https://hzhqlexnhtukfljcvnyd.supabase.co";
  const API_KEY = "sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI";
  const PENDING_KEY = "w3m-safe-attempt:" + String(DEAL_ID || "");
  const ZERO = "0x0000000000000000000000000000000000000000";
  let memoryPending = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);

  async function getClient() {
    for (let i = 0; i < 80; i++) {
      const client = window.Web3MarketSupabase?.getClient?.() ||
        window.supabaseClient || window.web3marketSupabase;
      if (client) return client;
      await sleep(250);
    }
    return null;
  }

  async function getSession(client) {
    const result = await client.auth.getSession();
    const session = result?.data?.session;
    if (!session?.access_token) throw new Error("Session expired. Please sign in again.");
    return session;
  }

  async function ensureBnb(provider) {
    if (!provider?.request) throw new Error("Open this Deal Room in your connected wallet browser.");
    const current = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
    if (current === "0x38" || current === "56") return;
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x38" }],
      });
    } catch (error) {
      if (error?.code !== 4902) {
        throw new Error("Please switch your wallet to BNB Smart Chain (56).");
      }
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x38",
          chainName: "BNB Smart Chain",
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          rpcUrls: ["https://bsc-rpc.publicnode.com"],
          blockExplorerUrls: ["https://bscscan.com"],
        }],
      });
    }
  }

  function readPending() {
    try {
      const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
      if (value && typeof value.attemptId === "string") memoryPending = value;
    } catch { /* retain in-memory reconciliation details */ }
    return memoryPending;
  }

  function savePending(value) {
    memoryPending = value;
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(value)); }
    catch { /* keep the hash in memory; never re-send automatically */ }
  }

  function clearPending() {
    memoryPending = null;
    try { sessionStorage.removeItem(PENDING_KEY); }
    catch { /* no persistent session entry to clear */ }
  }

  async function wireFallback(client) {
    const button = document.querySelector("#safeReleaseFallbackBtn");
    const note = document.querySelector("#safeReleaseFallbackNote");
    if (!button || button.dataset.w3mWired === "1") return;
    button.dataset.w3mWired = "1";
    button.onclick = async () => {
      button.disabled = true;
      button.textContent = "W3M checking evidence…";
      try {
        const session = await getSession(client);
        const result = await prepareW3MSafeRelease({
          dealId: DEAL_ID,
          accessToken: session.access_token,
          apiKey: API_KEY,
          supabaseUrl: SB_URL,
        });
        if (note) note.textContent = "✓ W3M PREPARE committed atomically. Loading the exact Safe transaction…";
        button.textContent = "Prepared";
        await sleep(500);
        location.reload();
      } catch (error) {
        if (note) note.textContent = "W3M PREPARE blocked: " + String(error?.message || error);
        button.disabled = false;
        button.textContent = "Prepare Safe Release";
      }
    };
  }

  async function render() {
    const box = document.querySelector("#safeReleaseStatus");
    if (!box || !DEAL_ID) return;
    const client = await getClient();
    if (!client) return;
    await wireFallback(client);

    const dealResult = await client.from("deals")
      .select("delivery_status,buyer_approved_at")
      .eq("id", DEAL_ID).maybeSingle();
    if (dealResult.error || !dealResult.data) return;
    const accepted = String(dealResult.data.delivery_status || "").toLowerCase() === "accepted" ||
      Boolean(dealResult.data.buyer_approved_at);
    if (!accepted) return;

    const txResult = await client.from("deal_multisig_transactions")
      .select("safe_tx_hash,safe_address,to_address,value_wei,data,operation,safe_tx_gas,base_gas,gas_price,gas_token,refund_receiver,safe_nonce,status,confirmations_count")
      .eq("deal_id", DEAL_ID).eq("action", "release_to_seller").maybeSingle();
    const tx = txResult.data;
    const pending = readPending();

    if (!tx?.safe_tx_hash || Number(tx.operation) !== 1) {
      if (pending) {
        box.innerHTML = '<div class="wallet-box"><strong>W3M settlement status</strong><div class="info" id="w3mSafeNote">A previous wallet submission is awaiting server reconciliation.</div><button id="w3mSafeVerify" class="btn primary">Verify settlement</button></div>';
        wireVerify(client);
      }
      return;
    }

    const userResult = await client.auth.getUser();
    const user = userResult?.data?.user;
    const profileResult = user
      ? await client.from("profiles").select("wallet_address,wallet_verified,role").eq("id", user.id).maybeSingle()
      : { data: null };
    const profile = profileResult.data;
    const signerResult = await client.from("deal_multisig_signers")
      .select("wallet_address,signature_status")
      .eq("deal_id", DEAL_ID).eq("safe_tx_hash", tx.safe_tx_hash)
      .eq("signature_status", "signed");
    const signers = signerResult.data || [];
    const signedCount = signers.length;
    const signedByCurrent = signers.some((row) =>
      String(row.wallet_address || "").toLowerCase() ===
      String(profile?.wallet_address || "").toLowerCase()
    );

    if (pending) {
      box.innerHTML = '<div class="wallet-box" style="background:#eff6ff;border-color:#bfdbfe;color:#1e40af"><strong>W3M Safe settlement · awaiting verification</strong><div class="info" id="w3mSafeNote">' +
        (pending.state === "SUBMITTED_UNRECORDED"
          ? "The wallet returned a transaction hash, but it is not yet registered on the server. Retry registration; do not send another Safe transaction."
          : "Transaction hash is recorded as unverified. The server must confirm the canonical BNB receipt and exact seller/platform transfers.") +
        '</div><div class="info" style="margin-top:6px">Transaction: <code>' + esc(pending.transactionHash) + '</code></div>' +
        (pending.state === "SUBMITTED_UNRECORDED"
          ? '<button id="w3mSafeRetry" class="btn primary">Retry transaction-hash registration</button>'
          : '<button id="w3mSafeVerify" class="btn primary">Verify & finalize</button>') +
        '</div>';
      if (pending.state === "SUBMITTED_UNRECORDED") wireRetry(client);
      else wireVerify(client);
      return;
    }

    const signerRows = signers.map((row) => "✓ " + esc(row.wallet_address)).join("<br>");
    const safeHash = esc(tx.safe_tx_hash);
    if (signedCount >= 2) {
      box.innerHTML = '<div class="wallet-box" style="background:#f0fdf4;border-color:#bbf7d0;color:#166534"><strong>W3M Safe Release · 2/2 signatures ✓</strong><div class="info" style="margin-top:6px">W3M will recheck the PASS report, immutable buyer/seller agreement, payment, delivery, dispute state, Safe owners and nonce before issuing a short-lived wallet package.</div><div class="info" style="margin-top:6px">Safe transaction hash: <code style="word-break:break-all">' + safeHash + '</code></div><div class="info" style="margin-top:6px">' + signerRows + '</div><button id="w3mSafeExecute" class="btn primary">Execute through connected Safe wallet</button><div id="w3mSafeNote" class="info" style="margin-top:6px">The connected verified owner wallet submits the transaction and pays BNB gas. No server-held key or relayer is used.</div></div>';
      const execute = document.querySelector("#w3mSafeExecute");
      const note = document.querySelector("#w3mSafeNote");
      execute.onclick = async () => {
        execute.disabled = true;
        execute.textContent = "Requesting W3M package…";
        try {
          const session = await getSession(client);
          await ensureBnb(window.ethereum);
          const result = await executeW3MDealReleaseFromWallet({
            provider: window.ethereum,
            dealId: DEAL_ID,
            accessToken: session.access_token,
            apiKey: API_KEY,
            supabaseUrl: SB_URL,
          });
          savePending(result);
          if (note) note.textContent = result.state === "SUBMITTED_UNRECORDED"
            ? "Wallet returned a transaction hash, but the server did not record it. Use Retry transaction-hash registration; do not send again."
            : "✓ Transaction hash received and recorded as unverified. Next step: independent receipt verification.";
          await render();
        } catch (error) {
          if (note) note.textContent = "W3M execution blocked: " + String(error?.message || error);
          execute.disabled = false;
          execute.textContent = "Execute through connected Safe wallet";
        }
      };
      return;
    }

    box.innerHTML = '<div class="wallet-box" style="background:#f0fdf4;border-color:#bbf7d0;color:#166534"><strong>W3M Safe Release · ' + signedCount + ' / 2 signatures</strong><div class="info" style="margin-top:6px">Safe transaction hash: <code style="word-break:break-all">' + safeHash + '</code></div><div class="info" style="margin-top:6px">' + signerRows + '</div>' +
      (signedByCurrent ? '<div class="notice" style="margin-top:8px">Your signature is recorded. Waiting for the other owner.</div>' :
        '<button id="w3mSafeSign" class="btn primary">Sign exact Safe transaction</button><div id="w3mSafeNote" class="info" style="margin-top:6px">Free EIP-712 signature only. No funds move during signing.</div>') +
      '</div>';

    const sign = document.querySelector("#w3mSafeSign");
    if (!sign) return;
    const note = document.querySelector("#w3mSafeNote");
    sign.onclick = async () => {
      sign.disabled = true;
      sign.textContent = "Opening verified wallet…";
      try {
        if (!profile?.wallet_verified || !profile?.wallet_address) {
          throw new Error("Your Web3Market wallet is not verified.");
        }
        if (!window.ethereum || !window.ethers) {
          throw new Error("Open this Deal Room inside your connected wallet browser.");
        }
        await ensureBnb(window.ethereum);
        const provider = new window.ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const transaction = {
          to: tx.to_address,
          value: String(tx.value_wei),
          data: tx.data,
          operation: Number(tx.operation),
          safeTxGas: String(tx.safe_tx_gas),
          baseGas: String(tx.base_gas),
          gasPrice: String(tx.gas_price),
          gasToken: window.ethers.getAddress(tx.gas_token || ZERO),
          refundReceiver: window.ethers.getAddress(tx.refund_receiver || ZERO),
          nonce: String(tx.safe_nonce),
        };
        const session = await getSession(client);
        const result = await signW3MSafeRelease({
          signer,
          ethers: window.ethers,
          dealId: DEAL_ID,
          safeAddress: window.ethers.getAddress(tx.safe_address),
          safeTransactionHash: tx.safe_tx_hash,
          transaction,
          expectedWallet: profile.wallet_address,
          accessToken: session.access_token,
          apiKey: API_KEY,
          supabaseUrl: SB_URL,
        });
        if (note) note.textContent = "✓ W3M SIGN stored atomically (" + result.confirmationsCount + " / 2). Reloading…";
        await sleep(600);
        location.reload();
      } catch (error) {
        if (note) note.textContent = "W3M signing blocked: " + String(error?.message || error);
        sign.disabled = false;
        sign.textContent = "Sign exact Safe transaction";
      }
    };
  }

  function wireVerify(client) {
    const button = document.querySelector("#w3mSafeVerify");
    const note = document.querySelector("#w3mSafeNote");
    if (!button || button.dataset.w3mWired === "1") return;
    button.dataset.w3mWired = "1";
    button.onclick = async () => {
      button.disabled = true;
      button.textContent = "Verifying canonical receipt…";
      try {
        const pending = readPending();
        if (!pending?.attemptId) throw new Error("W3M execution attempt is missing in this browser session.");
        const session = await getSession(client);
        const result = await verifyW3MDealReleaseFromServer({
          attemptId: pending.attemptId,
          accessToken: session.access_token,
          apiKey: API_KEY,
          supabaseUrl: SB_URL,
        });
        if (result.state === "CONFIRMED" && result.finalized === true) {
          clearPending();
          if (note) note.textContent = "✓ W3M verified the canonical Safe receipt and finalized the exact deal.";
          await sleep(700);
          location.reload();
          return;
        }
        if (note) note.textContent = "Still pending or blocked: the server has not yet confirmed the required canonical receipt, confirmations and exact transfers. You may check again later.";
        button.disabled = false;
        button.textContent = "Check verification again";
      } catch (error) {
        if (note) note.textContent = "Verification request failed: " + String(error?.message || error);
        button.disabled = false;
        button.textContent = "Check verification again";
      }
    };
  }

  function wireRetry(client) {
    const button = document.querySelector("#w3mSafeRetry");
    const note = document.querySelector("#w3mSafeNote");
    if (!button || button.dataset.w3mWired === "1") return;
    button.dataset.w3mWired = "1";
    button.onclick = async () => {
      button.disabled = true;
      button.textContent = "Registering existing hash…";
      try {
        const pending = readPending();
        if (!pending?.attemptId || !pending?.packageHash || !pending?.transactionHash) {
          throw new Error("The original W3M attempt and transaction hash are not available in this browser session.");
        }
        const session = await getSession(client);
        const result = await recordW3MSafeWalletSubmission({
          attemptId: pending.attemptId,
          packageHash: pending.packageHash,
          transactionHash: pending.transactionHash,
          accessToken: session.access_token,
          apiKey: API_KEY,
          supabaseUrl: SB_URL,
        });
        savePending(result);
        if (note) note.textContent = result.state === "SUBMITTED_UNRECORDED"
          ? "Hash registration is still unavailable. Keep this tab open and retry; do not submit another Safe transaction."
          : "✓ Existing transaction hash is recorded. Continue with independent receipt verification.";
        await render();
      } catch (error) {
        if (note) note.textContent = "Hash registration failed: " + String(error?.message || error);
        button.disabled = false;
        button.textContent = "Retry transaction-hash registration";
      }
    };
  }

  async function boot() {
    if (!DEAL_ID) return;
    const client = await getClient();
    if (!client) return;
    await wireFallback(client);
    await render();
  }

  boot().catch((error) => console.error("W3M Deal Room integration", error));
})();
