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

describe('BeefyLinearPool', function () {
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
    poolFactory = await deploy('BeefyLinearPoolFactory', {
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

  describe('USDC vault with 6 decimals tests', () => {
    let usdc: Token;
    let mooUSDC: Token;
    let usdcBeefyVault: Contract;
    let bbbUSDC: LinearPool;

    sharedBeforeEach('setup tokens, beefy vault and linear pool', async () => {
      usdc = await Token.create({ symbol: 'USDC', name: 'USDC', decimals: 6 });
      usdcBeefyVault = await deploy('MockBeefyVault', {
        args: ['mooUSDC', 'mooUSDC', 18, usdc.address],
      });
      mooUSDC = await Token.deployedAt(usdcBeefyVault.address);

      bbbUSDC = await deployPool(usdc.address, mooUSDC.address);
      const initialJoinAmount = bn(100000000000);
      await usdc.mint(lp, initialJoinAmount);
      await usdc.approve(vault.address, initialJoinAmount, { from: lp });

      const joinData: SingleSwap = {
        poolId: bbbUSDC.poolId,
        kind: 0,
        assetIn: usdc.address,
        assetOut: bbbUSDC.address,
        amount: BigNumber.from(100_000e6),
        userData: '0x',
      };

      const transaction = await vault.instance.connect(lp).swap(joinData, funds, BigNumber.from(0), MAX_UINT256);
      await transaction.wait();
    });

    it('should return wrapped token rate scaled to 18 decimals for a 6 decimal token', async () => {
      await usdcBeefyVault.setTotalSupply(fp(1));;
      await usdcBeefyVault.setBalance(fp(1.5));
      expect(await bbbUSDC.getWrappedTokenRate()).to.be.eq(fp(1.5e12));
    });

    it('should swap 0.000_000_000_000_800_000 mooUSDC to about 1 USDC when the ppfs is 1.25e18', async () => {
      await usdcBeefyVault.setTotalSupply(fp(1_000_000));
      await usdcBeefyVault.setBalance(fp(1_250_000));
      // we try to rebalance it with some wrapped tokens
      const mooUsdcAmount = bn(8e5);
      await mooUSDC.mint(lp, mooUsdcAmount);
      await mooUSDC.approve(vault.address, mooUsdcAmount, { from: lp });

      const rebalanceSwapData: SingleSwap = {
        poolId: bbbUSDC.poolId,
        kind: 0,
        assetIn: mooUSDC.address,
        assetOut: usdc.address,
        amount: mooUsdcAmount,
        userData: '0x',
      };

      const balanceBefore = await usdc.balanceOf(lp.address);
      await vault.instance.connect(lp).swap(rebalanceSwapData, funds, BigNumber.from(0), MAX_UINT256);
      const balanceAfter = await usdc.balanceOf(lp.address);
      const amountReturned = balanceAfter.sub(balanceBefore);
      // because of decimals math we will be off by 1 wei.
      expect(amountReturned).to.be.almostEqual(bn(1e6));
    });

    it('should swap 0.000_000_000_800_000_000 mooUSDC to about 1,0000 USDC when the ppfs is 1.25e18', async () => {
      await usdcBeefyVault.setTotalSupply(fp(1_000_000));
      await usdcBeefyVault.setBalance(fp(1_250_000));
      // we try to rebalance it with some wrapped tokens
      const mooUsdcAmount = bn(8e8);
      await mooUSDC.mint(lp, mooUsdcAmount);
      await mooUSDC.approve(vault.address, mooUsdcAmount, { from: lp });

      const rebalanceSwapData: SingleSwap = {
        poolId: bbbUSDC.poolId,
        kind: 0,
        assetIn: mooUSDC.address,
        assetOut: usdc.address,
        amount: mooUsdcAmount,
        userData: '0x',
      };

      const balanceBefore = await usdc.balanceOf(lp.address);

      await vault.instance.connect(lp).swap(rebalanceSwapData, funds, BigNumber.from(0), MAX_UINT256);
      const balanceAfter = await usdc.balanceOf(lp.address);
      const amountReturned = balanceAfter.sub(balanceBefore);
      // because of decimals math we will be off by 1 wei.
      expect(amountReturned).to.be.almostEqual(1e9);
    });
  });

  describe('DAI with 18 decimals tests', () => {
    let dai: Token;
    let mooDAI: Token;
    let daiBeefyVault: Contract;
    let bbbDAI: LinearPool;

    sharedBeforeEach('setup tokens, beefy vault and linear pool', async () => {
      dai = await Token.create({ symbol: 'DAI', name: 'DAI', decimals: 18 });
      daiBeefyVault = await deploy('MockBeefyVault', {
        args: ['mooDAI', 'mooDAI', 18, dai.address],
      });
      mooDAI = await Token.deployedAt(daiBeefyVault.address);

      bbbDAI = await deployPool(dai.address, mooDAI.address);
      const initialJoinAmount = fp(100);
      await dai.mint(lp, initialJoinAmount);
      await dai.approve(vault.address, initialJoinAmount, { from: lp });

      const joinData: SingleSwap = {
        poolId: bbbDAI.poolId,
        kind: 0,
        assetIn: dai.address,
        assetOut: bbbDAI.address,
        amount: initialJoinAmount,
        userData: '0x',
      };

      const transaction = await vault.instance.connect(lp).swap(joinData, funds, BigNumber.from(0), MAX_UINT256);
      await transaction.wait();
    });

    it('should return unscaled wrapped token rate for an 18 decimal token', async () => {
      await daiBeefyVault.setTotalSupply(fp(1));
      await daiBeefyVault.setBalance(fp(1.5));
      expect(await bbbDAI.getWrappedTokenRate()).to.be.eq(fp(1.5));
    });

    it('should swap 1 mooDAI to 2 DAI when the pricePerFullShare is 2e18', async () => {
      await daiBeefyVault.setBalance(fp(2));

      const mooDAIAmount = fp(1);
      await mooDAI.mint(lp, mooDAIAmount);
      await mooDAI.approve(vault.address, mooDAIAmount, { from: lp });

      const data: SingleSwap = {
        poolId: bbbDAI.poolId,
        kind: 0,
        assetIn: mooDAI.address,
        assetOut: dai.address,
        amount: mooDAIAmount,
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
