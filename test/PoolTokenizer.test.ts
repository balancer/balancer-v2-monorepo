import { ethers } from "@nomiclabs/buidler";
const { expect } = require("chai");
import { ContractFactory, Contract, Signer } from "ethers";

const { BigNumber } = ethers;
const TTOKEN_DECIMALS = 3

const fromTokenUnits = (num: string) => {
  const power = BigNumber.from(10).pow(TTOKEN_DECIMALS)
  const scaled = parseFloat(num)
  return BigNumber.from(scaled).mul(BigNumber.from(power))
}

describe("PoolTokenizer", function() {
  let deployer: Signer
  let admin: Signer
  let user1: Signer
  let user2: Signer
  let adminAddress: string, user1Address: string, user2Address: string;
  let poolID: string
  let vault: Contract
  let tokenizer: Contract;

  beforeEach(async function() {
    [deployer, admin, user1, user2] = await ethers.getSigners();

    adminAddress = await admin.getAddress()
    user1Address = await user1.getAddress()
    user2Address = await user2.getAddress()

    const Vault: ContractFactory = await ethers.getContractFactory("MockVault");
    const Tokenizer: ContractFactory = await ethers.getContractFactory("PoolTokenizer");

    // returns bytes32 hash of string, alternatively use keccax256(binaryData)
    poolID = ethers.utils.id('Test')

    vault = await Vault.deploy();
    await vault.deployed();

    tokenizer = await Tokenizer.deploy(vault.address, poolID);
    await tokenizer.deployed();
    await tokenizer.setOwner(adminAddress)
    tokenizer = tokenizer.connect(admin)
    vault = vault.connect(admin)

    await vault.createPool(poolID)
  })

  it("Should give your Tokenizer sole proprietorship", async function() {
    let [returnedController, returnedSwapFee, returnedSwapPublic] = await vault.pools(poolID);
    expect(returnedController).to.equal(await admin.getAddress());

    await vault.setController(poolID, tokenizer.address)

    let [returnedController2, returnedSwapFee2, returnedSwapPublic2] = await vault.pools(poolID)
    expect(returnedController2).to.equal(tokenizer.address);

    // can now set swap fee through tokenizer
    await tokenizer.setSwapFee(123)
    let [returnedController3, returnedSwapFee3, returnedSwapPublic3] = await vault.pools(poolID)
    expect(returnedSwapFee3).to.equal(123);
  });

  describe("with tokens and a tokenizer", () => {
    let weth: Contract, dai: Contract;
    let WETH: string, DAI: string;
    beforeEach(async () => {
      const TToken: ContractFactory = await ethers.getContractFactory("TToken");
      weth = await TToken.deploy('Wrapped Ether', 'WETH', TTOKEN_DECIMALS);
      dai = await TToken.deploy('Dai Stablecoin', 'DAI', TTOKEN_DECIMALS);

      await weth.deployed()
      await dai.deployed()

      WETH = weth.address;
      DAI = dai.address;

      //Admin balances
      await weth.mint(adminAddress, fromTokenUnits('100'));
      await dai.mint(adminAddress, fromTokenUnits('100'));

      // User1 balances
      await weth.mint(user1Address, fromTokenUnits('25'));
      await dai.mint(user1Address, fromTokenUnits('40000'));

      // User2 balances
      await weth.mint(user2Address, fromTokenUnits('12'));
      await dai.mint(user2Address, fromTokenUnits('0'));

      await vault.setController(poolID, tokenizer.address)

      weth = weth.connect(admin)
      await weth.approve(tokenizer.address, fromTokenUnits('1000'));
      dai = dai.connect(admin)
      await dai.approve(tokenizer.address, fromTokenUnits('1000'));
    })

    it("Should let you initialize a pool", async () => {
      weth = weth.connect(admin)
      await weth.approve(tokenizer.address, fromTokenUnits('1000'));
      dai = dai.connect(admin)
      await dai.approve(tokenizer.address, fromTokenUnits('1000'));

      // Admin inits pool
      tokenizer = tokenizer.connect(admin)
      await tokenizer.initPool(100, [WETH, DAI], [fromTokenUnits('20'), fromTokenUnits('30')])
      let bpt = await tokenizer.balanceOf(adminAddress)
      expect(bpt.toNumber()).to.equal(100)
    })
    describe("with an initialized pool", () => {
      beforeEach(async () => {
        // Admin inits pool
        tokenizer = tokenizer.connect(admin)
        await tokenizer.initPool(100, [WETH, DAI], [fromTokenUnits('20'), fromTokenUnits('30')])
      })

      it("Should allow you to join a pool", async () => {
        weth = weth.connect(user1)
        await weth.approve(tokenizer.address, fromTokenUnits('1000'));
        dai = dai.connect(user1)
        await dai.approve(tokenizer.address, fromTokenUnits('1000'));

        // User 1 joins pool
        tokenizer = tokenizer.connect(user1)
        await tokenizer.joinPool(50, [fromTokenUnits('15'), fromTokenUnits('25')])
        let bpt = await tokenizer.balanceOf(user1Address)
        expect(bpt.toNumber()).to.equal(50)
      })

      it("Should not allow you to join a pool when maxAmountIn is too low", async () => {
        tokenizer = tokenizer.connect(user1)
        await expect(tokenizer.joinPool(50, [fromTokenUnits('5'), fromTokenUnits('5')])).to.be.revertedWith('ERR_LIMIT_IN')
      })

      describe('as a member of an initialized pool', async () => {
        it('Should allow you to exit a pool', async () => {
          // admin withdraws half their balance
          await tokenizer.exitPool(50, [fromTokenUnits('10'), fromTokenUnits('15')])
          let bpt = await tokenizer.balanceOf(adminAddress)
          expect(bpt.toNumber()).to.equal(50)
        })
      })
    })
  })
});
