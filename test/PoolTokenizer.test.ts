import { ethers } from "@nomiclabs/buidler";
const { expect } = require("chai");
import { ContractFactory, Contract, Signer } from "ethers";

describe("PoolTokenizer", function() {
  let deployer: Signer
  let poolID: string
  let vault: Contract
  let tokenizer: Contract;

  beforeEach(async function() {
    let [user1] = await ethers.getSigners();

    deployer = user1;

    const Vault: ContractFactory = await ethers.getContractFactory("MockVault");
    const Tokenizer: ContractFactory = await ethers.getContractFactory("PoolTokenizer");

    // returns bytes32 hash of string, alternatively use keccax256(binaryData)
    poolID = ethers.utils.id('Test')

    vault = await Vault.deploy();
    await vault.deployed();

    tokenizer = await Tokenizer.deploy(vault.address, poolID);
    await tokenizer.deployed();

    await vault.createPool(poolID)
  })

  it("Should give your Tokenizer sole proprietorship", async function() {

    let [returnedController, returnedSwapFee, returnedSwapPublic] = await vault.pools(poolID);
    expect(returnedController).to.equal(await deployer.getAddress());

    await vault.setController(poolID, tokenizer.address)

    let [returnedController2, returnedSwapFee2, returnedSwapPublic2] = await vault.pools(poolID)
    expect(returnedController2).to.equal(tokenizer.address);

    // can now set swap fee through tokenizer
    await tokenizer.setSwapFee(123)
    let [returnedController3, returnedSwapFee3, returnedSwapPublic3] = await vault.pools(poolID)
    expect(returnedSwapFee3).to.equal(123);
  });


});
