import { ethers } from '@nomiclabs/buidler';
import { expect } from 'chai';
import { ContractFactory, Contract, Signer } from 'ethers';

const { BigNumber } = ethers;
const TEST_TOKEN_DECIMALS = 3;

const fromTokenUnits = (num: string) => {
  const power = BigNumber.from(10).pow(TEST_TOKEN_DECIMALS);
  const scaled = parseFloat(num);
  return BigNumber.from(scaled).mul(BigNumber.from(power));
};

describe('OwnablePoolTokenizer', function () {
  let admin: Signer;
  let user1: Signer;
  let user2: Signer;
  let adminAddress: string, user1Address: string, user2Address: string;
  let poolId: string;
  let vault: Contract;
  let curve: Contract;
  let tokenizer: Contract;

  beforeEach(async function () {
    [, admin, user1, user2] = await ethers.getSigners();

    adminAddress = await admin.getAddress();
    user1Address = await user1.getAddress();
    user2Address = await user2.getAddress();

    const CurveFactory: ContractFactory = await ethers.getContractFactory('ConstantWeightedProdCurve');
    const VaultFactory: ContractFactory = await ethers.getContractFactory('Vault');
    const TokenizerFactory: ContractFactory = await ethers.getContractFactory('OwnablePoolTokenizer');

    // returns bytes32 hash of string, alternatively use keccax256(binaryData)
    poolId = ethers.utils.id('Test');

    const weights = [1, 1].map(BigNumber.from);
    curve = await CurveFactory.deploy(weights);
    vault = await VaultFactory.deploy();
    await vault.deployed();

    tokenizer = await TokenizerFactory.deploy(vault.address, poolId);
    await tokenizer.deployed();
    await tokenizer.setOwner(adminAddress);
    tokenizer = tokenizer.connect(admin);
    vault = vault.connect(admin);

    await vault.newPool(poolId, curve.address);
  });

  it('Should give your Tokenizer sole proprietorship', async function () {
    expect(await vault.getController(poolId)).to.equal(await admin.getAddress());

    await vault.setController(poolId, tokenizer.address);
    expect(await vault.getController(poolId)).to.equal(tokenizer.address);

    // can now set swap fee through tokenizer
    await tokenizer.setSwapFee((123e14).toString());
    expect(await vault.getSwapFee(poolId)).to.equal((123e14).toString());
  });

  describe('with tokens and a tokenizer', () => {
    let weth: Contract, dai: Contract;
    let WETH: string, DAI: string;
    beforeEach(async () => {
      const TestToken: ContractFactory = await ethers.getContractFactory('TestToken');
      weth = await TestToken.deploy('Wrapped Ether', 'WETH', TEST_TOKEN_DECIMALS);
      dai = await TestToken.deploy('Dai Stablecoin', 'DAI', TEST_TOKEN_DECIMALS);

      await weth.deployed();
      await dai.deployed();

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

      await vault.setController(poolId, tokenizer.address);

      weth = weth.connect(admin);
      await weth.approve(tokenizer.address, fromTokenUnits('1000'));
      dai = dai.connect(admin);
      await dai.approve(tokenizer.address, fromTokenUnits('1000'));
    });

    it('Should let you initialize a pool', async () => {
      weth = weth.connect(admin);
      await weth.approve(tokenizer.address, fromTokenUnits('1000'));
      dai = dai.connect(admin);
      await dai.approve(tokenizer.address, fromTokenUnits('1000'));

      // Admin inits pool
      tokenizer = tokenizer.connect(admin);
      await tokenizer.initPool(100, [WETH, DAI], [fromTokenUnits('20'), fromTokenUnits('30')]);
      expect(await tokenizer.balanceOf(adminAddress)).to.equal(100);
    });
    describe('with an initialized pool', () => {
      beforeEach(async () => {
        // Admin inits pool
        tokenizer = tokenizer.connect(admin);
        await tokenizer.initPool(100, [WETH, DAI], [fromTokenUnits('20'), fromTokenUnits('30')]);
      });

      it('Should allow you to join a pool', async () => {
        weth = weth.connect(user1);
        await weth.approve(tokenizer.address, fromTokenUnits('1000'));
        dai = dai.connect(user1);
        await dai.approve(tokenizer.address, fromTokenUnits('1000'));

        // User 1 joins pool
        tokenizer = tokenizer.connect(user1);
        await tokenizer.joinPool(50, [fromTokenUnits('15'), fromTokenUnits('25')]);
        expect(await tokenizer.balanceOf(user1Address)).to.equal(50);
      });

      it('Should not allow you to join a pool when maxAmountIn is too low', async () => {
        tokenizer = tokenizer.connect(user1);
        await expect(tokenizer.joinPool(50, [fromTokenUnits('5'), fromTokenUnits('5')])).to.be.revertedWith(
          'ERR_LIMIT_IN'
        );
      });

      describe('as a member of an initialized pool', async () => {
        it('Should allow you to exit a pool', async () => {
          // admin withdraws half their balance
          await tokenizer.exitPool(50, [fromTokenUnits('10'), fromTokenUnits('15')]);
          expect(await tokenizer.balanceOf(adminAddress)).to.equal(50);
        });
      });
    });
  });
});
