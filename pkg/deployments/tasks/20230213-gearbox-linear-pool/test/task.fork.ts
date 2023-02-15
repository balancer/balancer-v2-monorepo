import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { setCode } from '@nomicfoundation/hardhat-network-helpers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { bn, fp, FP_ONE } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { impersonate, getForkedNetwork, Task, TaskMode, getSigners } from '../../../src';
import { describeForkTest } from '../../../src/forkTests';
import { deploy, deployedAt, getArtifact } from '@balancer-labs/v2-helpers/src/contract';

export enum SwapKind {
  GivenIn = 0,
  GivenOut,
}

describeForkTest('GearboxLinearPoolFactory', 'mainnet', 16636000, function () {
  let owner: SignerWithAddress, holder: SignerWithAddress, other: SignerWithAddress;
  let vault: Contract, mainToken: Contract;
  let factory: Contract;
  let rebalancer: Contract;

  let task: Task;

  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  // Diesel USDC Token
  const dUSDC = '0xc411db5f5eb3f7d552f9b8454b2d74097ccde6e3';
  const USDC_SCALING = bn(1e12); // USDC has 6 decimals, so its scaling factor is 1e12
  const USDC_HOLDER = '0xdfd5293d8e347dfe59e90efd55b2956a1343963d';
  const GEARBOX_VAULT = '0x86130bDD69143D8a4E5fc50bf4323D48049E98E4';

  const SWAP_FEE_PERCENTAGE = fp(0.01); // 1%

  // The targets are set using 18 decimals, even if the token has fewer (as is the case for USDC);
  const INITIAL_UPPER_TARGET = fp(1e6);

  // The initial midpoint (upper target / 2) must be between the final lower and upper targets
  const FINAL_LOWER_TARGET = fp(0.2e6);
  const FINAL_UPPER_TARGET = fp(5e6);

  const PROTOCOL_ID = 0;

  enum AttackType {
    SET_TARGETS,
    SET_SWAP_FEE,
  }

  let pool: Contract;
  let poolId: string;

  before('run task', async () => {
    task = new Task('20230213-gearbox-linear-pool', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    factory = await task.deployedInstance('GearboxLinearPoolFactory');
  });

  before('load signers', async () => {
    [, owner, other] = await getSigners();

    holder = await impersonate(USDC_HOLDER, fp(100));
  });

  before('setup contracts', async () => {
    vault = await new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre)).deployedInstance('Vault');

    mainToken = await task.instanceAt('IERC20', USDC);
    await mainToken.connect(holder).approve(vault.address, MAX_UINT256);
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
        fees = excess.mul(SWAP_FEE_PERCENTAGE).div(FP_ONE);
      } else if (scaledCash.lt(lowerTarget)) {
        expect(expectedState).to.equal(LinearPoolState.MAIN_LACK);

        const lack = lowerTarget.sub(scaledCash);
        fees = lack.mul(SWAP_FEE_PERCENTAGE).div(FP_ONE);
      } else {
        expect(expectedState).to.equal(LinearPoolState.BALANCED);

        fees = 0;
      }

      const initialRecipientMainBalance = await mainToken.balanceOf(other.address);
      if (expectedState != LinearPoolState.BALANCED) {
        await rebalancer.connect(holder).rebalance(other.address);
      } else {
        await rebalancer.connect(holder).rebalanceWithExtraMain(other.address, 5);
      }
      const finalRecipientMainBalance = await mainToken.balanceOf(other.address);

      if (fees > 0) {
        // The recipient of the rebalance call should get the fees that were collected (though there's some rounding
        // error in the main-wrapped conversion).
        expect(finalRecipientMainBalance.sub(initialRecipientMainBalance)).to.be.almostEqual(
          fees.div(USDC_SCALING),
          0.0001
        );
      } else {
        // The recipient of the rebalance call will get any extra main tokens that were not utilized.
        expect(finalRecipientMainBalance).to.be.almostEqual(initialRecipientMainBalance, 0.0001);
      }

      const mainInfo = await vault.getPoolTokenInfo(poolId, USDC);

      const expectedMainBalance = lowerTarget.add(upperTarget).div(2);
      expect(mainInfo.cash.mul(USDC_SCALING)).to.equal(expectedMainBalance);
      expect(mainInfo.managed).to.equal(0);
    });
  }

  describe('create and check getters', () => {
    it('deploy a linear pool', async () => {
      const tx = await factory.create(
        '',
        '',
        USDC,
        dUSDC,
        INITIAL_UPPER_TARGET,
        SWAP_FEE_PERCENTAGE,
        owner.address,
        PROTOCOL_ID
      );
      const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');

      pool = await task.instanceAt('GearboxLinearPool', event.args.pool);
      expect(await factory.isPoolFromFactory(pool.address)).to.be.true;

      poolId = await pool.getPoolId();
      const [registeredAddress] = await vault.getPool(poolId);
      expect(registeredAddress).to.equal(pool.address);

      const { assetManager } = await vault.getPoolTokenInfo(poolId, USDC);
      rebalancer = await task.instanceAt('GearboxLinearPoolRebalancer', assetManager);
    });

    it('check factory version', async () => {
      const expectedFactoryVersion = {
        name: 'GearboxLinearPoolFactory',
        version: 1,
        deployment: '20230213-gearbox-linear-pool',
      };

      expect(await factory.version()).to.equal(JSON.stringify(expectedFactoryVersion));
    });

    it('check pool version', async () => {
      const expectedPoolVersion = {
        name: 'GearboxLinearPool',
        version: 1,
        deployment: '20230213-gearbox-linear-pool',
      };

      expect(await pool.version()).to.equal(JSON.stringify(expectedPoolVersion));
    });
  });

  describe('join, and rebalance', () => {
    it('join the pool', async () => {
      // We're going to join with enough main token to bring the Pool above its upper target, which will let us later
      // rebalance.

      const joinAmount = INITIAL_UPPER_TARGET.mul(2).div(USDC_SCALING);

      await vault.connect(holder).swap(
        {
          kind: SwapKind.GivenIn,
          poolId,
          assetIn: USDC,
          assetOut: pool.address,
          amount: joinAmount,
          userData: '0x',
        },
        { sender: holder.address, recipient: holder.address, fromInternalBalance: false, toInternalBalance: false },
        0,
        MAX_UINT256
      );

      // Assert join amount - some fees will be collected as we're going over the upper target.
      const excess = joinAmount.mul(USDC_SCALING).sub(INITIAL_UPPER_TARGET);
      const joinCollectedFees = excess.mul(SWAP_FEE_PERCENTAGE).div(FP_ONE);

      const expectedBPT = joinAmount.mul(USDC_SCALING).sub(joinCollectedFees);
      expect(await pool.balanceOf(holder.address)).to.equal(expectedBPT);
    });

    itRebalancesThePool(LinearPoolState.MAIN_EXCESS);

    it('set final targets', async () => {
      await expect(pool.connect(owner).setTargets(FINAL_LOWER_TARGET, FINAL_UPPER_TARGET)).to.not.be.reverted;
    });
  });

  describe('generate excess of main token and rebalance', () => {
    before('approve the rebalancer', async () => {
      await mainToken.connect(holder).approve(rebalancer.address, MAX_UINT256); // To send extra main on rebalance
    });

    it('deposit main tokens', async () => {
      // We're going to join with enough main token to bring the Pool above its upper target, which will let us later
      // rebalance.

      const { upperTarget } = await pool.getTargets();
      const joinAmount = upperTarget.mul(5).div(USDC_SCALING);

      await vault.connect(holder).swap(
        {
          kind: SwapKind.GivenIn,
          poolId,
          assetIn: USDC,
          assetOut: pool.address,
          amount: joinAmount,
          userData: '0x',
        },
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
      // We're going to join with few tokens, causing the Pool to not reach its upper target.

      const { lowerTarget, upperTarget } = await pool.getTargets();
      const midpoint = lowerTarget.add(upperTarget).div(2);

      const joinAmount = midpoint.div(100).div(USDC_SCALING);

      await vault.connect(holder).swap(
        {
          kind: SwapKind.GivenIn,
          poolId,
          assetIn: USDC,
          assetOut: pool.address,
          amount: joinAmount,
          userData: '0x',
        },
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

  describe('rebalancer query protection', async () => {
    it('reverts with a malicious lending pool', async () => {
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

      await setCode(GEARBOX_VAULT, getArtifact('MockGearboxVault').deployedBytecode);
      const mockLendingPool = await deployedAt('MockGearboxVault', GEARBOX_VAULT);

      await mockLendingPool.setRevertType(2); // Type 2 is malicious swap query revert
      await expect(rebalancer.rebalance(other.address)).to.be.revertedWith('BAL#357'); // MALICIOUS_QUERY_REVERT
    });
  });

  describe('read-only reentrancy protection', () => {
    let attacker: Contract;

    before('deploy attacker', async () => {
      // Using Reentrancy Attacker from Aave Fork Test (task 20230206-aave-rebalanced-linear-pool-v4)
      attacker = await deploy('ReadOnlyReentrancyAttackerAaveLP', { args: [vault.address] });
    });

    async function performAttack(attackType: AttackType, ethAmount: BigNumber, expectRevert: boolean) {
      // To trigger the callback and revert, send more than we need for the deposit
      // If we send just enough, there will be no "extra" ETH, and it won't trigger the callback and attack
      const amountToSend = expectRevert ? ethAmount.add(1) : ethAmount;

      const attack = attacker.startAttack(pool.address, attackType, ethAmount, { value: amountToSend });
      if (expectRevert) {
        await expect(attack).to.be.revertedWith('BAL#420');
      } else {
        await expect(attack).to.not.be.reverted;
      }
    }

    function itPerformsAttack(expectRevert: boolean) {
      const action = expectRevert ? 'triggers' : 'does not trigger';

      context('set targets', () => {
        it(`${action} the set targets attack`, async () => {
          await performAttack(AttackType.SET_TARGETS, fp(1), expectRevert);
        });
      });

      context('set swap fee', () => {
        it(`${action} the set swap fee attack`, async () => {
          await performAttack(AttackType.SET_SWAP_FEE, fp(1), expectRevert);
        });
      });
    }

    context('when exactly enough ETH is sent', () => {
      itPerformsAttack(false);
    });

    context('when too much ETH is sent', () => {
      itPerformsAttack(true);
    });
  });
});
