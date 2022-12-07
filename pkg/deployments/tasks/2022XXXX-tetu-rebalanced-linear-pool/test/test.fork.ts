import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { setCode } from '@nomicfoundation/hardhat-network-helpers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { bn, fp, FP_ONE } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { deployedAt, getArtifact } from '@balancer-labs/v2-helpers/src/contract';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { SwapKind } from '@balancer-labs/balancer-js';

import { describeForkTest, impersonate, getForkedNetwork, Task, TaskMode, getSigners } from '../../../src';

describeForkTest('TetuLinearPoolFactory', 'polygon', 36124280, function () {
  let owner: SignerWithAddress, holder: SignerWithAddress, other: SignerWithAddress;
  let factory: Contract, vault: Contract, usdt: Contract;
  let rebalancer: Contract;

  let task: Task;

  const USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
  const xUSDT = '0xE680e0317402ad3CB37D5ed9fc642702658Ef57F';

  const USDT_SCALING = bn(1e12); // USDT has 6 decimals, so its scaling factor is 1e12

  const USDT_HOLDER = '0xf977814e90da44bfa03b6295a0616a897441acec';
  const TETU_GOVERNANCE = '0xcc16d636dD05b52FF1D8B9CE09B09BC62b11412B';
  const TEUT_CONTROLLER = '0x6678814c273d5088114B6E40cC49C8DB04F9bC29';

  const SWAP_FEE_PERCENTAGE = fp(0.01); // 1%
  // The targets are set using 18 decimals, even if the token has fewer (as is the case for USDT);
  const INITIAL_UPPER_TARGET = fp(1e7);

  // The initial midpoint (upper target / 2) must be between the final lower and upper targets
  const FINAL_LOWER_TARGET = fp(0.2e7);
  const FINAL_UPPER_TARGET = fp(5e7);

  let pool: Contract;
  let poolId: string;

  before('run task', async () => {
    task = new Task('2022XXXX-tetu-rebalanced-linear-pool', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    factory = await task.deployedInstance('TetuLinearPoolFactory');
  });

  before('load signers', async () => {
    [, owner, other] = await getSigners();
    holder = await impersonate(USDT_HOLDER, fp(100));
  });

  before('setup contracts', async () => {
    vault = await new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre)).deployedInstance('Vault');
    usdt = await task.instanceAt('IERC20', USDT);
    await usdt.connect(holder).approve(vault.address, MAX_UINT256);
  });

  enum LinearPoolState {
    BALANCED,
    MAIN_EXCESS,
    MAIN_LACK,
  }

  function itRebalancesThePool(expectedState: LinearPoolState) {
    it('rebalance the pool', async () => {
      const { lowerTarget, upperTarget } = await pool.getTargets();

      const { cash } = await vault.getPoolTokenInfo(poolId, USDT);
      const scaledCash = cash.mul(USDT_SCALING);

      let fees;
      if (scaledCash.gt(upperTarget)) {
        expect(expectedState).to.equal(LinearPoolState.MAIN_EXCESS);

        const excess = scaledCash.sub(upperTarget);
        fees = excess.mul(SWAP_FEE_PERCENTAGE).div(FP_ONE);
      } else if (scaledCash.lt(lowerTarget)) {
        expect(expectedState).to.equal(LinearPoolState.MAIN_LACK);

        const lack = lowerTarget.sub(scaledCash);
        fees = lack.mul(SWAP_FEE_PERCENTAGE).div(FP_ONE);
      } else {
        expect(expectedState).to.equal(LinearPoolState.BALANCED);

        fees = 0;
      }

      const initialRecipientMainBalance = await usdt.balanceOf(other.address);

      const governance = await impersonate(TETU_GOVERNANCE);
      const controller = await task.instanceAt('ITetuController', TEUT_CONTROLLER);
      await controller.connect(governance).changeWhiteListStatus([rebalancer.address], true);

      if (expectedState != LinearPoolState.BALANCED) {
        await rebalancer.connect(holder).rebalance(other.address);
      } else {
        await rebalancer.connect(holder).rebalanceWithExtraMain(other.address, 50000);
      }
      const finalRecipientMainBalance = await usdt.balanceOf(other.address);

      if (fees > 0) {
        // The recipient of the rebalance call should get the fees that were collected (though there's some rounding
        // error in the main-wrapped conversion).
        expect(finalRecipientMainBalance.sub(initialRecipientMainBalance)).to.be.almostEqual(
          fees.div(USDT_SCALING),
          // because of rounding at TetuVault we can't provide better precision than 0.001
          // But it should be fine because of rebalace will be done by Tetu team and fees at Polygon are low.
          0.001
        );
      } else {
        // The recipient of the rebalance call will get any extra main tokens that were not utilized.
        expect(finalRecipientMainBalance).to.be.almostEqual(initialRecipientMainBalance, 0.0000001);
      }

      const mainInfo = await vault.getPoolTokenInfo(poolId, USDT);

      const expectedMainBalance = lowerTarget.add(upperTarget).div(2);
      expect(mainInfo.cash.mul(USDT_SCALING)).to.equal(expectedMainBalance);
      expect(mainInfo.managed).to.equal(0);
    });
  }

  describe('create and check getters', () => {
    it('deploy a linear pool', async () => {
      const tx = await factory.create('', '', USDT, xUSDT, INITIAL_UPPER_TARGET, SWAP_FEE_PERCENTAGE, owner.address);

      const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');
      pool = await task.instanceAt('TetuLinearPool', event.args.pool);

      expect(await factory.isPoolFromFactory(pool.address)).to.be.true;

      poolId = await pool.getPoolId();
      const [registeredAddress] = await vault.getPool(poolId);
      expect(registeredAddress).to.equal(pool.address);

      const { assetManager } = await vault.getPoolTokenInfo(poolId, USDT); // We could query for either USDT or xUSDT
      rebalancer = await task.instanceAt('TetuLinearPoolRebalancer', assetManager);

      await usdt.connect(holder).approve(rebalancer.address, MAX_UINT256); // To send extra main on rebalance
    });
  });

  describe('join, and rebalance', () => {
    it('join the pool', async () => {
      // We're going to join with enough main token to bring the Pool above its upper target, which will let us later
      // rebalance.

      const joinAmount = INITIAL_UPPER_TARGET.mul(2).div(USDT_SCALING);

      await vault
        .connect(holder)
        .swap(
          { kind: SwapKind.GivenIn, poolId, assetIn: USDT, assetOut: pool.address, amount: joinAmount, userData: '0x' },
          { sender: holder.address, recipient: holder.address, fromInternalBalance: false, toInternalBalance: false },
          0,
          MAX_UINT256
        );

      // Assert join amount - some fees will be collected as we're going over the upper target.
      const excess = joinAmount.mul(USDT_SCALING).sub(INITIAL_UPPER_TARGET);
      const joinCollectedFees = excess.mul(SWAP_FEE_PERCENTAGE).div(FP_ONE);

      const expectedBPT = joinAmount.mul(USDT_SCALING).sub(joinCollectedFees);
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
      const joinAmount = upperTarget.mul(5).div(USDT_SCALING);

      await vault
        .connect(holder)
        .swap(
          { kind: SwapKind.GivenIn, poolId, assetIn: USDT, assetOut: pool.address, amount: joinAmount, userData: '0x' },
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

      const { cash } = await vault.getPoolTokenInfo(poolId, USDT);
      const scaledCash = cash.mul(USDT_SCALING);
      const { lowerTarget } = await pool.getTargets();

      const exitAmount = scaledCash.sub(lowerTarget.div(3)).div(USDT_SCALING);

      await vault.connect(holder).swap(
        {
          kind: SwapKind.GivenOut,
          poolId,
          assetIn: pool.address,
          assetOut: USDT,
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
      // We're going to join with few tokens, causing the Pool to not reach its upper target.

      const { lowerTarget, upperTarget } = await pool.getTargets();
      const midpoint = lowerTarget.add(upperTarget).div(2);

      const joinAmount = midpoint.div(100).div(USDT_SCALING);

      await vault
        .connect(holder)
        .swap(
          { kind: SwapKind.GivenIn, poolId, assetIn: USDT, assetOut: pool.address, amount: joinAmount, userData: '0x' },
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

      const exitAmount = midpoint.div(100).div(USDT_SCALING);

      await vault.connect(holder).swap(
        {
          kind: SwapKind.GivenOut,
          poolId,
          assetIn: pool.address,
          assetOut: USDT,
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

  describe('rebalancer query protection', async () => {
    it('reverts with a malicious lending pool', async () => {
      const { cash } = await vault.getPoolTokenInfo(poolId, USDT);
      const scaledCash = cash.mul(USDT_SCALING);
      const { lowerTarget } = await pool.getTargets();

      const exitAmount = scaledCash.sub(lowerTarget.div(3)).div(USDT_SCALING);

      await vault.connect(holder).swap(
        {
          kind: SwapKind.GivenOut,
          poolId,
          assetIn: pool.address,
          assetOut: USDT,
          amount: exitAmount,
          userData: '0x',
        },
        { sender: holder.address, recipient: holder.address, fromInternalBalance: false, toInternalBalance: false },
        MAX_UINT256,
        MAX_UINT256
      );

      await setCode(xUSDT, getArtifact('v2-pool-linear/MockTetuSmartVault').deployedBytecode);
      const mockTetuSmartVault = await deployedAt('v2-pool-linear/MockTetuSmartVault', xUSDT);

      await mockTetuSmartVault.setRevertType(2); // Type 2 is malicious swap query revert
      await expect(rebalancer.rebalance(other.address)).to.be.revertedWith('BAL#357'); // MALICIOUS_QUERY_REVERT
    });
  });
});
