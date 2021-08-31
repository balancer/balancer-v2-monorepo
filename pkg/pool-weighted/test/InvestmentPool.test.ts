import { ethers } from 'hardhat';
import { expect } from 'chai';
import { fp, pct, arraySub } from '@balancer-labs/v2-helpers/src/numbers';
import { BigNumber, Contract } from 'ethers';
import { MINUTE, DAY, advanceTime, currentTimestamp } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { JoinResult, WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { SwapKind } from '@balancer-labs/balancer-js';
import { FundManagement } from '@balancer-labs/balancer-js/src/types';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { range } from 'lodash';

describe('InvestmentPool', function () {
  let allTokens: TokenList;
  let poolTokens: TokenList;
  let tooManyWeights: BigNumber[];
  let owner: SignerWithAddress, other: SignerWithAddress;
  let assetManager: SignerWithAddress;
  let admin: SignerWithAddress;
  let lp: SignerWithAddress;
  let trader: SignerWithAddress;
  let vault: Vault;
  let funds: FundManagement;
  let pool: WeightedPool;

  before('setup signers', async () => {
    [, owner, other, assetManager, lp, trader] = await ethers.getSigners();
  });

  const MAX_TOKENS = 100;
  const TOKEN_COUNT = 20;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const PROTOCOL_SWAP_FEE_PERCENTAGE = fp(0.1);
  const MANAGEMENT_FEE_PERCENTAGE = fp(0.2);
  const WEIGHTS = range(10000, 10000 + MAX_TOKENS); // These will be normalized to weights that are close to each other, but different

  const poolWeights: BigNumber[] = Array(TOKEN_COUNT).fill(fp(1 / TOKEN_COUNT)); //WEIGHTS.slice(0, TOKEN_COUNT).map(fp);
  const initialBalances = Array(TOKEN_COUNT).fill(fp(1));
  let sender: SignerWithAddress;

  sharedBeforeEach('deploy vault and tokens', async () => {
    vault = await Vault.create({ admin });
    allTokens = await TokenList.create(MAX_TOKENS, { sorted: true, varyDecimals: true });
    tooManyWeights = Array(allTokens.length).fill(fp(0.01));
    poolTokens = allTokens.subset(20);
    await poolTokens.mint({ to: [other], amount: fp(200) });

    funds = {
      sender: trader.address,
      recipient: trader.address,
      fromInternalBalance: false,
      toInternalBalance: false,
    };
  });

  describe('asset managers', () => {
    let factory: Contract;
    let tokens: TokenList;
    let validWeights: BigNumber[];
    let validManagers: string[];
    const swapEnabledOnStart = true;

    sharedBeforeEach('deploy factory & tokens', async () => {
      factory = await deploy('InvestmentPoolFactory', { args: [vault.address] });

      tokens = await TokenList.create(['MKR', 'DAI', 'SNX', 'BAT'], { sorted: true });

      validWeights = Array(tokens.length).fill(fp(1 / tokens.length));
      validManagers = Array(tokens.length).fill(assetManager.address);
    });

    async function createPool(
      weights: BigNumber[] = validWeights,
      assetManagers: string[] = validManagers
    ): Promise<Contract> {
      const receipt = await (
        await factory.create(
          'Balancer Investment Pool',
          'INV-BPT',
          tokens.addresses,
          weights,
          assetManagers,
          POOL_SWAP_FEE_PERCENTAGE,
          owner.address,
          swapEnabledOnStart,
          MANAGEMENT_FEE_PERCENTAGE
        )
      ).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      return deployedAt('InvestmentPool', event.args.pool);
    }

    it('should have asset managers', async () => {
      const pool = await createPool();
      const poolId = await pool.getPoolId();

      await tokens.asyncEach(async (token) => {
        const info = await vault.getPoolTokenInfo(poolId, token);
        expect(info.assetManager).to.equal(assetManager.address);
      });
    });

    it('should fail if weights wrong length', async () => {
      const badWeights = Array(MAX_TOKENS).fill(fp(0.01));
      await expect(createPool(badWeights)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
    });

    it('should fail if asset managers wrong length', async () => {
      const badManagers = Array(MAX_TOKENS).fill(assetManager.address);

      await expect(createPool(validWeights, badManagers)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
    });
  });

  describe.skip('weights and scaling factors', () => {
    for (const numTokens of range(99, MAX_TOKENS + 1)) {
      context(`with ${numTokens} tokens`, () => {
        let tokens: TokenList;

        sharedBeforeEach('deploy pool', async () => {
          tokens = allTokens.subset(numTokens);

          pool = await WeightedPool.create({
            poolType: WeightedPoolType.INVESTMENT_POOL,
            tokens,
            weights: WEIGHTS.slice(0, numTokens),
            swapEnabledOnStart: true,
            swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
            managementFeePercentage: MANAGEMENT_FEE_PERCENTAGE,
          });
        });

        it('sets token weights', async () => {
          const normalizedWeights = await pool.getNormalizedWeights();

          for (let i = 0; i < numTokens; i++) {
            expectEqualWithError(normalizedWeights[i], pool.normalizedWeights[i], 0.0000001);
          }
        });

        it('sets scaling factors', async () => {
          const poolScalingFactors = await pool.getScalingFactors();
          const tokenScalingFactors = tokens.map((token) => fp(10 ** (18 - token.decimals)));

          expect(poolScalingFactors).to.deep.equal(tokenScalingFactors);
        });
      });
    }
  });

  describe.skip('management fees', () => {
    let pool: WeightedPool;
    let joinResult: JoinResult;
    let tokens: TokenList;
    const weights = [fp(0.2), fp(0.8)];
    const initialBalances = [fp(100), fp(400)];
    const numTokens = 2;

    sharedBeforeEach('mint tokens to lp and trader', async () => {
      await allTokens.mint({ to: lp, amount: fp(1000) });
      await allTokens.mint({ to: trader, amount: fp(1000) });

      tokens = allTokens.subset(numTokens);

      await tokens.approve({ to: vault.address, from: [lp, trader] });
    });

    context('when there is only a protocol fee', () => {
      sharedBeforeEach('deploy pool without management fee, and set protocol fee', async () => {
        await vault.setSwapFeePercentage(PROTOCOL_SWAP_FEE_PERCENTAGE, { from: admin });

        pool = await WeightedPool.create({
          vault,
          poolType: WeightedPoolType.INVESTMENT_POOL,
          tokens,
          weights: weights,
          swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
          managementFeePercentage: 0,
        });

        joinResult = await pool.init({ from: lp, recipient: lp, initialBalances });
      });

      it('sets the protocol fee', async () => {
        const swapFeePercentage = await vault.getSwapFeePercentage();
        expect(swapFeePercentage).to.equal(PROTOCOL_SWAP_FEE_PERCENTAGE);
      });

      it('has no management fee', async () => {
        const managementFeePercentage = await pool.getManagementFeePercentage();
        expect(managementFeePercentage).to.equal(0);
      });

      it('has expected balances', async () => {
        expect(joinResult.amountsIn).to.deep.equal(initialBalances);
      });

      context('after swaps', () => {
        sharedBeforeEach('do some swaps', async () => {
          const singleSwapTo = {
            poolId: pool.getPoolId(),
            kind: SwapKind.GivenIn,
            assetIn: tokens.addresses[1],
            assetOut: tokens.addresses[0],
            amount: fp(20),
            userData: '0x',
          };

          const singleSwapFro = {
            poolId: pool.getPoolId(),
            kind: SwapKind.GivenIn,
            assetIn: tokens.addresses[0],
            assetOut: tokens.addresses[1],
            amount: fp(20),
            userData: '0x',
          };

          for (let i = 0; i < 10; i++) {
            await vault.instance.connect(trader).swap(singleSwapTo, funds, 0, MAX_UINT256);
            await vault.instance.connect(trader).swap(singleSwapFro, funds, 0, MAX_UINT256);
          }

          await pool.joinGivenIn({ from: lp, amountsIn: [fp(100), fp(400)] });
        });

        it('does not charge management fees', async () => {
          const managementFeeAmounts = await pool.getCollectedManagementFeeAmounts(tokens.addresses);
          expect(managementFeeAmounts).to.be.zeros;
        });
      });
    });

    context('when there is only a management fee', () => {
      let weightedMath: Contract;

      sharedBeforeEach('deploy pool with management fee', async () => {
        pool = await WeightedPool.create({
          vault,
          poolType: WeightedPoolType.INVESTMENT_POOL,
          tokens,
          weights: weights,
          swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
          managementFeePercentage: MANAGEMENT_FEE_PERCENTAGE,
        });

        joinResult = await pool.init({ from: lp, recipient: lp, initialBalances });

        weightedMath = await deploy('MockWeightedMath');
      });

      it('has no protocol fee', async () => {
        const swapFeePercentage = await vault.getSwapFeePercentage();
        expect(swapFeePercentage).to.equal(0);
      });

      it('sets the management fee', async () => {
        const managementFeePercentage = await pool.getManagementFeePercentage();
        expect(managementFeePercentage).to.equal(MANAGEMENT_FEE_PERCENTAGE);
      });

      it('has expected balances', async () => {
        expect(joinResult.amountsIn).to.deep.equal(initialBalances);
      });

      context('after swaps', () => {
        let previousInvariant: BigNumber;
        let currentInvariant: BigNumber;

        sharedBeforeEach('do some swaps', async () => {
          const singleSwapTo = {
            poolId: pool.getPoolId(),
            kind: SwapKind.GivenIn,
            assetIn: tokens.addresses[1],
            assetOut: tokens.addresses[0],
            amount: fp(20),
            userData: '0x',
          };

          const singleSwapFro = {
            poolId: pool.getPoolId(),
            kind: SwapKind.GivenIn,
            assetIn: tokens.addresses[0],
            assetOut: tokens.addresses[1],
            amount: fp(20),
            userData: '0x',
          };

          for (let i = 0; i < 10; i++) {
            // This requires the MockVault - but if I use that, I can't set protocol fees!
            //
            //await pool.swapGivenIn({ from: trader, recipient: trader, in: 1, out: 0, amount: fp(20) });
            //await pool.swapGivenIn({ from: trader, recipient: trader, in: 0, out: 1, amount: fp(20) });

            await vault.instance.connect(trader).swap(singleSwapTo, funds, 0, MAX_UINT256);
            await vault.instance.connect(trader).swap(singleSwapFro, funds, 0, MAX_UINT256);
          }
        });

        it('collects management fees', async () => {
          //console.log(`Token 0 has ${tokens.get(0).decimals} decimals.`);
          //console.log(`Token 1 has ${tokens.get(1).decimals} decimals.`);

          // Shouldn't be any protocol fees
          const collectedFees = await vault.getCollectedFeeAmounts(tokens);
          expect(collectedFees).to.be.zeros;

          const balances = await pool.getBalances();
          // These balances need to be scaled to match the contract code
          const scaledBalances = balances.map((balance, i) => balance.mul(10 ** (18 - tokens.get(i).decimals)));
          const normalizedWeights = await pool.getNormalizedWeights();

          previousInvariant = await pool.getLastInvariant();
          currentInvariant = await weightedMath.invariant(normalizedWeights, scaledBalances);

          await pool.joinGivenIn({ from: lp, amountsIn: [fp(100), fp(400)] });

          // What should the fee be? - use MockWeightedMath
          const expectedFee = await weightedMath.calculateDueTokenProtocolSwapFeeAmount(
            balances[1],
            normalizedWeights[1],
            previousInvariant,
            currentInvariant,
            MANAGEMENT_FEE_PERCENTAGE.div(100)
          );

          const managementFeeAmounts = await pool.getCollectedManagementFeeAmounts(tokens.addresses);

          expect(managementFeeAmounts[0]).to.equal(0);
          expect(managementFeeAmounts[1]).to.equalWithError(expectedFee, 0.0000001);
        });
      });
    });

    context('when there are both management and protocol fees', () => {
      sharedBeforeEach('deploy pool with management fee', async () => {
        await vault.setSwapFeePercentage(PROTOCOL_SWAP_FEE_PERCENTAGE, { from: admin });

        pool = await WeightedPool.create({
          vault,
          poolType: WeightedPoolType.INVESTMENT_POOL,
          tokens,
          weights: weights,
          swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
          managementFeePercentage: MANAGEMENT_FEE_PERCENTAGE,
          owner,
        });

        joinResult = await pool.init({ from: lp, recipient: lp, initialBalances });
      });

      it('sets the protocol fee', async () => {
        const swapFeePercentage = await vault.getSwapFeePercentage();
        expect(swapFeePercentage).to.equal(PROTOCOL_SWAP_FEE_PERCENTAGE);

        const collector: Contract = await vault.getFeesCollector();
        const pct = await collector.getSwapFeePercentage();
        expect(pct).to.equal(PROTOCOL_SWAP_FEE_PERCENTAGE);
      });

      it('sets the management fee', async () => {
        const managementFeePercentage = await pool.getManagementFeePercentage();
        expect(managementFeePercentage).to.equal(MANAGEMENT_FEE_PERCENTAGE);
      });

      it('has expected balances', async () => {
        expect(joinResult.amountsIn).to.deep.equal(initialBalances);
      });

      context('after swaps', () => {
        sharedBeforeEach('do some swaps', async () => {
          const singleSwapTo = {
            poolId: pool.getPoolId(),
            kind: SwapKind.GivenIn,
            assetIn: tokens.addresses[1],
            assetOut: tokens.addresses[0],
            amount: fp(20),
            userData: '0x',
          };

          const singleSwapFro = {
            poolId: pool.getPoolId(),
            kind: SwapKind.GivenIn,
            assetIn: tokens.addresses[0],
            assetOut: tokens.addresses[1],
            amount: fp(20),
            userData: '0x',
          };

          for (let i = 0; i < 10; i++) {
            // This requires the MockVault - but if I use that, I can't set protocol fees!
            //
            //await pool.swapGivenIn({ from: trader, recipient: trader, in: 1, out: 0, amount: fp(20) });
            //await pool.swapGivenIn({ from: trader, recipient: trader, in: 0, out: 1, amount: fp(20) });

            await vault.instance.connect(trader).swap(singleSwapTo, funds, 0, MAX_UINT256);
            await vault.instance.connect(trader).swap(singleSwapFro, funds, 0, MAX_UINT256);
          }

          await pool.joinGivenIn({ from: lp, amountsIn: [fp(100), fp(400)] });
        });

        it('collects management fees', async () => {
          //console.log(`Token 0 has ${tokens.get(0).decimals} decimals.`);
          //console.log(`Token 1 has ${tokens.get(1).decimals} decimals.`);

          // Fees will be collected from the highest weight token; so token[0] will be 0
          // token[1] will be the amount of protocol fees * managmentFeePct/protocolFeePct
          // So with 10% protocol fees and 20% management fees, it's 20/10 = 2 (i.e., mgmt fee should be double the protocol fee)
          const ratio = MANAGEMENT_FEE_PERCENTAGE.div(PROTOCOL_SWAP_FEE_PERCENTAGE);

          const collectedFees = await vault.getCollectedFeeAmounts(tokens);
          const expectedAmounts = collectedFees.map((fee) => fee.mul(ratio));

          const managementFeeAmounts = await pool.getCollectedManagementFeeAmounts(tokens.addresses);
          for (let i = 0; i < tokens.length; i++) {
            expect(managementFeeAmounts[i]).to.equalWithError(expectedAmounts[i], 0.0000001);
          }
        });

        it('allows the owner to collect fees', async () => {
          const managementFeeAmounts = await pool.getCollectedManagementFeeAmounts(tokens.addresses);
          const previousBalances: BigNumber[] = [];
          const currentBalances: BigNumber[] = [];

          for (let i = 0; i < tokens.length; i++) {
            previousBalances[i] = await tokens.get(i).balanceOf(owner);
          }

          const { amountsOut } = await pool.exitForManagementFees({ from: owner });

          for (let i = 0; i < tokens.length; i++) {
            expect(amountsOut[i]).to.equalWithError(managementFeeAmounts[i], 0.0000001);
            currentBalances[i] = await tokens.get(i).balanceOf(owner);
          }

          expect(arraySub(currentBalances, previousBalances)).to.deep.equal(amountsOut);

          // After we withdraw them, they should be 0
          const residualFeeAmounts = await pool.getCollectedManagementFeeAmounts(tokens.addresses);
          expect(residualFeeAmounts).to.be.zeros;
        });
      });
    });
  });

  context.skip('with invalid creation parameters', () => {
    it('fails with < 2 tokens', async () => {
      const params = {
        tokens: allTokens.subset(1),
        weights: [fp(0.3)],
        owner,
        poolType: WeightedPoolType.INVESTMENT_POOL,
      };
      await expect(WeightedPool.create(params)).to.be.revertedWith('MIN_TOKENS');
    });

    it('fails with > 100 tokens', async () => {
      const params = {
        tokens: allTokens,
        weights: tooManyWeights,
        owner,
        poolType: WeightedPoolType.INVESTMENT_POOL,
      };
      await expect(WeightedPool.create(params)).to.be.revertedWith('MAX_TOKENS');
    });

    it('fails with mismatched tokens/weights', async () => {
      const params = {
        tokens: allTokens.subset(20),
        weights: tooManyWeights,
        owner,
        poolType: WeightedPoolType.INVESTMENT_POOL,
      };
      await expect(WeightedPool.create(params)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
    });
  });

  context.skip('when deployed from factory', () => {
    sharedBeforeEach('deploy pool', async () => {
      const params = {
        tokens: poolTokens,
        weights: poolWeights,
        assetManagers: Array(poolTokens.length).fill(assetManager.address),
        owner,
        poolType: WeightedPoolType.INVESTMENT_POOL,
        fromFactory: true,
      };
      pool = await WeightedPool.create(params);
    });

    it('has asset managers', async () => {
      await poolTokens.asyncEach(async (token) => {
        const info = await pool.getTokenInfo(token);
        expect(info.assetManager).to.eq(assetManager.address);
      });
    });
  });

  describe.skip('with valid creation parameters', () => {
    context('when initialized with swaps disabled', () => {
      sharedBeforeEach('deploy pool', async () => {
        const params = {
          tokens: poolTokens,
          weights: poolWeights,
          owner,
          poolType: WeightedPoolType.INVESTMENT_POOL,
          swapEnabledOnStart: false,
        };
        pool = await WeightedPool.create(params);
      });

      it('swaps show disabled on start', async () => {
        expect(await pool.instance.getSwapEnabled()).to.be.false;
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
          owner,
          poolType: WeightedPoolType.INVESTMENT_POOL,
          swapEnabledOnStart: true,
        };
        pool = await WeightedPool.create(params);
      });

      it('swaps show enabled on start', async () => {
        expect(await pool.instance.getSwapEnabled()).to.be.true;
      });

      it('swaps are not blocked', async () => {
        await pool.init({ from: owner, initialBalances });

        await expect(pool.swapGivenIn({ in: 1, out: 0, amount: fp(0.1) })).to.not.be.reverted;
      });

      it('sets token weights', async () => {
        const normalizedWeights = await pool.getNormalizedWeights();

        // Not exactly equal due to weight compression
        expect(normalizedWeights).to.equalWithError(pool.normalizedWeights, 0.0001);
      });

      it('stores the initial weights as a zero duration weight change', async () => {
        const { startTime, endTime, endWeights } = await pool.getGradualWeightUpdateParams();

        expect(startTime).to.equal(endTime);
        expect(endWeights).to.equalWithError(pool.normalizedWeights, 0.0001);
      });

      describe('permissioned actions', () => {
        context('when the sender is not the owner', () => {
          it('non-owners cannot disable swaps', async () => {
            await expect(pool.setSwapEnabled(other, false)).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });

        context('when the sender is the owner', () => {
          sharedBeforeEach('set sender to owner', async () => {
            sender = owner;
            await pool.init({ from: sender, initialBalances });
          });

          it('swaps can be enabled and disabled', async () => {
            await pool.setSwapEnabled(sender, false);
            expect(await pool.instance.getSwapEnabled()).to.be.false;

            await pool.setSwapEnabled(sender, true);
            expect(await pool.instance.getSwapEnabled()).to.be.true;
          });

          it('disabling swaps emits an event', async () => {
            const receipt = await pool.setSwapEnabled(sender, false);

            expectEvent.inReceipt(await receipt.wait(), 'SwapEnabledSet', {
              swapEnabled: false,
            });
          });

          it('enabling swaps emits an event', async () => {
            const receipt = await pool.setSwapEnabled(sender, true);

            expectEvent.inReceipt(await receipt.wait(), 'SwapEnabledSet', {
              swapEnabled: true,
            });
          });

          it('owner can join and receive BPT, then exit', async () => {
            const bptBeforeJoin = await pool.balanceOf(owner.address);
            await expect(pool.joinGivenIn({ from: owner, amountsIn: initialBalances })).to.not.be.reverted;

            const bptAfterJoin = await pool.balanceOf(owner.address);
            expect(bptAfterJoin).to.gt(bptBeforeJoin);

            await expect(pool.exitGivenOut({ from: owner, amountsOut: initialBalances })).to.not.be.reverted;
            const bptAfterExit = await pool.balanceOf(owner.address);
            expect(bptAfterExit).to.lt(bptAfterJoin);
          });

          describe('update weights gradually', () => {
            const UPDATE_DURATION = DAY * 3;
            const SHORT_UPDATE = MINUTE * 2;

            context('with invalid parameters', () => {
              let now: BigNumber;

              sharedBeforeEach(async () => {
                now = await currentTimestamp();
              });

              it('fails if end weights are mismatched (too few)', async () => {
                await expect(pool.updateWeightsGradually(sender, now, now, WEIGHTS.slice(0, 1))).to.be.revertedWith(
                  'INPUT_LENGTH_MISMATCH'
                );
              });

              it('fails if the end weights are mismatched (too many)', async () => {
                await expect(pool.updateWeightsGradually(sender, now, now, [...WEIGHTS, fp(0.5)])).to.be.revertedWith(
                  'INPUT_LENGTH_MISMATCH'
                );
              });

              it('fails if start time > end time', async () => {
                await expect(pool.updateWeightsGradually(sender, now, now.sub(1), poolWeights)).to.be.revertedWith(
                  'GRADUAL_UPDATE_TIME_TRAVEL'
                );
              });

              it('fails if duration is less than the minimum', async () => {
                await expect(
                  pool.updateWeightsGradually(sender, now, now.add(SHORT_UPDATE), poolWeights)
                ).to.be.revertedWith('WEIGHT_CHANGE_TOO_FAST');
              });

              it('fails with an end weight below the minimum', async () => {
                const badWeights = [...poolWeights];
                badWeights[2] = fp(0.005);

                await expect(
                  pool.updateWeightsGradually(sender, now, now.add(UPDATE_DURATION), badWeights)
                ).to.be.revertedWith('MIN_WEIGHT');
              });

              it('fails with invalid normalized end weights', async () => {
                const badWeights = Array(poolWeights.length).fill(fp(0.6));

                await expect(
                  pool.updateWeightsGradually(sender, now, now.add(UPDATE_DURATION), badWeights)
                ).to.be.revertedWith('NORMALIZED_WEIGHT_INVARIANT');
              });

              context('with start time in the past', () => {
                let now: BigNumber, startTime: BigNumber, endTime: BigNumber;
                const endWeights = [...poolWeights];

                sharedBeforeEach('updateWeightsGradually (start time in the past)', async () => {
                  now = await currentTimestamp();
                  // Start an hour in the past
                  startTime = now.sub(MINUTE * 60);
                  endTime = now.add(UPDATE_DURATION);
                });

                it('fast-forwards start time to present', async () => {
                  await pool.updateWeightsGradually(owner, startTime, endTime, endWeights);
                  const updateParams = await pool.getGradualWeightUpdateParams();

                  // Start time should be fast-forwarded to now
                  expect(updateParams.startTime).to.equal(await currentTimestamp());
                });
              });
            });

            context('with valid parameters (ongoing weight update)', () => {
              // startWeights must equal "weights" above - just not using fp to keep math simple
              const startWeights = [...poolWeights];
              const endWeights = [...poolWeights];

              // Now generate endWeights (first weight doesn't change)
              for (let i = 2; i < poolWeights.length; i++) {
                endWeights[i] = 0 == i % 2 ? startWeights[i].add(fp(0.02)) : startWeights[i].sub(fp(0.02));
              }

              function getEndWeights(pct: number): BigNumber[] {
                const intermediateWeights = Array<BigNumber>(poolWeights.length);

                for (let i = 0; i < poolWeights.length; i++) {
                  if (startWeights[i] < endWeights[i]) {
                    // Weight is increasing
                    intermediateWeights[i] = startWeights[i].add(endWeights[i].sub(startWeights[i]).mul(pct).div(100));
                  } else {
                    // Weight is decreasing (or not changing)
                    intermediateWeights[i] = startWeights[i].sub(startWeights[i].sub(endWeights[i]).mul(pct).div(100));
                  }
                }

                return intermediateWeights;
              }

              let now, startTime: BigNumber, endTime: BigNumber;
              const START_DELAY = MINUTE * 10;
              const finalEndWeights = getEndWeights(100);

              sharedBeforeEach('updateWeightsGradually', async () => {
                now = await currentTimestamp();
                startTime = now.add(START_DELAY);
                endTime = startTime.add(UPDATE_DURATION);

                await pool.updateWeightsGradually(owner, startTime, endTime, finalEndWeights);
              });

              it('updating weights emits an event', async () => {
                const receipt = await pool.updateWeightsGradually(owner, startTime, endTime, finalEndWeights);

                expectEvent.inReceipt(await receipt.wait(), 'GradualWeightUpdateScheduled', {
                  startTime: startTime,
                  endTime: endTime,
                  // weights don't exactly match because of the compression
                });
              });

              it('stores the params', async () => {
                const updateParams = await pool.getGradualWeightUpdateParams();

                expect(updateParams.startTime).to.equalWithError(startTime, 0.001);
                expect(updateParams.endTime).to.equalWithError(endTime, 0.001);
                expect(updateParams.endWeights).to.equalWithError(finalEndWeights, 0.001);
              });

              it('gets start weights if called before the start time', async () => {
                const normalizedWeights = await pool.getNormalizedWeights();

                // Need to decrease precision
                expect(normalizedWeights).to.equalWithError(pool.normalizedWeights, 0.0001);
              });

              it('gets end weights if called after the end time', async () => {
                await advanceTime(endTime.add(MINUTE));
                const normalizedWeights = await pool.getNormalizedWeights();

                // Need to decrease precision
                expect(normalizedWeights).to.equalWithError(finalEndWeights, 0.0001);
              });

              for (let pct = 5; pct < 100; pct += 5) {
                it(`gets correct intermediate weights if called ${pct}% through`, async () => {
                  await advanceTime(START_DELAY + (UPDATE_DURATION * pct) / 100);
                  const normalizedWeights = await pool.getNormalizedWeights();

                  // Need to decrease precision
                  expect(normalizedWeights).to.equalWithError(getEndWeights(pct), 0.005);
                });
              }
            });
          });
        });

        context('when the sender is not the owner', () => {
          it('non-owners cannot update weights', async () => {
            const now = await currentTimestamp();

            await expect(pool.updateWeightsGradually(other, now, now, poolWeights)).to.be.revertedWith(
              'SENDER_NOT_ALLOWED'
            );
          });
        });
        context('when swaps disabled', () => {
          sharedBeforeEach(async () => {
            await pool.setSwapEnabled(sender, false);
            await pool.init({ from: owner, initialBalances });
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
});
