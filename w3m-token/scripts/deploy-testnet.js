const { ethers } = require("hardhat");

async function main() {
  const initialHolder = process.env.INITIAL_HOLDER || "0x9A6f4ED3c390734d857dFe24Ecb408A20a349017";
  if (!ethers.isAddress(initialHolder)) throw new Error("Invalid initial holder");
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Initial holder:", initialHolder);
  const Token = await ethers.getContractFactory("W3MTokenTestnet");
  const token = await Token.deploy(initialHolder);
  await token.waitForDeployment();
  console.log("W3M Testnet contract:", await token.getAddress());
  console.log("Total supply:", ethers.formatUnits(await token.totalSupply(), 18));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
