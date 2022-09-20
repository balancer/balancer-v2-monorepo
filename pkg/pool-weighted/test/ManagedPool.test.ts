import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract, ContractReceipt } from 'ethers';

import { DAY, advanceTime } from '@balancer-labs/v2-helpers/src/time';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, bn, FP_ZERO, fp, fpDiv, fpMul, fromFp, pct } from '@balancer-labs/v2-helpers/src/numbers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { SwapKind } from '@balancer-labs/balancer-js';

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

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.05);

  const poolWeights: BigNumber[] = Array(TOKEN_COUNT).fill(fp(1 / TOKEN_COUNT));
  const initialBalances = Array(TOKEN_COUNT).fill(fp(1000));
  let sender: SignerWithAddress;

  sharedBeforeEach('deploy tokens and AUMProtocolFeeCollector', async () => {
    allTokens = await TokenList.create(MAX_TOKENS + 1, { sorted: true, varyDecimals: true });
    poolTokens = allTokens.subset(20);
    await allTokens.mint({ to: [other, owner], amount: fp(2000) });

    vault = await Vault.create({ admin });
    await allTokens.approve({ from: other, to: vault });
    await allTokens.approve({ from: owner, to: vault });
  });

  describe('when initialized with an LP allowlist', () => {
    sharedBeforeEach('deploy pool', async () => {
      const params = {
        tokens: poolTokens,
        weights: poolWeights,
        poolType: WeightedPoolType.MANAGED_POOL,
        vault,
        swapEnabledOnStart: true,
        mustAllowlistLPs: true,
        owner: owner.address,
      };
      pool = await WeightedPool.create(params);
    });

    context('when an address is added to the allowlist', () => {
      sharedBeforeEach('add address to allowlist', async () => {
        const receipt = await pool.addAllowedAddress(owner, other.address);

        expectEvent.inReceipt(await receipt.wait(), 'AllowlistAddressAdded', {
          member: other.address,
        });

        await pool.init({ from: other, initialBalances });
      });

      it('the listed LP can join', async () => {
        const startingBpt = await pool.balanceOf(other);

        const { amountsIn } = await pool.joinAllGivenOut({ from: other, bptOut: startingBpt });

        expect(amountsIn).to.deep.equal(initialBalances);
      });

      it('addresses not on the list cannot join', async () => {
        const startingBpt = await pool.balanceOf(owner);

        await expect(pool.joinAllGivenOut({ from: owner, bptOut: startingBpt })).to.be.revertedWith(
          'ADDRESS_NOT_ALLOWLISTED'
        );
      });
    });

    context('when mustAllowlistLPs is toggled', () => {
      sharedBeforeEach('initialize pool', async () => {
        await pool.init({ from: other, initialBalances });
      });

      it('allows owner to turn it off (open to public LPs)', async () => {
        const startingBpt = await pool.balanceOf(owner);

        const receipt = await pool.setMustAllowlistLPs(owner, false);
        expectEvent.inReceipt(await receipt.wait(), 'MustAllowlistLPsSet', {
          mustAllowlistLPs: false,
        });

        // Should be turned off
        expect(await pool.getMustAllowlistLPs()).to.be.false;

        // And allow joins from anywhere
        await expect(pool.joinAllGivenOut({ from: other, bptOut: startingBpt })).to.not.be.reverted;

        // Does not allow adding or removing addresses now
        await expect(pool.addAllowedAddress(owner, other.address)).to.be.revertedWith('FEATURE_DISABLED');
        await expect(pool.removeAllowedAddress(owner, other.address)).to.be.revertedWith('FEATURE_DISABLED');
      });
    });
  });

  describe('with valid creation parameters', () => {
    context('when initialized with swaps disabled', () => {
      sharedBeforeEach('deploy pool', async () => {
        const params = {
          tokens: poolTokens,
          weights: poolWeights,
          owner: owner.address,
          poolType: WeightedPoolType.MANAGED_POOL,
          swapEnabledOnStart: false,
        };
        pool = await WeightedPool.create(params);
      });

      it('swaps are blocked', async () => {
        await expect(pool.swapGivenIn({ in: 1, out: 0, amount: fp(0.1) })).to.be.revertedWith('SWAPS_DISABLED');
      });
    });

    context('when initialized with swaps enabled', () => {
      sharedBeforeEach('deploy pool', async () => {
        const params = {
          tokens: poolTokens,
          weights: poolWeights,
          vault,
          poolType: WeightedPoolType.MANAGED_POOL,
          swapEnabledOnStart: true,
        };
        pool = await WeightedPool.create(params);
      });

      it('swaps are not blocked', async () => {
        await pool.init({ from: other, initialBalances });

        await expect(pool.swapGivenIn({ in: 1, out: 0, amount: fp(0.1) })).to.not.be.reverted;
      });

      it('reverts if swap hook caller is not the vault', async () => {
        await expect(
          pool.instance[
            'onSwap((uint8,address,address,uint256,bytes32,uint256,address,address,bytes),uint256,uint256)'
          ](
            {
              kind: SwapKind.GivenIn,
              tokenIn: poolTokens.first.address,
              tokenOut: poolTokens.second.address,
              amount: 0,
              poolId: await pool.getPoolId(),
              lastChangeBlock: 0,
              from: other.address,
              to: other.address,
              userData: '0x',
            },
            0,
            0
          )
        ).to.be.revertedWith('CALLER_NOT_VAULT');
      });
    });
  });

  describe('permissioned actions', () => {
    describe('enable/disable swaps', () => {
      sharedBeforeEach('deploy pool', async () => {
        const params = {
          tokens: poolTokens,
          weights: poolWeights,
          owner: owner.address,
          vault,
          poolType: WeightedPoolType.MANAGED_POOL,
          swapEnabledOnStart: true,
        };
        pool = await WeightedPool.create(params);
      });

      context('when the sender is the owner', () => {
        beforeEach('set sender to owner', () => {
          sender = owner;
        });

        sharedBeforeEach('initialize pool', async () => {
          await pool.init({ from: sender, initialBalances });
        });

        context('with swaps disabled', () => {
          sharedBeforeEach(async () => {
            await pool.setSwapEnabled(sender, false);
          });

          context('proportional joins/exits', () => {
            it('allows proportionate joins', async () => {
              const startingBpt = await pool.balanceOf(sender);

              const { amountsIn } = await pool.joinAllGivenOut({ from: sender, bptOut: startingBpt });

              const endingBpt = await pool.balanceOf(sender);
              expect(endingBpt).to.be.gt(startingBpt);
              expect(amountsIn).to.deep.equal(initialBalances);
            });

            it('allows proportional exits', async () => {
              const previousBptBalance = await pool.balanceOf(sender);
              const bptIn = pct(previousBptBalance, 0.8);

              await expect(pool.multiExitGivenIn({ from: sender, bptIn })).to.not.be.reverted;

              const newBptBalance = await pool.balanceOf(sender);
              expect(newBptBalance).to.equalWithError(pct(previousBptBalance, 0.2), 0.001);
            });
          });

          context('disproportionate joins/exits', () => {
            it('prevents disproportionate joins (single token)', async () => {
              const bptOut = await pool.balanceOf(sender);

              await expect(pool.joinGivenOut({ from: sender, bptOut, token: poolTokens.get(0) })).to.be.revertedWith(
                'INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED'
              );
            });

            it('prevents disproportionate exits (single token)', async () => {
              const previousBptBalance = await pool.balanceOf(sender);
              const bptIn = pct(previousBptBalance, 0.5);

              await expect(
                pool.singleExitGivenIn({ from: sender, bptIn, token: poolTokens.get(0) })
              ).to.be.revertedWith('INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED');
            });

            it('prevents disproportionate joins (multi token)', async () => {
              const amountsIn = [...initialBalances];
              amountsIn[0] = 0;

              await expect(pool.joinGivenIn({ from: sender, amountsIn })).to.be.revertedWith(
                'INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED'
              );
            });

            it('prevents disproportionate exits (multi token)', async () => {
              const amountsOut = [...initialBalances];
              // Make it disproportionate (though it will fail with this exit type even if it's technically proportionate)
              amountsOut[0] = 0;

              await expect(pool.exitGivenOut({ from: sender, amountsOut })).to.be.revertedWith(
                'INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED'
              );
            });
          });
        });
      });
    });
  });

  describe('update swap fee', () => {
    const MAX_SWAP_FEE_PERCENTAGE = fp(0.8);

    sharedBeforeEach('deploy pool', async () => {
      const params = {
        tokens: poolTokens,
        weights: poolWeights,
        owner: owner.address,
        swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
        poolType: WeightedPoolType.MANAGED_POOL,
        swapEnabledOnStart: true,
      };
      pool = await WeightedPool.create(params);
      await pool.init({ from: owner, initialBalances });
    });

    /* Test that would cause joinSwap to fail at 100% fee, if allowed:

    context('with a 100% swap fee', () => {
      sharedBeforeEach('set swap fee to 100%', async () => {
        await pool.setSwapFeePercentage(owner, fp(1));
      });

      it('reverts on joinSwap', async () => {
        await expect(pool.joinGivenOut({ recipient: owner, bptOut: fp(1), token: 0 })).to.be.revertedWith('ZERO_DIVISION');
      });
    });*/

    context('with the max swap fee', () => {
      sharedBeforeEach('set swap fee to the max value (< 100%)', async () => {
        await pool.setSwapFeePercentage(owner, MAX_SWAP_FEE_PERCENTAGE);
      });

      it('allows (unfavorable) joinSwap', async () => {
        await expect(pool.joinGivenOut({ recipient: owner, bptOut: fp(1), token: 0 })).to.not.be.reverted;
      });
    });
  });

  describe('BPT protocol fees', () => {
    let protocolFeesCollector: Contract;
    let vault: Vault;
    const swapFeePercentage = fp(0.02);
    const protocolFeePercentage = fp(0.5); // 50 %
    const managementSwapFeePercentage = FP_ZERO; // Set to zero to isolate BPT fees
    const tokenAmount = 100;
    const poolWeights = [fp(0.8), fp(0.2)];
    let bptFeeBalance: BigNumber;
    let mockMath: Contract;
    let mockFees: Contract;

    let twoTokens: TokenList;
    let localBalances: Array<BigNumber>;
    let swapAmount: BigNumber;

    sharedBeforeEach('deploy pool', async () => {
      vault = await Vault.create({ admin });
      await vault.setSwapFeePercentage(protocolFeePercentage, { from: admin });
      protocolFeesCollector = await vault.getFeesCollector();

      twoTokens = poolTokens.subset(2);
      localBalances = [
        bn(tokenAmount * 10 ** twoTokens.first.decimals),
        bn(tokenAmount * 10 ** twoTokens.second.decimals),
      ];

      // 10% of the initial balance
      swapAmount = localBalances[0].div(10);

      // Make a 2-token pool for this purpose
      const params = {
        tokens: twoTokens,
        weights: poolWeights,
        owner: owner.address,
        poolType: WeightedPoolType.MANAGED_POOL,
        swapEnabledOnStart: true,
        vault,
        swapFeePercentage,
        managementSwapFeePercentage,
      };
      pool = await WeightedPool.create(params);
      mockMath = await deploy('MockWeightedMath');
      mockFees = await deploy('v2-pool-utils/MockInvariantGrowthProtocolSwapFees');
    });

    sharedBeforeEach('initialize pool', async () => {
      await poolTokens.mint({ to: owner, amount: fp(10000) });
      await poolTokens.approve({ from: owner, to: await pool.getVault() });
      await pool.init({ from: owner, initialBalances: localBalances });
    });

    it('protocol fees are initially zero', async () => {
      bptFeeBalance = await pool.balanceOf(protocolFeesCollector.address);

      expect(bptFeeBalance).to.equal(0);
    });

    describe('pays protocol fees on swaps', () => {
      let upscaledBalances: Array<BigNumber>;
      let upscaledSwapAmount: BigNumber;

      sharedBeforeEach('upscale balances and amounts', async () => {
        const scaleFactor0 = bn(10 ** (18 - twoTokens.first.decimals));
        const scaleFactor1 = bn(10 ** (18 - twoTokens.second.decimals));
        upscaledBalances = [localBalances[0].mul(scaleFactor0), localBalances[1].mul(scaleFactor1)];
        upscaledSwapAmount = swapAmount.mul(scaleFactor0);
      });

      it('charges the expected protocol fee', async () => {
        const actualProtocolFee = await protocolFeesCollector.getSwapFeePercentage();
        expect(actualProtocolFee).to.equal(protocolFeePercentage);
      });

      context('on swap given in', () => {
        it('pays fees on swap given in', async () => {
          const singleSwap = {
            poolId: await pool.getPoolId(),
            kind: SwapKind.GivenIn,
            assetIn: poolTokens.first.address,
            assetOut: poolTokens.second.address,
            amount: swapAmount,
            userData: '0x',
          };
          const funds = {
            sender: owner.address,
            fromInternalBalance: false,
            recipient: other.address,
            toInternalBalance: false,
          };
          const limit = 0; // Minimum amount out
          const deadline = MAX_UINT256;

          const prevInvariant = await mockMath.invariant(poolWeights, upscaledBalances);

          const adjustedAmountIn = fpMul(upscaledSwapAmount, fp(1).sub(swapFeePercentage));
          const amountOut = await mockMath.outGivenIn(
            upscaledBalances[0],
            poolWeights[0],
            upscaledBalances[1],
            poolWeights[1],
            adjustedAmountIn
          );

          const postBalances = [upscaledBalances[0].add(upscaledSwapAmount), upscaledBalances[1].sub(amountOut)];
          const postInvariant = await mockMath.invariant(poolWeights, postBalances);
          const totalSupply = await pool.totalSupply();

          const expectedProtocolFees = await mockFees.calculateDueProtocolFees(
            fpDiv(postInvariant, prevInvariant),
            totalSupply,
            totalSupply,
            protocolFeePercentage
          );

          await vault.instance.connect(owner).swap(singleSwap, funds, limit, deadline);

          bptFeeBalance = await pool.balanceOf(protocolFeesCollector.address);

          expect(bptFeeBalance).to.equalWithError(expectedProtocolFees, 0.000001);
        });
      });

      context('on swap given out', () => {
        it('pays fees on swap given out', async () => {
          const singleSwap = {
            poolId: await pool.getPoolId(),
            kind: SwapKind.GivenOut,
            assetIn: poolTokens.second.address,
            assetOut: poolTokens.first.address,
            amount: swapAmount,
            userData: '0x',
          };
          const funds = {
            sender: owner.address,
            fromInternalBalance: false,
            recipient: other.address,
            toInternalBalance: false,
          };
          const limit = MAX_UINT256; // Maximum amount in
          const deadline = MAX_UINT256;

          const prevInvariant = await mockMath.invariant(poolWeights, upscaledBalances);

          const amountIn = await mockMath.inGivenOut(
            upscaledBalances[1],
            poolWeights[1],
            upscaledBalances[0],
            poolWeights[0],
            upscaledSwapAmount
          );

          // Has to be a better way to do this...
          const proportion = fp(1).sub(swapFeePercentage);
          const adjustedAmountIn = fp(fromFp(amountIn).toNumber() / fromFp(proportion).toNumber());

          const postBalances = [upscaledBalances[1].sub(upscaledSwapAmount), upscaledBalances[0].add(adjustedAmountIn)];
          const postInvariant = await mockMath.invariant(poolWeights, postBalances);
          const totalSupply = await pool.totalSupply();

          const expectedProtocolFees = await mockFees.calculateDueProtocolFees(
            fpDiv(postInvariant, prevInvariant),
            totalSupply,
            totalSupply,
            protocolFeePercentage
          );

          await vault.instance.connect(owner).swap(singleSwap, funds, limit, deadline);

          bptFeeBalance = await pool.balanceOf(protocolFeesCollector.address);

          expect(bptFeeBalance).to.equalWithError(expectedProtocolFees, 0.000001);
        });
      });
    });

    describe('does not pay on join/exit', () => {
      context('with balance changes', () => {
        let currentBalances: BigNumber[];
        let bptIn: BigNumber;

        sharedBeforeEach('simulate increased initial balances', async () => {
          // 4/3 of the initial balances
          currentBalances = initialBalances.map((balance) => balance.mul(4).div(3));
          bptIn = (await pool.balanceOf(owner)).div(10);
        });

        it('no protocol fees on join exact tokens in for BPT out', async () => {
          await pool.joinGivenIn({ from: owner, amountsIn: fp(1), currentBalances });
          bptFeeBalance = await pool.balanceOf(protocolFeesCollector.address);

          expect(bptFeeBalance).to.be.zero;
        });

        it('no protocol fees on exit exact BPT in for one token out', async () => {
          await pool.singleExitGivenIn({
            from: owner,
            bptIn: bptIn,
            token: 0,
            currentBalances,
            protocolFeePercentage,
          });

          bptFeeBalance = await pool.balanceOf(protocolFeesCollector.address);

          expect(bptFeeBalance).to.be.zero;
        });

        it('no protocol fees on exit exact BPT in for all tokens out', async () => {
          await pool.multiExitGivenIn({
            from: owner,
            bptIn: bptIn,
            currentBalances,
            protocolFeePercentage,
          });

          bptFeeBalance = await pool.balanceOf(protocolFeesCollector.address);

          expect(bptFeeBalance).to.be.zero;
        });

        it('no protocol fees on exit BPT In for exact tokens out', async () => {
          const { balances } = await pool.getTokens();

          await pool.exitGivenOut({
            from: owner,
            amountsOut: [balances[0].div(5), balances[1].div(5)],
            maximumBptIn: MAX_UINT256,
            protocolFeePercentage,
          });

          bptFeeBalance = await pool.balanceOf(protocolFeesCollector.address);

          expect(bptFeeBalance).to.be.zero;
        });
      });
    });
  });

  describe('management fees', () => {
    const swapFeePercentage = fp(0.02);
    const managementSwapFeePercentage = fp(0.8);
    const managementAumFeePercentage = fp(0.01);

    sharedBeforeEach('deploy pool', async () => {
      const params = {
        tokens: poolTokens,
        weights: poolWeights,
        owner: owner.address,
        poolType: WeightedPoolType.MANAGED_POOL,
        swapEnabledOnStart: true,
        vault,
        swapFeePercentage,
        managementSwapFeePercentage,
        managementAumFeePercentage,
      };
      pool = await WeightedPool.create(params);
    });

    describe('management aum fee collection', () => {
      function expectedAUMFees(
        totalSupply: BigNumberish,
        aumFeePercentage: BigNumberish,
        timeElapsed: BigNumberish
      ): BigNumber {
        return bn(totalSupply)
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

          const totalSupply = await pool.totalSupply();
          const expectedManagementFeeBpt = expectedAUMFees(totalSupply, managementAumFeePercentage, timeElapsed);

          const receipt = await collectAUMFees();

          const balanceAfter = await pool.balanceOf(owner);
          const actualManagementFeeBpt = balanceAfter.sub(balanceBefore);
          expect(actualManagementFeeBpt).to.equalWithError(expectedManagementFeeBpt, 0.0001);

          expectEvent.inIndirectReceipt(receipt, pool.instance.interface, 'ManagementAumFeeCollected', {
            bptAmount: actualManagementFeeBpt,
          });
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
            const amountsIn = initialBalances.map((x) => x.div(2));
            const { receipt } = await pool.joinGivenIn({ from: other, amountsIn });
            return receipt;
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
