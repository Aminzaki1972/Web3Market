require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
module.exports = {
  solidity: "0.8.24",
  networks: {
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC || "https://bsc-testnet-dataseed.bnbchain.org",
      chainId: 97,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : []
    }
  }
};
