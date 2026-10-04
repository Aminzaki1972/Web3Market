const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("W3MTokenTestnet", function () {
  const TOTAL_SUPPLY = ethers.parseUnits("1000000000", 18);
  async function deploy() {
    const [deployer, holder, recipient] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("W3MTokenTestnet");
    const token = await Token.deploy(holder.address);
    await token.waitForDeployment();
    return { token, deployer, holder, recipient };
  }
  it("sets name, symbol and decimals", async function () {
    const { token } = await deploy();
    expect(await token.name()).to.equal("Web3Market Token");
    expect(await token.symbol()).to.equal("W3M");
    expect(await token.decimals()).to.equal(18);
  });
  it("mints exactly 1 billion W3M once", async function () {
    const { token, holder } = await deploy();
    expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY);
    expect(await token.balanceOf(holder.address)).to.equal(TOTAL_SUPPLY);
  });
  it("has no mint function", async function () {
    const { token } = await deploy();
    expect(token.mint).to.equal(undefined);
  });
  it("has zero transfer tax", async function () {
    const { token, holder, recipient } = await deploy();
    const amount = ethers.parseUnits("1000", 18);
    await expect(token.connect(holder).transfer(recipient.address, amount)).to.not.be.reverted;
    expect(await token.balanceOf(recipient.address)).to.equal(amount);
  });
  it("rejects zero initial holder", async function () {
    const Token = await ethers.getContractFactory("W3MTokenTestnet");
    await expect(Token.deploy(ethers.ZeroAddress)).to.be.revertedWith("Invalid initial holder");
  });
});
