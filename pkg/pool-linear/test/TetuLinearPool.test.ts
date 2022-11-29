import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import LinearPool from '@balancer-labs/v2-helpers/src/models/pools/linear/LinearPool';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { FundManagement, SingleSwap } from '@balancer-labs/balancer-js/src';

describe('TetuLinearPool', function () {
  let poolFactory: Contract;
  let lp: SignerWithAddress, owner: SignerWithAddress;
  let vault: Vault;
  let funds: FundManagement;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  before('setup', async () => {
    [, lp, owner] = await ethers.getSigners();

    funds = {
      sender: lp.address,
      fromInternalBalance: false,
      toInternalBalance: false,
      recipient: lp.address,
    };
  });

  sharedBeforeEach('deploy vault & pool factory', async () => {
    vault = await Vault.create();
    const queries = await deploy('v2-standalone-utils/BalancerQueries', { args: [vault.address] });
    poolFactory = await deploy('TetuLinearPoolFactory', {
      args: [vault.address, vault.getFeesProvider().address, queries.address],
    });
  });

  async function deployPool(mainTokenAddress: string, wrappedTokenAddress: string) {
    const tx = await poolFactory.create(
      'Linear pool',
      'BPT',
      mainTokenAddress,
      wrappedTokenAddress,
      fp(1_000_000),
      POOL_SWAP_FEE_PERCENTAGE,
      owner.address
    );

    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');

    return LinearPool.deployedAt(event.args.pool);
  }

  describe('usdc vault with 6 decimals tests', () => {
    let usdc: Token;
    let xUSDC: Token;
    let usdcTetuVault: Contract;
    let bbtUSDC: LinearPool;

    sharedBeforeEach('setup tokens, reaper vault and linear pool', async () => {
      usdc = await Token.create({ symbol: 'USDC', name: 'USDC', decimals: 6 });
      usdcTetuVault = await deploy('MockTetuSmartVault', {
        args: ['xUSDC', 'xUSDC', 6, usdc.address, fp(1)],
      });
      xUSDC = await Token.deployedAt(usdcTetuVault.address);

      bbtUSDC = await deployPool(usdc.address, xUSDC.address);
      const initialJoinAmount = bn(100000000000);
      await usdc.mint(lp, initialJoinAmount);
      await usdc.approve(vault.address, initialJoinAmount, { from: lp });

      const joinData: SingleSwap = {
        poolId: bbtUSDC.poolId,
        kind: 0,
        assetIn: usdc.address,
        assetOut: bbtUSDC.address,
        amount: BigNumber.from(100_000e6),
        userData: '0x',
      };

      const transaction = await vault.instance.connect(lp).swap(joinData, funds, BigNumber.from(0), MAX_UINT256);
      await transaction.wait();
    });

    it('should return wrapped token rate scaled to 18 decimals for a 6 decimal token', async () => {
      await usdcTetuVault.setPricePerFullShare('1500000');
      expect(await bbtUSDC.getWrappedTokenRate()).to.be.eq(fp(1.5));
    });

    it('should swap 0.000_000_000_000_800_000 xUSDC to 1 USDC when the ppfs is 1250000', async () => {
      await usdcTetuVault.setPricePerFullShare('1250000');
      // we try to rebalance it with some wrapped tokens
      const xUsdcAmount = bn(8e5);
      await xUSDC.mint(lp, xUsdcAmount);
      await xUSDC.approve(vault.address, xUsdcAmount, { from: lp });

      const rebalanceSwapData: SingleSwap = {
        poolId: bbtUSDC.poolId,
        kind: 0,
        assetIn: xUSDC.address,
        assetOut: usdc.address,
        amount: xUsdcAmount,
        userData: '0x',
      };

      const balanceBefore = await usdc.balanceOf(lp.address);
      await vault.instance.connect(lp).swap(rebalanceSwapData, funds, BigNumber.from(0), MAX_UINT256);
      const balanceAfter = await usdc.balanceOf(lp.address);
      const amountReturned = balanceAfter.sub(balanceBefore);

      expect(amountReturned).to.be.eq(bn(1e6));
    });

    it('should swap 0.000_000_000_800_000_000 xUSDC to 1,000 USDC when the ppfs is 1250000', async () => {
      await usdcTetuVault.setPricePerFullShare('1250000');
      // we try to rebalance it with some wrapped tokens
      const xUsdcAmount = bn(8e8);
      await xUSDC.mint(lp, xUsdcAmount);
      await xUSDC.approve(vault.address, xUsdcAmount, { from: lp });

      const rebalanceSwapData: SingleSwap = {
        poolId: bbtUSDC.poolId,
        kind: 0,
        assetIn: xUSDC.address,
        assetOut: usdc.address,
        amount: xUsdcAmount,
        userData: '0x',
      };

      const balanceBefore = await usdc.balanceOf(lp.address);

      await vault.instance.connect(lp).swap(rebalanceSwapData, funds, BigNumber.from(0), MAX_UINT256);
      const balanceAfter = await usdc.balanceOf(lp.address);
      const amountReturned = balanceAfter.sub(balanceBefore);
      expect(amountReturned).to.be.eq(1e9);
    });
  });

  describe('wbtc vault with 8 decimals tests', () => {
    let wbtc: Token;
    let xWBTC: Token;
    let wbtcTetuVault: Contract;
    let bbtWBTC: LinearPool;

    sharedBeforeEach('setup tokens, reaper vault and linear pool', async () => {
      wbtc = await Token.create({ symbol: 'WBTC', name: 'WBTC', decimals: 8 });
      wbtcTetuVault = await deploy('MockTetuSmartVault', {
        args: ['xWBTC', 'xWBTC', 8, wbtc.address, fp(1)],
      });
      xWBTC = await Token.deployedAt(wbtcTetuVault.address);

      bbtWBTC = await deployPool(wbtc.address, xWBTC.address);
      const initialJoinAmount = bn(100000000000);
      await wbtc.mint(lp, initialJoinAmount);
      await wbtc.approve(vault.address, initialJoinAmount, { from: lp });

      const joinData: SingleSwap = {
        poolId: bbtWBTC.poolId,
        kind: 0,
        assetIn: wbtc.address,
        assetOut: bbtWBTC.address,
        amount: BigNumber.from(100_000e6),
        userData: '0x',
      };

      const transaction = await vault.instance.connect(lp).swap(joinData, funds, BigNumber.from(0), MAX_UINT256);
      await transaction.wait();
    });

    it('should return wrapped token rate scaled to 18 decimals for a 8 decimal token', async () => {
      await wbtcTetuVault.setPricePerFullShare('150000000');
      expect(await bbtWBTC.getWrappedTokenRate()).to.be.eq(fp(1.5));
    });

    it('should swap 0.000_000_000_000_800_000 xWBTC to 1 WBTC when the ppfs is 1250000', async () => {
      await wbtcTetuVault.setPricePerFullShare('125000000');
      // we try to rebalance it with some wrapped tokens
      const xWBTCAmount = bn(8e5);
      await xWBTC.mint(lp, xWBTCAmount);
      await xWBTC.approve(vault.address, xWBTCAmount, { from: lp });

      const rebalanceSwapData: SingleSwap = {
        poolId: bbtWBTC.poolId,
        kind: 0,
        assetIn: xWBTC.address,
        assetOut: wbtc.address,
        amount: xWBTCAmount,
        userData: '0x',
      };

      const balanceBefore = await wbtc.balanceOf(lp.address);
      await vault.instance.connect(lp).swap(rebalanceSwapData, funds, BigNumber.from(0), MAX_UINT256);
      const balanceAfter = await wbtc.balanceOf(lp.address);
      const amountReturned = balanceAfter.sub(balanceBefore);

      expect(amountReturned).to.be.eq(bn(1e6));
    });

    it('should swap 0.000_000_000_800_000_000 xWBTC to 1,000 USDC when the ppfs is 125000000', async () => {
      await wbtcTetuVault.setPricePerFullShare('125000000');
      // we try to rebalance it with some wrapped tokens
      const xUsdcAmount = bn(8e8);
      await xWBTC.mint(lp, xUsdcAmount);
      await xWBTC.approve(vault.address, xUsdcAmount, { from: lp });

      const rebalanceSwapData: SingleSwap = {
        poolId: bbtWBTC.poolId,
        kind: 0,
        assetIn: xWBTC.address,
        assetOut: wbtc.address,
        amount: xUsdcAmount,
        userData: '0x',
      };

      const balanceBefore = await wbtc.balanceOf(lp.address);

      await vault.instance.connect(lp).swap(rebalanceSwapData, funds, BigNumber.from(0), MAX_UINT256);
      const balanceAfter = await wbtc.balanceOf(lp.address);
      const amountReturned = balanceAfter.sub(balanceBefore);
      expect(amountReturned).to.be.eq(1e9);
    });
  });

  describe('DAI with 18 decimals tests', () => {
    let dai: Token;
    let xDAI: Token;
    let daiReaperVault: Contract;
    let bbtDAI: LinearPool;

    sharedBeforeEach('setup tokens, reaper vault and linear pool', async () => {
      dai = await Token.create({ symbol: 'DAI', name: 'DAI', decimals: 18 });
      daiReaperVault = await deploy('MockTetuSmartVault', {
        args: ['xDAI', 'xDAI', 18, dai.address, fp(1)],
      });
      xDAI = await Token.deployedAt(daiReaperVault.address);

      bbtDAI = await deployPool(dai.address, xDAI.address);
      const initialJoinAmount = fp(100);
      await dai.mint(lp, initialJoinAmount);
      await dai.approve(vault.address, initialJoinAmount, { from: lp });

      const joinData: SingleSwap = {
        poolId: bbtDAI.poolId,
        kind: 0,
        assetIn: dai.address,
        assetOut: bbtDAI.address,
        amount: initialJoinAmount,
        userData: '0x',
      };

      const transaction = await vault.instance.connect(lp).swap(joinData, funds, BigNumber.from(0), MAX_UINT256);
      await transaction.wait();
    });

    it('should return unscaled wrapped token rate for an 18 decimal token', async () => {
      await daiReaperVault.setPricePerFullShare(fp(1.5));
      expect(await bbtDAI.getWrappedTokenRate()).to.be.eq(fp(1.5));
    });

    it('should swap 1 xDAI to 2 DAI when the pricePerFullShare is 2e18', async () => {
      await daiReaperVault.setPricePerFullShare(fp(2));

      const xDAIAmount = fp(1);
      await xDAI.mint(lp, xDAIAmount);
      await xDAI.approve(vault.address, xDAIAmount, { from: lp });

      const data: SingleSwap = {
        poolId: bbtDAI.poolId,
        kind: 0,
        assetIn: xDAI.address,
        assetOut: dai.address,
        amount: xDAIAmount,
        userData: '0x',
      };

      const balanceBefore = await dai.balanceOf(lp.address);
      await vault.instance.connect(lp).swap(data, funds, BigNumber.from(0), MAX_UINT256);
      const balanceAfter = await dai.balanceOf(lp.address);
      const amountReturned = balanceAfter.sub(balanceBefore);
      expect(amountReturned).to.be.eq(fp(2));
    });
  });
});
