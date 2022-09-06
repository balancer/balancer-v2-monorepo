import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { FundManagement, SwapKind } from '@balancer-labs/balancer-js';
import { WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { fp, fpDiv, fpMul, FP_SCALING_FACTOR } from '@balancer-labs/v2-helpers/src/numbers';
import { range } from 'lodash';
import { itPaysProtocolFeesFromInvariantGrowth } from './WeightedPoolProtocolFees.behavior';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { deploy, getArtifact } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { ProtocolFee } from '@balancer-labs/v2-helpers/src/models/vault/types';

describe('WeightedPool', function () {
  let allTokens: TokenList;
  let lp: SignerWithAddress;

  const MAX_TOKENS = 8;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const WEIGHTS = range(1000, 1000 + MAX_TOKENS); // These will be normalized to weights that are close to each other, but different

  before('setup signers', async () => {
    [, lp] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy tokens', async () => {
    allTokens = await TokenList.create(MAX_TOKENS, { sorted: true, varyDecimals: true });
  });

  itPaysProtocolFeesFromInvariantGrowth();

  describe('recovery mode', () => {
    let pool: WeightedPool;
    let tokens: TokenList;

    const initialBalances = range(1, 3).map(fp);

    sharedBeforeEach('deploy pool', async () => {
      tokens = allTokens.subset(2);

      pool = await WeightedPool.create({
        poolType: WeightedPoolType.WEIGHTED_POOL,
        tokens,
        weights: WEIGHTS.slice(0, 2),
        swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
      });

      await pool.init({ initialBalances, recipient: lp });
    });

    context('when leaving recovery mode', () => {
      it('sets the lastPostJoinInvariant to the current invariant', async () => {
        // Set recovery mode to stop protocol fee calculations.
        await pool.enableRecoveryMode();

        // Perform a recovery mode exit. This will reduce the invariant but this isn't tracked due to recovery mode.
        const preExitInvariant = await pool.getLastPostJoinExitInvariant();
        await pool.recoveryModeExit({ from: lp, bptIn: fp(100) });
        const realPostExitInvariant = await pool.estimateInvariant();

        // Check that the real invariant is has dropped as a result of the exit.
        expect(realPostExitInvariant).to.be.lt(preExitInvariant);

        // On disabling recovery mode we expect the `lastPostJoinExitInvariant` to be be equal to the current value.
        await pool.disableRecoveryMode();
        const updatedLastPostJoinExitInvariant = await pool.getLastPostJoinExitInvariant();
        expect(updatedLastPostJoinExitInvariant).to.be.almostEqual(realPostExitInvariant);
      });
    });
  });

  describe('weights and scaling factors', () => {
    for (const numTokens of range(2, MAX_TOKENS + 1)) {
      context(`with ${numTokens} tokens`, () => {
        let pool: WeightedPool;
        let tokens: TokenList;

        sharedBeforeEach('deploy pool', async () => {
          tokens = allTokens.subset(numTokens);

          pool = await WeightedPool.create({
            poolType: WeightedPoolType.WEIGHTED_POOL,
            tokens,
            weights: WEIGHTS.slice(0, numTokens),
            swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
          });
        });

        it('sets token weights', async () => {
          const normalizedWeights = await pool.getNormalizedWeights();

          expect(normalizedWeights).to.deep.equal(pool.normalizedWeights);
        });

        it('sets scaling factors', async () => {
          const poolScalingFactors = await pool.getScalingFactors();
          const tokenScalingFactors = tokens.map((token) => fp(10 ** (18 - token.decimals)));

          expect(poolScalingFactors).to.deep.equal(tokenScalingFactors);
        });
      });
    }
  });

  describe('permissioned actions', () => {
    let pool: Contract;

    sharedBeforeEach('deploy pool', async () => {
      const vault = await Vault.create();

      pool = await deploy('MockWeightedPool', {
        args: [
          {
            name: '',
            symbol: '',
            tokens: allTokens.subset(2).addresses,
            normalizedWeights: [fp(0.5), fp(0.5)],
            rateProviders: new Array(2).fill(ZERO_ADDRESS),
            assetManagers: new Array(2).fill(ZERO_ADDRESS),
            swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
          },

          vault.address,
          vault.getFeesProvider().address,
          0,
          0,
          ZERO_ADDRESS,
        ],
      });
    });

    function itIsOwnerOnly(method: string) {
      it(`${method} can only be called by non-delegated owners`, async () => {
        expect(await pool.isOwnerOnlyAction(await actionId(pool, method))).to.be.true;
      });
    }

    function itIsNotOwnerOnly(method: string) {
      it(`${method} can never be called by the owner`, async () => {
        expect(await pool.isOwnerOnlyAction(await actionId(pool, method))).to.be.false;
      });
    }

    const poolArtifact = getArtifact('v2-pool-weighted/WeightedPool');
    const nonViewFunctions = poolArtifact.abi
      .filter(
        (elem) =>
          elem.type === 'function' && (elem.stateMutability === 'payable' || elem.stateMutability === 'nonpayable')
      )
      .map((fn) => fn.name);

    const expectedOwnerOnlyFunctions = ['setSwapFeePercentage', 'setAssetManagerPoolConfig'];

    const expectedNotOwnerOnlyFunctions = nonViewFunctions.filter((fn) => !expectedOwnerOnlyFunctions.includes(fn));

    describe('owner only actions', () => {
      for (const expectedOwnerOnlyFunction of expectedOwnerOnlyFunctions) {
        itIsOwnerOnly(expectedOwnerOnlyFunction);
      }
    });

    describe('non owner only actions', () => {
      for (const expectedNotOwnerOnlyFunction of expectedNotOwnerOnlyFunctions) {
        itIsNotOwnerOnly(expectedNotOwnerOnlyFunction);
      }
    });
  });

  describe('getRate and protocol fees', () => {
    const swapFeePercentage = fp(0.1); // 10 %
    const protocolFeePercentage = fp(0.5); // 50 %
    const numTokens = 2;

    let tokens: TokenList;
    let pool: WeightedPool;
    let vaultContract: Contract;

    sharedBeforeEach('deploy pool', async () => {
      tokens = allTokens.subset(numTokens);
      const vault = await Vault.create();
      vaultContract = vault.instance;

      await vault.setSwapFeePercentage(protocolFeePercentage);

      pool = await WeightedPool.create({
        poolType: WeightedPoolType.WEIGHTED_POOL,
        tokens,
        weights: WEIGHTS.slice(0, numTokens),
        swapFeePercentage: swapFeePercentage,
        vault,
      });
    });

    context('before initialized', () => {
      it('rate is zero', async () => {
        await expect(pool.getRate()).to.be.revertedWith('ZERO_INVARIANT');
      });
    });

    context('once initialized', () => {
      sharedBeforeEach('initialize pool', async () => {
        // Init pool with equal balances so that each BPT accounts for approximately one underlying token.
        const equalBalances = Array(numTokens).fill(fp(100));

        await allTokens.mint({ to: lp.address, amount: fp(1000) });
        await allTokens.approve({ from: lp, to: pool.vault.address });

        await pool.init({ from: lp, recipient: lp.address, initialBalances: equalBalances });
      });

      context('without protocol fees', () => {
        it('reports correctly', async () => {
          const totalSupply = await pool.totalSupply();
          const invariant = await pool.estimateInvariant();

          const expectedRate = fpDiv(invariant.mul(numTokens), totalSupply);
          const rate = await pool.getRate();

          expect(rate).to.be.equalWithError(expectedRate, 0.0001);
        });
      });

      context('with protocol fees', () => {
        let unmintedBPT: BigNumber;
        let originalRate: BigNumber;

        async function expectNoRateChange(action: () => Promise<void>): Promise<void> {
          const rateBeforeAction = await pool.getRate();

          await action();

          const rateAfterAction = await pool.getRate();

          // There's some minute diference due to rounding error
          const rateDelta = rateAfterAction.sub(rateBeforeAction);
          expect(rateDelta.abs()).to.be.lte(2);
        }

        sharedBeforeEach('swap bpt in', async () => {
          const amount = fp(20);
          const tokenIn = tokens.first;
          const tokenOut = tokens.second;

          originalRate = await pool.getRate();
          const originalInvariant = await pool.instance.getInvariant();

          const singleSwap = {
            poolId: await pool.getPoolId(),
            kind: SwapKind.GivenIn,
            assetIn: tokenIn.address,
            assetOut: tokenOut.address,
            amount: amount,
            userData: '0x',
          };

          const funds: FundManagement = {
            sender: lp.address,
            recipient: lp.address,
            fromInternalBalance: false,
            toInternalBalance: false,
          };

          await vaultContract.connect(lp).swap(singleSwap, funds, 0, MAX_UINT256);

          const postInvariant = await pool.instance.getInvariant();
          const swapFeesPercentage = FP_SCALING_FACTOR.sub(fpDiv(originalInvariant, postInvariant));
          const protocolOwnershipPercentage = fpMul(swapFeesPercentage, protocolFeePercentage);

          unmintedBPT = fpMul(
            await pool.totalSupply(),
            fpDiv(protocolOwnershipPercentage, FP_SCALING_FACTOR.sub(protocolOwnershipPercentage))
          );
        });

        it('uncollected protocol fees should increase the effective supply (and lower the rate)', async () => {
          const rate = await pool.getRate();

          // We expect that the Pool has accrued fees due to the swap, which increases the BPT's rate.
          // Check that we have a difference of at least 0.01% to discard rounding error.
          expect(originalRate).to.be.lt(rate.mul(9999).div(10000));

          const invariant = await pool.instance.getInvariant();
          const numTokens = pool.tokens.length;
          const totalSupply = await pool.totalSupply();

          const feelessRate = fpDiv(invariant.mul(numTokens), totalSupply);

          // The Pool should report a rate which is lower than it would have for the current balances where we are
          // ignoring protocol fees.
          // Check that we have a difference of at least 0.01% to discard rounding error.
          expect(rate).to.be.lt(feelessRate.mul(9999).div(10000));
        });

        it('the actual supply takes into account unminted protocol fees', async () => {
          const totalSupply = await pool.totalSupply();
          const expectedActualSupply = totalSupply.add(unmintedBPT);

          expect(await pool.getActualSupply()).to.almostEqual(expectedActualSupply, 1e-6);
        });

        it('minting protocol fee BPT should not affect rate', async () => {
          await expectNoRateChange(async () => {
            await pool.joinAllGivenOut({ from: lp, bptOut: fp(1) });
          });
        });

        function itReactsToProtocolFeePercentageChangesCorrectly(feeType: number) {
          it('rate does not change on protocol fee update', async () => {
            await expectNoRateChange(async () => {
              // Changing the fee on the providere should cause no changes as the Pool ignores the provider outside
              // of cache updates.
              await pool.vault.setFeeTypePercentage(feeType, protocolFeePercentage.div(2));
            });
          });

          it('rate does not change on protocol fee cache update', async () => {
            await expectNoRateChange(async () => {
              // Even though there's due protocol fees, which are a function of the protocol fee percentage, changing
              // this value should not change the Pool's rate (to avoid manipulation).
              await pool.vault.setFeeTypePercentage(feeType, protocolFeePercentage.div(2));
              await pool.updateProtocolFeePercentageCache();
            });
          });

          it('due protocol fees are minted on protocol fee cache update', async () => {
            await pool.vault.setFeeTypePercentage(feeType, protocolFeePercentage.div(2));
            const receipt = await (await pool.updateProtocolFeePercentageCache()).wait();

            const event = expectEvent.inReceipt(receipt, 'Transfer', {
              from: ZERO_ADDRESS,
              to: (await pool.vault.getFeesCollector()).address,
            });

            expect(event.args.value).to.be.almostEqual(unmintedBPT, 1e-6);
          });

          it('repeated protocol fee cache updates do not mint any more fees', async () => {
            await pool.vault.setFeeTypePercentage(feeType, protocolFeePercentage.div(2));
            await pool.updateProtocolFeePercentageCache();

            await pool.vault.setFeeTypePercentage(feeType, protocolFeePercentage.div(4));
            const receipt = await (await pool.updateProtocolFeePercentageCache()).wait();

            expectEvent.notEmitted(receipt, 'Transfer');
          });

          context('when paused', () => {
            sharedBeforeEach('pause pool', async () => {
              await pool.pause();
            });

            it('reverts on protocol fee cache updated', async () => {
              await pool.vault.setFeeTypePercentage(feeType, protocolFeePercentage.div(2));
              await expect(pool.updateProtocolFeePercentageCache()).to.be.revertedWith('PAUSED');
            });
          });
        }

        context('on swap protocol fee change', () => {
          itReactsToProtocolFeePercentageChangesCorrectly(ProtocolFee.SWAP);
        });

        context('on yield protocol fee change', () => {
          itReactsToProtocolFeePercentageChangesCorrectly(ProtocolFee.YIELD);
        });

        context('on aum protocol fee change', () => {
          itReactsToProtocolFeePercentageChangesCorrectly(ProtocolFee.AUM);
        });
      });
    });
  });
});
