/* =========================================================
   Web3Market - Wallet Connection & Ownership Verification
   Fixed: expose current wallet address to register.html
   ========================================================= */

"use strict";

(function () {

    const SIGN_MESSAGE =
        "Web3Market Wallet Verification\n\n" +
        "I confirm that I own this wallet address and I want to connect it to my Web3Market account.\n\n" +
        "This signature does not authorize any blockchain transaction.";

    const state = {
        version: "1.1.0",
        connected: false,
        address: null,
        chainId: null,
        provider: null,
        initialized: false,
        verifying: false
    };

    function provider() {
        return typeof window !== "undefined" && window.ethereum
            ? window.ethereum
            : null;
    }

    function normalize(address) {
        return address ? String(address).trim() : null;
    }

    function shortAddress(address) {
        const value = normalize(address);
        if (!value) return "";
        return value.length <= 12
            ? value
            : value.slice(0, 6) + "..." + value.slice(-4);
    }

    function isAvailable() {
        return Boolean(provider());
    }

    async function getAccounts() {
        const p = provider();
        if (!p) return [];
        try {
            const accounts = await p.request({ method: "eth_accounts" });
            return Array.isArray(accounts) ? accounts : [];
        } catch (error) {
            console.error("Web3Market Wallet: unable to read accounts:", error);
            return [];
        }
    }

    async function getChainId() {
        const p = provider();
        if (!p) return null;
        try {
            return await p.request({ method: "eth_chainId" });
        } catch (error) {
            console.error("Web3Market Wallet: unable to read chain:", error);
            return null;
        }
    }

    function dispatchWalletEvent() {
        window.dispatchEvent(new CustomEvent("web3market:wallet", {
            detail: {
                address: state.address,
                shortAddress: shortAddress(state.address),
                chainId: state.chainId,
                connected: state.connected
            }
        }));
    }

    function setState(address, chainId) {
        state.address = normalize(address);
        state.chainId = chainId || null;
        state.connected = Boolean(state.address);

        if (window.Web3MarketApp && typeof window.Web3MarketApp.setWalletState === "function") {
            window.Web3MarketApp.setWalletState(state.address);
        }

        dispatchWalletEvent();
    }

    function showMessage(message, type) {
        if (window.Web3MarketApp && typeof window.Web3MarketApp.showMessage === "function") {
            window.Web3MarketApp.showMessage(message, type || "info");
            return;
        }
        const box = document.getElementById("web3market-message");
        if (!box) return;
        box.textContent = String(message || "");
        box.style.display = "block";
        setTimeout(() => { box.style.display = "none"; }, 5000);
    }

    async function connect() {
        const p = provider();
        if (!p) {
            showMessage("No compatible Web3 wallet was detected. Please install MetaMask or another EVM wallet.", "warning");
            return { success: false, error: "WALLET_NOT_FOUND" };
        }

        try {
            const accounts = await p.request({ method: "eth_requestAccounts" });
            if (!Array.isArray(accounts) || !accounts.length) {
                throw new Error("No wallet account was returned.");
            }
            const address = normalize(accounts[0]);
            const chainId = await getChainId();
            setState(address, chainId);
            showMessage("Wallet connected: " + shortAddress(address), "success");
            return { success: true, address, chainId };
        } catch (error) {
            console.error("Web3Market Wallet connection error:", error);
            showMessage(Number(error && error.code) === 4001 ? "Wallet connection was rejected." : (error.message || "Unable to connect wallet."), Number(error && error.code) === 4001 ? "warning" : "error");
            return { success: false, error: error.message || "WALLET_CONNECTION_FAILED" };
        }
    }

    async function ensureCurrentAddress() {
        let address = state.address;
        if (address) return address;

        const accounts = await getAccounts();
        if (accounts.length) {
            address = normalize(accounts[0]);
            setState(address, await getChainId());
            return address;
        }

        return null;
    }

    function getAddress() {
        return state.address;
    }

    async function signOwnershipMessage(address) {
        const p = provider();
        if (!p) throw new Error("Web3 wallet is not available.");

        const walletAddress = normalize(address) || await ensureCurrentAddress();
        if (!walletAddress) throw new Error("No wallet address is connected.");

        const signature = await p.request({
            method: "personal_sign",
            params: [SIGN_MESSAGE, walletAddress]
        });

        if (!signature) throw new Error("No signature was returned.");
        return signature;
    }

    async function verifyOwnership() {
        if (state.verifying) return { success: false, error: "VERIFICATION_IN_PROGRESS" };
        if (!provider()) return { success: false, error: "WALLET_NOT_FOUND" };

        const address = await ensureCurrentAddress();
        if (!address) {
            showMessage("Please connect a compatible Web3 wallet first.", "warning");
            return { success: false, error: "WALLET_NOT_CONNECTED" };
        }

        state.verifying = true;
        try {
            showMessage("Please sign the verification message in your wallet. No funds will be transferred.", "info");
            const signature = await signOwnershipMessage(address);
            const result = { success: true, address, signature, message: SIGN_MESSAGE };

            try {
                localStorage.setItem("web3market_wallet", JSON.stringify({ address, verified: true }));
            } catch (error) {
                console.warn("Web3Market Wallet storage warning:", error);
            }

            window.dispatchEvent(new CustomEvent("web3market:wallet-verified", { detail: result }));
            showMessage("Wallet ownership signature completed successfully.", "success");
            return result;
        } catch (error) {
            console.error("Web3Market Wallet verification error:", error);
            const rejected = Number(error && error.code) === 4001;
            showMessage(rejected ? "Wallet signature was rejected." : (error.message || "Wallet verification failed."), rejected ? "warning" : "error");
            return { success: false, error: error.message || "WALLET_VERIFICATION_FAILED" };
        } finally {
            state.verifying = false;
        }
    }

    function disconnect() {
        setState(null, null);
        try { localStorage.removeItem("web3market_wallet"); } catch (_) {}
        showMessage("Wallet disconnected from Web3Market.", "info");
        return true;
    }

    async function restore() {
        const p = provider();
        if (!p) return false;
        const accounts = await getAccounts();
        if (!accounts.length) {
            setState(null, null);
            return false;
        }
        setState(accounts[0], await getChainId());
        return true;
    }

    function setupListeners() {
        const p = provider();
        if (!p || p.__web3marketListenersInstalled) return;
        p.__web3marketListenersInstalled = true;

        p.on("accountsChanged", async (accounts) => {
            if (Array.isArray(accounts) && accounts.length) {
                setState(accounts[0], await getChainId());
            } else {
                setState(null, null);
            }
        });

        p.on("chainChanged", async (chainId) => {
            const accounts = await getAccounts();
            setState(accounts.length ? accounts[0] : null, chainId);
        });
    }

    async function init() {
        if (state.initialized) return;
        state.initialized = true;
        state.provider = provider();
        if (!state.provider) return;
        setupListeners();
        await restore();
        console.log("Web3Market Wallet initialized.");
    }

    window.Web3MarketWallet = {
        version: state.version,
        init,
        connect,
        disconnect,
        verifyOwnership,
        signOwnershipMessage,
        getAccounts,
        getChainId,
        getAddress,
        getState: () => ({
            connected: state.connected,
            address: state.address,
            shortAddress: shortAddress(state.address),
            chainId: state.chainId,
            verifying: state.verifying
        }),
        isAvailable,
        shortAddress
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }

})();
