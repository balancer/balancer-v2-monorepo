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

describe('ReaperLinearPool', function () {
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
    poolFactory = await deploy('ReaperLinearPoolFactory', {
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
    let rfUSDC: Token;
    let usdcReaperVault: Contract;
    let bbrfUSDC: LinearPool;

    sharedBeforeEach('setup tokens, reaper vault and linear pool', async () => {
      usdc = await Token.create({ symbol: 'USDC', name: 'USDC', decimals: 6 });
      usdcReaperVault = await deploy('MockReaperVault', {
        args: ['rfUSDC', 'rfUSDC', 18, usdc.address, fp(1)],
      });
      rfUSDC = await Token.deployedAt(usdcReaperVault.address);

      bbrfUSDC = await deployPool(usdc.address, rfUSDC.address);
      const initialJoinAmount = bn(100000000000);
      await usdc.mint(lp, initialJoinAmount);
      await usdc.approve(vault.address, initialJoinAmount, { from: lp });

      const joinData: SingleSwap = {
        poolId: bbrfUSDC.poolId,
        kind: 0,
        assetIn: usdc.address,
        assetOut: bbrfUSDC.address,
        amount: BigNumber.from(100_000e6),
        userData: '0x',
      };

      const transaction = await vault.instance.connect(lp).swap(joinData, funds, BigNumber.from(0), MAX_UINT256);
      await transaction.wait();
    });

    it('should return wrapped token rate scaled to 18 decimals for a 6 decimal token', async () => {
      await usdcReaperVault.setPricePerFullShare(fp(1.5));
      expect(await bbrfUSDC.getWrappedTokenRate()).to.be.eq(fp(1.5e12));
    });

    it('should swap 0.000_000_000_000_800_000 rfUSDC to 1 USDC when the ppfs is 1.25e18', async () => {
      await usdcReaperVault.setPricePerFullShare(fp(1.25));
      // we try to rebalance it with some wrapped tokens
      const rfUsdcAmount = bn(8e5);
      await rfUSDC.mint(lp, rfUsdcAmount);
      await rfUSDC.approve(vault.address, rfUsdcAmount, { from: lp });

      const rebalanceSwapData: SingleSwap = {
        poolId: bbrfUSDC.poolId,
        kind: 0,
        assetIn: rfUSDC.address,
        assetOut: usdc.address,
        amount: rfUsdcAmount,
        userData: '0x',
      };

      const balanceBefore = await usdc.balanceOf(lp.address);
      await vault.instance.connect(lp).swap(rebalanceSwapData, funds, BigNumber.from(0), MAX_UINT256);
      const balanceAfter = await usdc.balanceOf(lp.address);
      const amountReturned = balanceAfter.sub(balanceBefore);

      expect(amountReturned).to.be.eq(bn(1e6));
    });

    it('should swap 0.000_000_000_800_000_000 rfUSDC to 1,000 USDC when the ppfs is 1.25e18', async () => {
      await usdcReaperVault.setPricePerFullShare(fp(1.25));
      // we try to rebalance it with some wrapped tokens
      const rfUsdcAmount = bn(8e8);
      await rfUSDC.mint(lp, rfUsdcAmount);
      await rfUSDC.approve(vault.address, rfUsdcAmount, { from: lp });

      const rebalanceSwapData: SingleSwap = {
        poolId: bbrfUSDC.poolId,
        kind: 0,
        assetIn: rfUSDC.address,
        assetOut: usdc.address,
        amount: rfUsdcAmount,
        userData: '0x',
      };

      const balanceBefore = await usdc.balanceOf(lp.address);

      await vault.instance.connect(lp).swap(rebalanceSwapData, funds, BigNumber.from(0), MAX_UINT256);
      const balanceAfter = await usdc.balanceOf(lp.address);
      const amountReturned = balanceAfter.sub(balanceBefore);
      expect(amountReturned).to.be.eq(1e9);
    });
  });

  describe('DAI with 18 decimals tests', () => {
    let dai: Token;
    let rfDAI: Token;
    let daiReaperVault: Contract;
    let bbrfDAI: LinearPool;

    sharedBeforeEach('setup tokens, reaper vault and linear pool', async () => {
      dai = await Token.create({ symbol: 'DAI', name: 'DAI', decimals: 18 });
      daiReaperVault = await deploy('MockReaperVault', {
        args: ['rfDAI', 'rfDAI', 18, dai.address, fp(1)],
      });
      rfDAI = await Token.deployedAt(daiReaperVault.address);

      bbrfDAI = await deployPool(dai.address, rfDAI.address);
      const initialJoinAmount = fp(100);
      await dai.mint(lp, initialJoinAmount);
      await dai.approve(vault.address, initialJoinAmount, { from: lp });

      const joinData: SingleSwap = {
        poolId: bbrfDAI.poolId,
        kind: 0,
        assetIn: dai.address,
        assetOut: bbrfDAI.address,
        amount: initialJoinAmount,
        userData: '0x',
      };

      const transaction = await vault.instance.connect(lp).swap(joinData, funds, BigNumber.from(0), MAX_UINT256);
      await transaction.wait();
    });

    it('should return unscaled wrapped token rate for an 18 decimal token', async () => {
      await daiReaperVault.setPricePerFullShare(fp(1.5));
      expect(await bbrfDAI.getWrappedTokenRate()).to.be.eq(fp(1.5));
    });

    it('should swap 1 rfDAI to 2 DAI when the pricePerFullShare is 2e18', async () => {
      await daiReaperVault.setPricePerFullShare(fp(2));

      const rfDAIAmount = fp(1);
      await rfDAI.mint(lp, rfDAIAmount);
      await rfDAI.approve(vault.address, rfDAIAmount, { from: lp });

      const data: SingleSwap = {
        poolId: bbrfDAI.poolId,
        kind: 0,
        assetIn: rfDAI.address,
        assetOut: dai.address,
        amount: rfDAIAmount,
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
