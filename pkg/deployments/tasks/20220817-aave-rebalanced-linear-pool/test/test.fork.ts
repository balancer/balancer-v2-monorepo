import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { bn, fp, FP_SCALING_FACTOR } from '@balancer-labs/v2-helpers/src/numbers';
import { describeForkTest } from '../../../src/forkTests';
import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigners, impersonate } from '../../../src/signers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { SwapKind } from '@balancer-labs/balancer-js';

describeForkTest('AaveLinearPoolFactory', 'mainnet', 15225000, function () {
  let owner: SignerWithAddress, holder: SignerWithAddress, other: SignerWithAddress;
  let factory: Contract, vault: Contract, usdc: Contract;
  let rebalancer: Contract;

  let task: Task;

  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const waUSDC = '0xd093fA4Fb80D09bB30817FDcd442d4d02eD3E5de';

  const USDC_SCALING = bn(1e12); // USDC has 6 decimals, so its scaling factor is 1e12

  const USDC_HOLDER = '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503';

  const SWAP_FEE_PERCENTAGE = fp(0.01); // 1%

  // The targets are set using 18 decimals, even if the token has fewer (as is the case for USDC);
  const INITIAL_UPPER_TARGET = fp(1e7);

  // The initial midpoint (upper target / 2) must be between the final lower and upper targets
  const FINAL_LOWER_TARGET = fp(0.2e7);
  const FINAL_UPPER_TARGET = fp(5e7);

  let pool: Contract;
  let poolId: string;

  before('run task', async () => {
    task = new Task('20220817-aave-rebalanced-linear-pool', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    factory = await task.deployedInstance('AaveLinearPoolFactory');
  });

  before('load signers', async () => {
    [, owner, other] = await getSigners();

    holder = await impersonate(USDC_HOLDER, fp(100));
  });

  before('setup contracts', async () => {
    vault = await new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre)).deployedInstance('Vault');

    usdc = await task.instanceAt('IERC20', USDC);
    await usdc.connect(holder).approve(vault.address, MAX_UINT256);
  });

  enum LinearPoolState {
    BALANCED,
    MAIN_EXCESS,
    MAIN_LACK,
  }

  function itRebalancesThePool(expectedState: LinearPoolState) {
    it('rebalance the pool', async () => {
      const { lowerTarget, upperTarget } = await pool.getTargets();

      const { cash } = await vault.getPoolTokenInfo(poolId, USDC);
      const scaledCash = cash.mul(USDC_SCALING);

      let fees;
      if (scaledCash.gt(upperTarget)) {
        expect(expectedState).to.equal(LinearPoolState.MAIN_EXCESS);

        const excess = scaledCash.sub(upperTarget);
        fees = excess.mul(SWAP_FEE_PERCENTAGE).div(FP_SCALING_FACTOR);
      } else if (scaledCash.lt(lowerTarget)) {
        expect(expectedState).to.equal(LinearPoolState.MAIN_LACK);

        const lack = lowerTarget.sub(scaledCash);
        fees = lack.mul(SWAP_FEE_PERCENTAGE).div(FP_SCALING_FACTOR);
      } else {
        expect(expectedState).to.equal(LinearPoolState.BALANCED);

        fees = 0;
      }

      const initialRecipientMainBalance = await usdc.balanceOf(other.address);
      if (expectedState != LinearPoolState.BALANCED) {
        await rebalancer.connect(holder).rebalance(other.address);
      } else {
        await rebalancer.connect(holder).rebalanceWithExtraMain(other.address, 5);
      }
      const finalRecipientMainBalance = await usdc.balanceOf(other.address);

      if (fees > 0) {
        // The recipient of the rebalance call should get the fees that were collected (though there's some rounding
        // error in the main-wrapped conversion).
        expect(finalRecipientMainBalance.sub(initialRecipientMainBalance)).to.be.almostEqual(
          fees.div(USDC_SCALING),
          0.00000001
        );
      } else {
        // The recipient of the rebalance call will get any extra main tokens that were not utilized.
        expect(finalRecipientMainBalance).to.be.almostEqual(initialRecipientMainBalance, 0.00000001);
      }

      const mainInfo = await vault.getPoolTokenInfo(poolId, USDC);

      const expectedMainBalance = lowerTarget.add(upperTarget).div(2);
      expect(mainInfo.cash.mul(USDC_SCALING)).to.equal(expectedMainBalance);
      expect(mainInfo.managed).to.equal(0);
    });
  }

  describe('create, join, and rebalance', () => {
    it('deploy a linear pool', async () => {
      const tx = await factory.create('', '', USDC, waUSDC, INITIAL_UPPER_TARGET, SWAP_FEE_PERCENTAGE, owner.address);
      const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');

      pool = await task.instanceAt('AaveLinearPool', event.args.pool);
      expect(await factory.isPoolFromFactory(pool.address)).to.be.true;

      poolId = await pool.getPoolId();
      const [registeredAddress] = await vault.getPool(poolId);
      expect(registeredAddress).to.equal(pool.address);

      const { assetManager } = await vault.getPoolTokenInfo(poolId, USDC); // We could query for either USDC or waUSDC
      rebalancer = await task.instanceAt('AaveLinearPoolRebalancer', assetManager);

      await usdc.connect(holder).approve(rebalancer.address, MAX_UINT256); // To send extra main on rebalance
    });

    it('join the pool', async () => {
      // We're going to join with enough main token to bring the Pool above its upper target, which will let us later
      // rebalance.

      const joinAmount = INITIAL_UPPER_TARGET.mul(2).div(USDC_SCALING);

      await vault
        .connect(holder)
        .swap(
          { kind: SwapKind.GivenIn, poolId, assetIn: USDC, assetOut: pool.address, amount: joinAmount, userData: '0x' },
          { sender: holder.address, recipient: holder.address, fromInternalBalance: false, toInternalBalance: false },
          0,
          MAX_UINT256
        );

      // Assert join amount - some fees will be collected as we're going over the upper target.
      const excess = joinAmount.mul(USDC_SCALING).sub(INITIAL_UPPER_TARGET);
      const joinCollectedFees = excess.mul(SWAP_FEE_PERCENTAGE).div(FP_SCALING_FACTOR);

      const expectedBPT = joinAmount.mul(USDC_SCALING).sub(joinCollectedFees);
      expect(await pool.balanceOf(holder.address)).to.equal(expectedBPT);
    });

    itRebalancesThePool(LinearPoolState.MAIN_EXCESS);

    it('set final targets', async () => {
      await pool.connect(owner).setTargets(FINAL_LOWER_TARGET, FINAL_UPPER_TARGET);
    });
  });

  describe('generate excess of main token and rebalance', () => {
    it('deposit main tokens', async () => {
      // We're going to join with enough main token to bring the Pool above its upper target, which will let us later
      // rebalance.

      const { upperTarget } = await pool.getTargets();
      const joinAmount = upperTarget.mul(5).div(USDC_SCALING);

      await vault
        .connect(holder)
        .swap(
          { kind: SwapKind.GivenIn, poolId, assetIn: USDC, assetOut: pool.address, amount: joinAmount, userData: '0x' },
          { sender: holder.address, recipient: holder.address, fromInternalBalance: false, toInternalBalance: false },
          0,
          MAX_UINT256
        );
    });

    itRebalancesThePool(LinearPoolState.MAIN_EXCESS);
  });

  describe('generate lack of main token and rebalance', () => {
    it('withdraw main tokens', async () => {
      // We're going to withdraw enough man token to bring the Pool below its lower target, which will let us later
      // rebalance.

      const { cash } = await vault.getPoolTokenInfo(poolId, USDC);
      const scaledCash = cash.mul(USDC_SCALING);
      const { lowerTarget } = await pool.getTargets();

      const exitAmount = scaledCash.sub(lowerTarget.div(3)).div(USDC_SCALING);

      await vault.connect(holder).swap(
        {
          kind: SwapKind.GivenOut,
          poolId,
          assetIn: pool.address,
          assetOut: USDC,
          amount: exitAmount,
          userData: '0x',
        },
        { sender: holder.address, recipient: holder.address, fromInternalBalance: false, toInternalBalance: false },
        MAX_UINT256,
        MAX_UINT256
      );
    });

    itRebalancesThePool(LinearPoolState.MAIN_LACK);
  });

  describe('join below upper target and rebalance', () => {
    it('deposit main tokens', async () => {
      // We're going to join with few tokens, causing for the Pool to not reach its upper target.

      const { lowerTarget, upperTarget } = await pool.getTargets();
      const midpoint = lowerTarget.add(upperTarget).div(2);

      const joinAmount = midpoint.div(100).div(USDC_SCALING);

      await vault
        .connect(holder)
        .swap(
          { kind: SwapKind.GivenIn, poolId, assetIn: USDC, assetOut: pool.address, amount: joinAmount, userData: '0x' },
          { sender: holder.address, recipient: holder.address, fromInternalBalance: false, toInternalBalance: false },
          0,
          MAX_UINT256
        );
    });

    itRebalancesThePool(LinearPoolState.BALANCED);
  });

  describe('exit above lower target and rebalance', () => {
    it('withdraw main tokens', async () => {
      // We're going to exit with few tokens, causing for the Pool to not reach its lower target.

      const { lowerTarget, upperTarget } = await pool.getTargets();
      const midpoint = lowerTarget.add(upperTarget).div(2);

      const exitAmount = midpoint.div(100).div(USDC_SCALING);

      await vault.connect(holder).swap(
        {
          kind: SwapKind.GivenOut,
          poolId,
          assetIn: pool.address,
          assetOut: USDC,
          amount: exitAmount,
          userData: '0x',
        },
        { sender: holder.address, recipient: holder.address, fromInternalBalance: false, toInternalBalance: false },
        MAX_UINT256,
        MAX_UINT256
      );
    });

    itRebalancesThePool(LinearPoolState.BALANCED);
  });

  describe('rebalance repeatedly', () => {
    itRebalancesThePool(LinearPoolState.BALANCED);
    itRebalancesThePool(LinearPoolState.BALANCED);
  });
});
