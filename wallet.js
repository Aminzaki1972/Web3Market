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

    const Wallet = {

        initialized: false,

        connected: false,

        address: null,

        chainId: null,

        provider: null,

        signer: null,

        verifying: false

    };


    /* =====================================================
       WALLET MESSAGE
       ===================================================== */

    const SIGN_MESSAGE =
        "Web3Market Wallet Verification\n\n" +
        "Sign this message to prove ownership of this wallet address.\n\n" +
        "This signature does NOT authorize a blockchain transaction " +
        "and does NOT give Web3Market access to your funds.\n\n" +
        "Do not sign this message if you did not request wallet verification.";


    /* =====================================================
       INITIALIZATION
       ===================================================== */

    function init() {

        if (
            Wallet.initialized
        ) {

            return;
        }

        Wallet.initialized = true;

        detectProvider();

        console.log(
            "Web3Market Wallet initialized."
        );
    }


    /* =====================================================
       DETECT WALLET PROVIDER
       ===================================================== */

    function detectProvider() {

        if (
            typeof window === "undefined"
        ) {

            return null;
        }


        if (
            !window.ethereum
        ) {

            Wallet.provider = null;

            return null;
        }


        Wallet.provider =
            window.ethereum;


        setupProviderEvents();


        return Wallet.provider;
    }


    /* =====================================================
       CHECK WALLET AVAILABILITY
       ===================================================== */

    function isAvailable() {

        return Boolean(
            window.ethereum
        );
    }


    /* =====================================================
       CONNECT WALLET
       ===================================================== */

    async function connect() {

        if (
            Wallet.verifying
        ) {

            return {
                success: false,
                error:
                    "Wallet verification is already in progress."
            };
        }


        if (
            !isAvailable()
        ) {

            showMessage(
                "No Web3 wallet was detected. Please install or open a compatible wallet.",
                "error"
            );


            return {
                success: false,
                error:
                    "Wallet provider not found."
            };
        }


        try {

            Wallet.provider =
                window.ethereum;


            const accounts =
                await Wallet.provider.request(
                    {
                        method:
                            "eth_requestAccounts"
                    }
                );


            if (
                !Array.isArray(accounts) ||
                !accounts.length
            ) {

                throw new Error(
                    "No wallet account was returned."
                );
            }


            Wallet.address =
                accounts[0];


            Wallet.connected =
                true;


            Wallet.chainId =
                await getChainId();


            updateApplicationWalletState();


            showMessage(
                "Wallet connected successfully.",
                "success"
            );


            dispatchWalletEvent(
                "connected"
            );


            return {

                success: true,

                address:
                    Wallet.address,

                chainId:
                    Wallet.chainId

            };

        } catch (error) {

            console.error(
                "Web3Market wallet connection error:",
                error
            );


            Wallet.connected =
                false;

            Wallet.address =
                null;


            const message =
                getWalletErrorMessage(
                    error
                );


            showMessage(
                message,
                "error"
            );


            return {

                success: false,

                error:
                    message

            };
        }
    }


    /* =====================================================
       GET CURRENT ACCOUNTS
       ===================================================== */

    async function getAccounts() {

        if (
            !isAvailable()
        ) {

            return [];
        }


        try {

            const accounts =
                await window.ethereum.request(
                    {
                        method:
                            "eth_accounts"
                    }
                );


            return Array.isArray(
                accounts
            )
                ? accounts
                : [];

        } catch (error) {

            console.error(
                "Web3Market getAccounts error:",
                error
            );

            return [];
        }
    }


    /* =====================================================
       RESTORE EXISTING CONNECTION
       ===================================================== */

    async function restoreConnection() {

        if (
            !isAvailable()
        ) {

            return null;
        }


        try {

            const accounts =
                await getAccounts();


            if (
                !accounts.length
            ) {

                Wallet.connected =
                    false;

                Wallet.address =
                    null;

                return null;
            }


            Wallet.address =
                accounts[0];


            Wallet.connected =
                true;


            Wallet.chainId =
                await getChainId();


            updateApplicationWalletState();


            dispatchWalletEvent(
                "restored"
            );


            return {

                address:
                    Wallet.address,

                chainId:
                    Wallet.chainId

            };

        } catch (error) {

            console.error(
                "Web3Market wallet restore error:",
                error
            );

            return null;
        }
    }


    /* =====================================================
       GET CHAIN ID
       ===================================================== */

    async function getChainId() {

        if (
            !isAvailable()
        ) {

            return null;
        }


        try {

            return await window.ethereum.request(
                {
                    method:
                        "eth_chainId"
                }
            );

        } catch (error) {

            console.error(
                "Web3Market chain ID error:",
                error
            );

            return null;
        }
    }


    /* =====================================================
       SIGN OWNERSHIP MESSAGE
       ===================================================== */

    async function signOwnershipMessage() {

        if (
            !Wallet.connected ||
            !Wallet.address
        ) {

            const connection =
                await connect();


            if (
                !connection.success
            ) {

                return {
                    success: false,
                    error:
                        connection.error
                };
            }
        }


        if (
            Wallet.verifying
        ) {

            return {
                success: false,
                error:
                    "Verification is already in progress."
            };
        }


        Wallet.verifying =
            true;


        try {

            /*
             * IMPORTANT:
             *
             * This uses personal_sign only.
             *
             * It does NOT send a blockchain
             * transaction.
             *
             * It does NOT spend funds.
             */

            const signature =
                await window.ethereum.request(
                    {
                        method:
                            "personal_sign",

                        params: [
                            SIGN_MESSAGE,
                            Wallet.address
                        ]
                    }
                );


            if (
                !signature
            ) {

                throw new Error(
                    "No signature was returned."
                );
            }


            const result = {

                success: true,

                address:
                    Wallet.address,

                signature:
                    signature,

                message:
                    SIGN_MESSAGE,

                chainId:
                    Wallet.chainId

            };


            dispatchWalletEvent(
                "ownership_verified",
                result
            );


            showMessage(
                "Wallet ownership verified successfully.",
                "success"
            );


            return result;

        } catch (error) {

            console.error(
                "Web3Market wallet signature error:",
                error
            );


            const message =
                getSignatureErrorMessage(
                    error
                );


            showMessage(
                message,
                "error"
            );


            return {

                success: false,

                error:
                    message

            };

        } finally {

            Wallet.verifying =
                false;
        }
    }


    /* =====================================================
       DISCONNECT LOCAL STATE
       ===================================================== */

    function disconnect() {

        Wallet.connected =
            false;

        Wallet.address =
            null;

        Wallet.chainId =
            null;

        Wallet.signer =
            null;


        updateApplicationWalletState();


        dispatchWalletEvent(
            "disconnected"
        );


        showMessage(
            "Wallet disconnected from Web3Market.",
            "info"
        );
    }


    /* =====================================================
       PROVIDER EVENTS
       ===================================================== */

    function setupProviderEvents() {

        if (
            !window.ethereum ||
            typeof window.ethereum.on !==
                "function"
        ) {

            return;
        }


        if (
            window.ethereum.__web3marketWalletEvents
        ) {

            return;
        }


        window.ethereum.__web3marketWalletEvents =
            true;


        window.ethereum.on(
            "accountsChanged",
            function (accounts) {

                if (
                    Array.isArray(accounts) &&
                    accounts.length
                ) {

                    Wallet.address =
                        accounts[0];

                    Wallet.connected =
                        true;

                } else {

                    Wallet.address =
                        null;

                    Wallet.connected =
                        false;
                }


                updateApplicationWalletState();


                dispatchWalletEvent(
                    "accounts_changed"
                );
            }
        );


        window.ethereum.on(
            "chainChanged",
            function (chainId) {

                Wallet.chainId =
                    chainId;


                dispatchWalletEvent(
                    "chain_changed"
                );
            }
        );
    }


    /* =====================================================
       UPDATE APP.JS STATE
       ===================================================== */

    function updateApplicationWalletState() {

        if (
            window.Web3MarketApp &&
            typeof
            window.Web3MarketApp.setWalletState ===
                "function"
        ) {

            window.Web3MarketApp.setWalletState(
                Wallet.address
            );
        }


        if (
            window.Web3Market &&
            typeof
            window.Web3Market.setWalletState ===
                "function"
        ) {

            window.Web3Market.setWalletState(
                Wallet.address
            );
        }
    }


    /* =====================================================
       WALLET EVENT
       ===================================================== */

    function dispatchWalletEvent(
        type,
        extra = {}
    ) {

        try {

            window.dispatchEvent(
                new CustomEvent(
                    "web3market:wallet",
                    {
                        detail: {

                            type:
                                type,

                            address:
                                Wallet.address,

                            chainId:
                                Wallet.chainId,

                            connected:
                                Wallet.connected,

                            ...extra

                        }
                    }
                )
            );

        } catch (error) {

            console.warn(
                "Web3Market wallet event error:",
                error
            );
        }
    }


    /* =====================================================
       GET STATE
       ===================================================== */

    function getState() {

        return {

            connected:
                Wallet.connected,

            address:
                Wallet.address,

            chainId:
                Wallet.chainId,

            verifying:
                Wallet.verifying

        };
    }


    /* =====================================================
       SHORT ADDRESS
       ===================================================== */

    function shortAddress(
        address = Wallet.address
    ) {

        if (
            !address
        ) {

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
            value.slice(
                0,
                6
            ) +
            "..." +
            value.slice(
                -4
            )
        );
    }


    /* =====================================================
       ERROR HANDLING
       ===================================================== */

    function getWalletErrorMessage(
        error
    ) {

        if (
            !error
        ) {

            return "Unable to connect wallet.";
        }


        if (
            error.code === 4001
        ) {

            return (
                "Wallet connection was rejected."
            );
        }


        if (
            error.code === -32002
        ) {

            return (
                "A wallet connection request is already pending."
            );
        }


        return (
            error.message ||
            "Unable to connect wallet."
        );
    }


    function getSignatureErrorMessage(
        error
    ) {

        if (
            !error
        ) {

            return "Wallet verification failed.";
        }


        if (
            error.code === 4001
        ) {

            return (
                "You rejected the wallet verification signature."
            );
        }


        return (
            error.message ||
            "Wallet ownership verification failed."
        );
    }


    /* =====================================================
       MESSAGE
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


        console.log(
            "Web3Market:",
            message
        );
    }


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.Web3MarketWallet = {

        init:
            init,

        connect:
            connect,

        restore:
            restoreConnection,

        disconnect:
            disconnect,

        getAccounts:
            getAccounts,

        getChainId:
            getChainId,

        signOwnershipMessage:
            signOwnershipMessage,

        isAvailable:
            isAvailable,

        getState:
            getState,

        shortAddress:
            shortAddress

    };


    /* =====================================================
       AUTO INITIALIZATION
       ===================================================== */

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            async function () {

                init();

                await restoreConnection();

            },
            {
                once: true
            }
        );

    } else {

        init();

        restoreConnection();
    }

})();
