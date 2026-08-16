/* =========================================================
   Web3Market
   File: js/wallet.js
   Wallet Connection & Ownership Verification
   Version: 1.0
   ========================================================= */

"use strict";

(function () {

    /* =====================================================
       CONFIGURATION
       ===================================================== */

    const Web3MarketWallet = {

        version: "1.0.0",

        connected: false,

        address: null,

        chainId: null,

        provider: null,

        initialized: false,

        verifying: false

    };


    /* =====================================================
       CONSTANTS
       ===================================================== */

    const SIGN_MESSAGE =
        "Web3Market Wallet Verification\n\n" +
        "I confirm that I own this wallet address " +
        "and I want to connect it to my Web3Market account.\n\n" +
        "This signature does not authorize any blockchain transaction.";


    /* =====================================================
       GET PROVIDER
       ===================================================== */

    function getProvider() {

        if (
            typeof window === "undefined"
        ) {
            return null;
        }

        if (
            !window.ethereum
        ) {
            return null;
        }

        return window.ethereum;
    }


    /* =====================================================
       CHECK WALLET AVAILABILITY
       ===================================================== */

    function isAvailable() {

        return Boolean(
            getProvider()
        );
    }


    /* =====================================================
       SHORT ADDRESS
       ===================================================== */

    function shortAddress(
        address
    ) {

        if (!address) {
            return "";
        }

        const value =
            String(address);

        if (
            value.length <= 12
        ) {
            return value;
        }

        return (
            value.substring(0, 6) +
            "..." +
            value.substring(
                value.length - 4
            )
        );
    }


    /* =====================================================
       NORMALIZE ADDRESS
       ===================================================== */

    function normalizeAddress(
        address
    ) {

        if (!address) {
            return null;
        }

        return String(
            address
        ).trim();
    }


    /* =====================================================
       GET ACCOUNTS
       ===================================================== */

    async function getAccounts() {

        const provider =
            getProvider();

        if (!provider) {
            return [];
        }

        try {

            const accounts =
                await provider.request({
                    method: "eth_accounts"
                });

            return Array.isArray(accounts)
                ? accounts
                : [];

        } catch (error) {

            console.error(
                "Web3Market Wallet: unable to read accounts:",
                error
            );

            return [];
        }
    }


    /* =====================================================
       GET CHAIN ID
       ===================================================== */

    async function getChainId() {

        const provider =
            getProvider();

        if (!provider) {
            return null;
        }

        try {

            return await provider.request({
                method: "eth_chainId"
            });

        } catch (error) {

            console.error(
                "Web3Market Wallet: unable to read chain:",
                error
            );

            return null;
        }
    }


    /* =====================================================
       SET WALLET STATE
       ===================================================== */

    function setWalletState(
        address,
        chainId = null
    ) {

        const normalized =
            normalizeAddress(
                address
            );

        Web3MarketWallet.address =
            normalized;

        Web3MarketWallet.chainId =
            chainId;

        Web3MarketWallet.connected =
            Boolean(
                normalized
            );


        /*
         * Keep app.js state synchronized.
         */

        if (
            window.Web3MarketApp &&
            typeof
            window.Web3MarketApp.setWalletState ===
            "function"
        ) {

            window.Web3MarketApp.setWalletState(
                normalized
            );
        }


        /*
         * Dispatch global event.
         */

        dispatchWalletEvent();
    }


    /* =====================================================
       DISPATCH WALLET EVENT
       ===================================================== */

    function dispatchWalletEvent() {

        try {

            window.dispatchEvent(
                new CustomEvent(
                    "web3market:wallet",
                    {
                        detail: {

                            address:
                                Web3MarketWallet.address,

                            shortAddress:
                                shortAddress(
                                    Web3MarketWallet.address
                                ),

                            chainId:
                                Web3MarketWallet.chainId,

                            connected:
                                Web3MarketWallet.connected

                        }
                    }
                )
            );

        } catch (error) {

            console.warn(
                "Web3Market Wallet event error:",
                error
            );
        }
    }


    /* =====================================================
       CONNECT WALLET
       ===================================================== */

    async function connect() {

        const provider =
            getProvider();

        if (!provider) {

            showMessage(
                "No compatible Web3 wallet was detected. Please install MetaMask or another EVM wallet.",
                "warning"
            );

            return {
                success: false,
                error: "WALLET_NOT_FOUND"
            };
        }


        if (
            Web3MarketWallet.verifying
        ) {

            return {
                success: false,
                error: "VERIFICATION_IN_PROGRESS"
            };
        }


        try {

            const accounts =
                await provider.request({
                    method:
                        "eth_requestAccounts"
                });


            if (
                !Array.isArray(accounts) ||
                !accounts.length
            ) {

                throw new Error(
                    "No wallet account was returned."
                );
            }


            const address =
                normalizeAddress(
                    accounts[0]
                );


            const chainId =
                await getChainId();


            setWalletState(
                address,
                chainId
            );


            showMessage(
                "Wallet connected: " +
                shortAddress(address),
                "success"
            );


            return {

                success: true,

                address:
                    address,

                chainId:
                    chainId

            };

        } catch (error) {

            console.error(
                "Web3Market Wallet connection error:",
                error
            );


            if (
                error &&
                Number(error.code) ===
                4001
            ) {

                showMessage(
                    "Wallet connection was rejected.",
                    "warning"
                );

            } else {

                showMessage(
                    error?.message ||
                    "Unable to connect wallet.",
                    "error"
                );
            }


            return {

                success: false,

                error:
                    error?.message ||
                    "WALLET_CONNECTION_FAILED"

            };
        }
    }


    /* =====================================================
       SIGN OWNERSHIP MESSAGE
       ===================================================== */

    async function signOwnershipMessage(
        address
    ) {

        const provider =
            getProvider();

        if (!provider) {

            throw new Error(
                "Web3 wallet is not available."
            );
        }


        const walletAddress =
            normalizeAddress(
                address ||
                Web3MarketWallet.address
            );


        if (!walletAddress) {

            throw new Error(
                "No wallet address is connected."
            );
        }


        /*
         * personal_sign requests a cryptographic
         * signature only.
         *
         * It does NOT transfer funds.
         */

        const signature =
            await provider.request({

                method:
                    "personal_sign",

                params: [

                    SIGN_MESSAGE,

                    walletAddress

                ]

            });


        if (!signature) {

            throw new Error(
                "No signature was returned."
            );
        }


        return signature;
    }


    /* =====================================================
       VERIFY WALLET OWNERSHIP
       ===================================================== */

    async function verifyOwnership() {

        if (
            Web3MarketWallet.verifying
        ) {

            return {
                success: false,
                error: "VERIFICATION_IN_PROGRESS"
            };
        }


        const provider =
            getProvider();


        if (!provider) {

            showMessage(
                "Please connect a compatible Web3 wallet first.",
                "warning"
            );

            return {
                success: false,
                error: "WALLET_NOT_FOUND"
            };
        }


        let address =
            Web3MarketWallet.address;


        /*
         * If the internal state is empty,
         * read the currently connected account.
         */

        if (!address) {

            const accounts =
                await getAccounts();

            if (
                accounts.length
            ) {

                address =
                    normalizeAddress(
                        accounts[0]
                    );

            }
        }


        if (!address) {

            const result =
                await connect();

            if (
                !result.success
            ) {

                return result;
            }

            address =
                result.address;
        }


        Web3MarketWallet.verifying =
            true;


        try {

            showMessage(
                "Please sign the verification message in your wallet. No funds will be transferred.",
                "info"
            );


            const signature =
                await signOwnershipMessage(
                    address
                );


            /*
             * The signature itself proves control
             * of the wallet when verified cryptographically.
             *
             * For production account linking,
             * the backend should verify this signature
             * before marking the wallet as verified.
             */

            const result = {

                success: true,

                address:
                    address,

                signature:
                    signature,

                message:
                    SIGN_MESSAGE

            };


            /*
             * Store only non-sensitive verification
             * information locally.
             *
             * NEVER store private keys or seed phrases.
             */

            try {

                localStorage.setItem(
                    "web3market_wallet",
                    JSON.stringify({

                        address:
                            address,

                        verified:
                            true

                    })
                );

            } catch (storageError) {

                console.warn(
                    "Web3Market Wallet local storage error:",
                    storageError
                );
            }


            dispatchVerificationEvent(
                result
            );


            showMessage(
                "Wallet ownership signature completed successfully.",
                "success"
            );


            return result;

        } catch (error) {

            console.error(
                "Web3Market Wallet verification error:",
                error
            );


            if (
                error &&
                Number(error.code) ===
                4001
            ) {

                showMessage(
                    "Wallet signature was rejected.",
                    "warning"
                );

            } else {

                showMessage(
                    error?.message ||
                    "Wallet verification failed.",
                    "error"
                );
            }


            return {

                success: false,

                error:
                    error?.message ||
                    "WALLET_VERIFICATION_FAILED"

            };

        } finally {

            Web3MarketWallet.verifying =
                false;
        }
    }


    /* =====================================================
       VERIFICATION EVENT
       ===================================================== */

    function dispatchVerificationEvent(
        result
    ) {

        try {

            window.dispatchEvent(
                new CustomEvent(
                    "web3market:wallet-verified",
                    {
                        detail:
                            result
                    }
                )
            );

        } catch (error) {

            console.warn(
                "Web3Market Wallet verification event error:",
                error
            );
        }
    }


    /* =====================================================
       DISCONNECT LOCAL STATE
       ===================================================== */

    function disconnect() {

        /*
         * Most injected wallets do not expose a
         * universal programmatic disconnect method.
         *
         * We therefore clear Web3Market's local state.
         */

        setWalletState(
            null,
            null
        );


        try {

            localStorage.removeItem(
                "web3market_wallet"
            );

        } catch (error) {

            console.warn(
                "Web3Market Wallet storage cleanup error:",
                error
            );
        }


        showMessage(
            "Wallet disconnected from Web3Market.",
            "info"
        );


        return true;
    }


    /* =====================================================
       RESTORE STATE
       ===================================================== */

    async function restore() {

        const provider =
            getProvider();

        if (!provider) {
            return false;
        }


        try {

            const accounts =
                await getAccounts();


            if (
                accounts.length
            ) {

                const chainId =
                    await getChainId();


                setWalletState(
                    accounts[0],
                    chainId
                );


                return true;
            }


            setWalletState(
                null,
                null
            );


            return false;

        } catch (error) {

            console.warn(
                "Web3Market Wallet restore error:",
                error
            );

            return false;
        }
    }


    /* =====================================================
       WALLET EVENTS
       ===================================================== */

    function setupListeners() {

        const provider =
            getProvider();

        if (!provider) {
            return;
        }


        if (
            provider.__web3marketListenersInstalled
        ) {

            return;
        }


        provider.__web3marketListenersInstalled =
            true;


        provider.on(
            "accountsChanged",
            async function (
                accounts
            ) {

                if (
                    Array.isArray(accounts) &&
                    accounts.length
                ) {

                    const chainId =
                        await getChainId();


                    setWalletState(
                        accounts[0],
                        chainId
                    );

                } else {

                    setWalletState(
                        null,
                        null
                    );
                }
            }
        );


        provider.on(
            "chainChanged",
            async function (
                chainId
            ) {

                Web3MarketWallet.chainId =
                    chainId;


                const accounts =
                    await getAccounts();


                if (
                    accounts.length
                ) {

                    setWalletState(
                        accounts[0],
                        chainId
                    );

                } else {

                    setWalletState(
                        null,
                        chainId
                    );
                }
            }
        );
    }


    /* =====================================================
       GET STATE
       ===================================================== */

    function getState() {

        return {

            connected:
                Web3MarketWallet.connected,

            address:
                Web3MarketWallet.address,

            shortAddress:
                shortAddress(
                    Web3MarketWallet.address
                ),

            chainId:
                Web3MarketWallet.chainId,

            verifying:
                Web3MarketWallet.verifying

        };
    }


    /* =====================================================
       UI MESSAGE
       ===================================================== */

    function showMessage(
        message,
        type = "info"
    ) {

        if (
            window.Web3MarketApp &&
            typeof
            window.Web3MarketApp.showMessage ===
            "function"
        ) {

            window.Web3MarketApp.showMessage(
                message,
                type
            );

            return;
        }


        const box =
            document.getElementById(
                "web3market-message"
            );


        if (!box) {

            console.log(
                "Web3Market:",
                message
            );

            return;
        }


        box.textContent =
            String(message || "");


        box.style.display =
            "block";


        setTimeout(
            function () {

                box.style.display =
                    "none";

            },
            5000
        );
    }


    /* =====================================================
       INITIALIZE
       ===================================================== */

    async function init() {

        if (
            Web3MarketWallet.initialized
        ) {

            return;
        }


        Web3MarketWallet.initialized =
            true;


        const provider =
            getProvider();


        if (!provider) {

            console.log(
                "Web3Market: no Web3 wallet detected."
            );

            return;
        }


        Web3MarketWallet.provider =
            provider;


        setupListeners();

        await restore();


        console.log(
            "Web3Market Wallet initialized."
        );
    }


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.Web3MarketWallet = {

        version:
            Web3MarketWallet.version,

        init:
            init,

        connect:
            connect,

        disconnect:
            disconnect,

        verifyOwnership:
            verifyOwnership,

        signOwnershipMessage:
            signOwnershipMessage,

        getAccounts:
            getAccounts,

        getChainId:
            getChainId,

        getState:
            getState,

        isAvailable:
            isAvailable,

        shortAddress:
            shortAddress
    };


    /* =====================================================
       START
       ===================================================== */

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            init,
            {
                once: true
            }
        );

    } else {

        init();
    }

})();
