import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, ContractReceipt } from 'ethers';

import { BigNumberish, bn, fp, FP_ONE, FP_ZERO, pct } from '@balancer-labs/v2-helpers/src/numbers';
import {
  DAY,
  advanceTime,
  receiptTimestamp,
  currentTimestamp,
  setNextBlockTimestamp,
} from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import {
  RawWeightedPoolDeployment,
  SwapResult,
  WeightedPoolType,
} from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('ManagedPool', function () {
  let allTokens: TokenList;
  let poolTokens: TokenList;
  let admin: SignerWithAddress, owner: SignerWithAddress, other: SignerWithAddress;
  let pool: WeightedPool;
  let vault: Vault;

  before('setup signers', async () => {
    [, admin, owner, other] = await ethers.getSigners();
  });

  const MAX_TOKENS = 38;
  const TOKEN_COUNT = 20;

  const BPT_INDEX = 0;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.05);

  const poolWeights: BigNumber[] = Array(TOKEN_COUNT).fill(fp(1 / TOKEN_COUNT));
  const initialBalances = Array(TOKEN_COUNT).fill(fp(1000));

  sharedBeforeEach('deploy tokens and AUMProtocolFeeCollector', async () => {
    allTokens = await TokenList.create(MAX_TOKENS + 1, { sorted: true, varyDecimals: true });
    poolTokens = allTokens.subset(20);
    await allTokens.mint({ to: [other, owner], amount: fp(2000) });

    vault = await Vault.create({ admin });
    await allTokens.approve({ from: other, to: vault });
    await allTokens.approve({ from: owner, to: vault });
  });

  async function deployPool(overrides: RawWeightedPoolDeployment = {}): Promise<WeightedPool> {
    const params = {
      vault,
      tokens: poolTokens,
      weights: poolWeights,
      owner: owner.address,
      poolType: WeightedPoolType.MOCK_MANAGED_POOL,
      mockContractName: 'MockManagedPool',
      ...overrides,
    };
    return WeightedPool.create(params);
  }

  describe('construction', () => {
    context('pool registration', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool();
      });

      it('returns pool ID registered by the vault', async () => {
        const poolId = await pool.getPoolId();
        const { address: poolAddress } = await vault.getPool(poolId);
        expect(poolAddress).to.be.eq(pool.address);
      });

      it('registers with the MinimalSwapInfo specialization', async () => {
        const { specialization } = await vault.getPool(pool.poolId);
        expect(specialization).to.be.eq(PoolSpecialization.MinimalSwapInfoPool);
      });

      it('registers all the expected tokens', async () => {
        const { tokens } = await vault.getPoolTokens(pool.poolId);
        expect(tokens).to.be.deep.eq([pool.address, ...poolTokens.addresses]);
      });

      it('registers all the expected asset managers', async () => {
        await poolTokens.asyncEach(async (token) => {
          const { assetManager } = await vault.getPoolTokenInfo(pool.poolId, token);
          expect(assetManager).to.be.eq(ZERO_ADDRESS);
        });
      });
    });
  });

  describe('swap', () => {
    sharedBeforeEach('deploy pool', async () => {
      pool = await deployPool({ vault: undefined, swapEnabledOnStart: true });

      await pool.init({ from: other, initialBalances });
    });

    context('token swaps', () => {
      context('when swaps are disabled', () => {
        sharedBeforeEach('deploy pool', async () => {
          await pool.setSwapEnabled(owner, false);
        });

        it('it reverts', async () => {
          await expect(pool.swapGivenIn({ in: 1, out: 2, amount: fp(0.1) })).to.be.revertedWith('SWAPS_DISABLED');
        });
      });

      context('when swaps are enabled', () => {
        sharedBeforeEach('deploy pool', async () => {
          await pool.setSwapEnabled(owner, true);
        });

        it('swaps are not blocked', async () => {
          await expect(pool.swapGivenIn({ in: 1, out: 2, amount: fp(0.1) })).to.not.be.reverted;
        });
      });
    });

    context('join swaps', () => {
      function itPerformsAJoinSwapCorrectly(doJoinSwap: () => Promise<SwapResult>) {
        function doesJoinThingsCorrectly() {
          it("doesn't revert", async () => {
            await expect(doJoinSwap()).to.not.be.reverted;
          });
        }

        context('when swaps are disabled', () => {
          sharedBeforeEach('disable swaps', async () => {
            await pool.setSwapEnabled(owner, false);
          });

          it('it reverts', async () => {
            await expect(doJoinSwap()).to.be.revertedWith('SWAPS_DISABLED');
          });
        });

        context('when swaps are enabled', () => {
          sharedBeforeEach('enable swaps', async () => {
            await pool.setSwapEnabled(owner, true);
          });

          context('when LP allowlist is enabled', () => {
            sharedBeforeEach('enable allowlist', async () => {
              await pool.setMustAllowlistLPs(owner, true);
            });

            context('when trader is allowlisted', () => {
              sharedBeforeEach('allowlist LP', async () => {
                await pool.addAllowedAddress(owner, other);
              });

              doesJoinThingsCorrectly();
            });

            context('when trader is not allowlisted', () => {
              it('reverts', async () => {
                await expect(doJoinSwap()).to.be.revertedWith('ADDRESS_NOT_ALLOWLISTED');
              });
            });
          });

          context('when LP allowlist is disabled', () => {
            sharedBeforeEach('disable allowlist', async () => {
              await pool.setMustAllowlistLPs(owner, false);
            });

            doesJoinThingsCorrectly();
          });
        });
      }

      context('given in', () => {
        itPerformsAJoinSwapCorrectly(() => pool.swapGivenIn({ in: 1, out: BPT_INDEX, amount: fp(0.1), from: other }));
      });

      context('given out', () => {
        itPerformsAJoinSwapCorrectly(() => pool.swapGivenOut({ in: 1, out: BPT_INDEX, amount: fp(0.1), from: other }));
      });
    });
  });

  describe('initialization', () => {
    function itInitializesThePoolCorrectly() {
      it('initializes the pool', async () => {
        await pool.init({ from: other, initialBalances });

        expect(await pool.totalSupply()).to.be.gt(0);
      });

      it('sets the first AUM fee collection timestamp', async () => {
        const { receipt } = await pool.init({ from: other, initialBalances });

        expect(await pool.instance.getLastAumFeeCollectionTimestamp()).to.be.eq(await receiptTimestamp(receipt));
      });
    }

    context('LP allowlist', () => {
      context('when LP allowlist is enabled', () => {
        sharedBeforeEach('deploy pool', async () => {
          pool = await deployPool({ mustAllowlistLPs: true });
        });

        context('when initial LP is allowlisted', () => {
          sharedBeforeEach('allowlist LP', async () => {
            await pool.addAllowedAddress(owner, other);
          });

          itInitializesThePoolCorrectly();
        });

        context('when initial LP is not allowlisted', () => {
          it('reverts', async () => {
            await expect(pool.init({ from: other, initialBalances })).to.be.revertedWith('ADDRESS_NOT_ALLOWLISTED');
          });
        });
      });

      context('when LP allowlist is disabled', () => {
        sharedBeforeEach('deploy pool', async () => {
          pool = await deployPool({ mustAllowlistLPs: false });
        });
        itInitializesThePoolCorrectly();
      });
    });
  });

  describe('joinPool', () => {
    context('when LP allowlist is enabled', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool();
        await pool.init({ from: other, initialBalances });

        await pool.setMustAllowlistLPs(owner, true);
      });

      context('when LP is on the allowlist', () => {
        sharedBeforeEach('add address to allowlist', async () => {
          await pool.addAllowedAddress(owner, other.address);
        });

        it('the listed LP can join', async () => {
          await pool.joinAllGivenOut({ from: other, bptOut: FP_ONE });

          expect(await pool.balanceOf(other)).to.be.gt(0);
        });
      });

      context('when LP is not on the allowlist', () => {
        it('it reverts', async () => {
          await expect(pool.joinAllGivenOut({ from: other, bptOut: FP_ONE })).to.be.revertedWith(
            'ADDRESS_NOT_ALLOWLISTED'
          );
        });
      });
    });

    context('when swaps are disabled', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool({ swapEnabledOnStart: false });
        await pool.init({ from: other, initialBalances });
      });

      context('proportional joins', () => {
        it('allows proportionate joins', async () => {
          const startingBpt = await pool.balanceOf(other);

          const { amountsIn } = await pool.joinAllGivenOut({ from: other, bptOut: startingBpt });

          const endingBpt = await pool.balanceOf(other);
          expect(endingBpt).to.be.gt(startingBpt);
          expect(amountsIn).to.deep.equal([FP_ZERO, ...initialBalances]);
        });
      });

      context('disproportionate joins', () => {
        it('prevents disproportionate joins (single token)', async () => {
          const bptOut = await pool.balanceOf(other);

          await expect(pool.joinGivenOut({ from: other, bptOut, token: poolTokens.get(0) })).to.be.revertedWith(
            'INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED'
          );
        });

        it('prevents disproportionate joins (multi token)', async () => {
          const amountsIn = [...initialBalances];
          amountsIn[0] = 0;

          await expect(pool.joinGivenIn({ from: other, amountsIn })).to.be.revertedWith(
            'INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED'
          );
        });
      });
    });
  });

  describe('exitPool', () => {
    context('when LP allowlist is enabled', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool();
        await pool.init({ from: other, initialBalances });

        await pool.setMustAllowlistLPs(owner, true);
      });

      context('when LP is on the allowlist', () => {
        sharedBeforeEach('add address to allowlist', async () => {
          await pool.addAllowedAddress(owner, other.address);
        });

        it('the listed LP can exit', async () => {
          await expect(pool.multiExitGivenIn({ from: other, bptIn: FP_ONE })).to.not.be.reverted;
        });
      });

      context('when LP is not on the allowlist', () => {
        it('the listed LP can exit', async () => {
          await expect(pool.multiExitGivenIn({ from: other, bptIn: FP_ONE })).to.not.be.reverted;
        });
      });
    });

    context('when swaps are disabled', () => {
      sharedBeforeEach('deploy pool', async () => {
        pool = await deployPool({
          swapEnabledOnStart: false,
        });
        await pool.init({ from: other, initialBalances });
      });

      context('proportional exits', () => {
        it('allows proportional exits', async () => {
          const previousBptBalance = await pool.balanceOf(other);
          const bptIn = pct(previousBptBalance, 0.8);

          await expect(pool.multiExitGivenIn({ from: other, bptIn })).to.not.be.reverted;

          const newBptBalance = await pool.balanceOf(other);
          expect(newBptBalance).to.equalWithError(pct(previousBptBalance, 0.2), 0.001);
        });
      });

      context('disproportionate exits', () => {
        it('prevents disproportionate exits (single token)', async () => {
          const previousBptBalance = await pool.balanceOf(other);
          const bptIn = pct(previousBptBalance, 0.5);

          await expect(pool.singleExitGivenIn({ from: other, bptIn, token: poolTokens.get(0) })).to.be.revertedWith(
            'INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED'
          );
        });

        it('prevents disproportionate exits (multi token)', async () => {
          const amountsOut = [...initialBalances];
          // Make it disproportionate (though it will fail with this exit type even if it's technically proportionate)
          amountsOut[0] = 0;

          await expect(pool.exitGivenOut({ from: other, amountsOut })).to.be.revertedWith(
            'INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED'
          );
        });
      });
    });
  });

  describe('update swap fee', () => {
    const MAX_SWAP_FEE_PERCENTAGE = fp(0.8);

    sharedBeforeEach('deploy pool', async () => {
      pool = await deployPool({ vault: undefined, swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE });
      await pool.init({ from: owner, initialBalances });
    });

    /* Test that would cause joinSwap to fail at 100% fee, if allowed:

    context('with a 100% swap fee', () => {
      sharedBeforeEach('set swap fee to 100%', async () => {
        const blockTimestamp = (await currentTimestamp()).add(1);
        await setNextBlockTimestamp(blockTimestamp);
        await pool.updateSwapFeeGradually(owner, blockTimestamp, blockTimestamp, fp(1), fp(1));
      });

      it('reverts on joinSwap', async () => {
        await expect(pool.joinGivenOut({ recipient: owner, bptOut: fp(1), token: 0 })).to.be.revertedWith('ZERO_DIVISION');
      });
    });*/

    context('with the max swap fee', () => {
      sharedBeforeEach('set swap fee to the max value (< 100%)', async () => {
        // In practice, a separate contract would call `updateSwapFeeGradually` using `block.timestamp` both as start
        // and endTime to make the change immediately.
        const nextBlockTimestamp = (await currentTimestamp()).add(1);
        await setNextBlockTimestamp(nextBlockTimestamp);
        await pool.updateSwapFeeGradually(
          owner,
          nextBlockTimestamp,
          nextBlockTimestamp,
          MAX_SWAP_FEE_PERCENTAGE,
          MAX_SWAP_FEE_PERCENTAGE
        );
      });

      it('allows (unfavorable) joinSwap', async () => {
        await expect(pool.joinGivenOut({ recipient: owner, bptOut: fp(1), token: 0 })).to.not.be.reverted;
      });
    });
  });

  describe('management fees', () => {
    const swapFeePercentage = fp(0.02);
    const managementAumFeePercentage = fp(0.1);

    sharedBeforeEach('deploy pool', async () => {
      pool = await deployPool({ swapFeePercentage, managementAumFeePercentage, vault: undefined });
    });

    describe('management aum fee collection', () => {
      function expectedAUMFees(
        virtualSupply: BigNumberish,
        aumFeePercentage: BigNumberish,
        timeElapsed: BigNumberish
      ): BigNumber {
        return bn(virtualSupply)
          .mul(timeElapsed)
          .div(365 * DAY)
          .mul(aumFeePercentage)
          .div(fp(1).sub(aumFeePercentage));
      }

      function itReverts(collectAUMFees: () => Promise<ContractReceipt>) {
        it('reverts', async () => {
          await expect(collectAUMFees()).to.be.revertedWith('PAUSED');
        });
      }

      function itCollectsNoAUMFees(collectAUMFees: () => Promise<ContractReceipt>) {
        it('collects no AUM fees', async () => {
          const balanceBefore = await pool.balanceOf(owner);

          const receipt = await collectAUMFees();

          const balanceAfter = await pool.balanceOf(owner);
          expect(balanceAfter).to.equal(balanceBefore);

          expectEvent.notEmitted(receipt, 'ManagementAumFeeCollected');
        });
      }

      function itCollectsAUMFeesForExpectedDuration(
        collectAUMFees: () => Promise<ContractReceipt>,
        timeElapsed: BigNumberish
      ) {
        it('collects the expected amount of fees', async () => {
          const balanceBefore = await pool.balanceOf(owner);

          const virtualSupply = await pool.getVirtualSupply();
          const expectedManagementFeeBpt = expectedAUMFees(virtualSupply, managementAumFeePercentage, timeElapsed);

          const receipt = await collectAUMFees();

          const balanceAfter = await pool.balanceOf(owner);
          const actualManagementFeeBpt = balanceAfter.sub(balanceBefore);
          expect(actualManagementFeeBpt).to.equalWithError(expectedManagementFeeBpt, 0.0001);

          expectEvent.inIndirectReceipt(receipt, pool.instance.interface, 'ManagementAumFeeCollected', {
            bptAmount: actualManagementFeeBpt,
          });
        });

        it('reports the expected actual supply', async () => {
          // As we're performing a join or exit here we need to account for the change in the BPT virtual supply due to
          // the join/exit. We do this by tracking the user's balance.
          const balanceBefore = await pool.balanceOf(other);
          const virtualSupplyBefore = await pool.getVirtualSupply();
          const expectedManagementFeeBpt = expectedAUMFees(
            virtualSupplyBefore,
            managementAumFeePercentage,
            timeElapsed
          );

          const balanceAfter = await pool.balanceOf(other);
          const joinExitDelta = balanceAfter.sub(balanceBefore);

          const expectedActualSupply = virtualSupplyBefore.add(expectedManagementFeeBpt).add(joinExitDelta);
          const actualSupply = await pool.getActualSupply();
          expect(actualSupply).to.be.equalWithError(expectedActualSupply, 1e-6);
        });

        it('does not affect the actual supply', async () => {
          // As we're performing a join or exit here we need to account for the change in the BPT virtual supply due to
          // the join/exit. We do this by tracking the user's balance.
          const balanceBefore = await pool.balanceOf(other);
          const actualSupplyBefore = await pool.getActualSupply();

          await collectAUMFees();

          const balanceAfter = await pool.balanceOf(other);
          const joinExitDelta = balanceAfter.sub(balanceBefore);

          const actualSupplyAfter = await pool.getActualSupply();
          expect(actualSupplyAfter).to.be.equalWithError(actualSupplyBefore.add(joinExitDelta), 1e-5);
        });

        it('syncs the total supply to the actual supply', async () => {
          // As we're performing a join or exit here we need to account for the change in the BPT virtual supply due to
          // the join/exit. We do this by tracking the user's balance.
          const balanceBefore = await pool.balanceOf(other);
          const actualSupplyBefore = await pool.getActualSupply();

          await collectAUMFees();

          const balanceAfter = await pool.balanceOf(other);
          const joinExitDelta = balanceAfter.sub(balanceBefore);

          const virtualSupplyAfter = await pool.getVirtualSupply();
          expect(virtualSupplyAfter).to.equalWithError(actualSupplyBefore.add(joinExitDelta), 1e-5);
        });
      }

      function itCollectsAUMFeesCorrectly(collectAUMFees: () => Promise<ContractReceipt>) {
        const timeElapsed = 10 * DAY;

        sharedBeforeEach('advance time', async () => {
          await advanceTime(timeElapsed);
        });

        itCollectsAUMFeesForExpectedDuration(collectAUMFees, timeElapsed);

        context('when the pool is paused and enters into recovery mode', () => {
          sharedBeforeEach('pause pool and enter recovery mode', async () => {
            await pool.pause();
            await pool.enableRecoveryMode();
          });

          itReverts(collectAUMFees);

          context('when the pool is then unpaused and removed from recovery mode', () => {
            sharedBeforeEach('unpause pool and exit recovery mode', async () => {
              // Exiting recovery mode will update the timestamp of the last collection.
              // This avoids the pool overcharging AUM fees after the unpause.
              await pool.unpause();
              await pool.disableRecoveryMode();

              // We now advance time so that we can test that the collected fees correspond to `timeElapsed`,
              // rather than `2 * timeElapsed` as we'd expect if the pool didn't correctly update while paused.
              await advanceTime(timeElapsed);
            });

            itCollectsAUMFeesForExpectedDuration(collectAUMFees, timeElapsed);
          });
        });
      }

      sharedBeforeEach('mint tokens', async () => {
        await poolTokens.mint({ to: other, amount: fp(10000) });
        await poolTokens.approve({ from: other, to: await pool.getVault() });
      });

      context('on pool joins', () => {
        context('on pool initialization', () => {
          itCollectsNoAUMFees(async () => {
            const { receipt } = await pool.init({ from: other, recipient: other, initialBalances });
            return receipt;
          });
        });

        context('after pool initialization', () => {
          sharedBeforeEach('initialize pool', async () => {
            await pool.init({ from: other, initialBalances });
          });

          itCollectsAUMFeesCorrectly(async () => {
            const { receipt } = await pool.joinAllGivenOut({ from: other, bptOut: FP_ONE });
            return receipt;
          });
        });
      });

      context('on joinSwaps', () => {
        context('after pool initialization', () => {
          sharedBeforeEach('initialize pool', async () => {
            await pool.init({ from: other, initialBalances });
          });

          context('given in', () => {
            itCollectsAUMFeesCorrectly(async () => {
              const { receipt } = await pool.swapGivenIn({
                in: 1,
                out: BPT_INDEX,
                from: other,
                recipient: other,
                amount: FP_ONE,
              });
              return receipt;
            });
          });

          context('given out', () => {
            itCollectsAUMFeesCorrectly(async () => {
              const { receipt } = await pool.swapGivenOut({
                in: 1,
                out: BPT_INDEX,
                from: other,
                recipient: other,
                amount: FP_ONE,
              });
              return receipt;
            });
          });
        });
      });

      context('on pool exits', () => {
        sharedBeforeEach('initialize pool', async () => {
          await pool.init({ from: other, initialBalances });
        });

        itCollectsAUMFeesCorrectly(async () => {
          const { receipt } = await pool.multiExitGivenIn({ from: other, bptIn: await pool.balanceOf(other) });
          return receipt;
        });
      });
    });
  });
});
