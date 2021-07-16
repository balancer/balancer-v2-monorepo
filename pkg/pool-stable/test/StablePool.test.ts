import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { PoolSpecialization } from '@balancer-labs/balancer-js';
import { BigNumberish, bn, fp, pct } from '@balancer-labs/v2-helpers/src/numbers';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePool, { SWAP_INTERFACE } from '@balancer-labs/v2-helpers/src/models/pools/stable/StablePool';
import { RawStablePoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/stable/types';
import {
  advanceTime,
  currentTimestamp,
  DAY,
  fromNow,
  MONTH,
  setNextBlockTimestamp,
} from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { range } from 'lodash';

describe('StablePool', function () {
  let allTokens: TokenList;
  let owner: SignerWithAddress,
    trader: SignerWithAddress,
    recipient: SignerWithAddress,
    other: SignerWithAddress,
    lp: SignerWithAddress;

  const MAX_TOKENS = 5;

  const AMP_PRECISION = 1e3;
  const AMPLIFICATION_PARAMETER = bn(200);
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const INITIAL_BALANCES = [fp(1), fp(0.9), fp(0.8), fp(1.1)];

  before('setup signers', async () => {
    [, owner, lp, trader, recipient, other] = await ethers.getSigners();
  });

  describe('scaling factors', () => {
    let tokens: TokenList;

    sharedBeforeEach('deploy tokens', async () => {
      tokens = await TokenList.create(MAX_TOKENS, { sorted: true, varyDecimals: true });
    });

    for (const numTokens of range(2, MAX_TOKENS + 1)) {
      context(`with ${numTokens} tokens`, () => {
        let pool: StablePool;
        let poolTokens: TokenList;

        sharedBeforeEach('deploy pool', async () => {
          poolTokens = tokens.subset(numTokens);
          pool = await StablePool.create({ tokens: poolTokens, swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE });
        });

        it('sets scaling factors', async () => {
          const poolScalingFactors = await pool.getScalingFactors();
          const tokenScalingFactors = poolTokens.map((token) => fp(10 ** (18 - token.decimals)));

          expect(poolScalingFactors).to.deep.equal(tokenScalingFactors);
        });
      });
    }
  });

  sharedBeforeEach('deploy tokens', async () => {
    allTokens = await TokenList.create(['MKR', 'DAI', 'SNX', 'BAT'], { sorted: true });
    await allTokens.mint({ to: [lp, trader], amount: fp(100) });
  });

  context('for a 1 token pool', () => {
    it('reverts if there is a single token', async () => {
      const tokens = await TokenList.create(1);

      await expect(StablePool.create({ tokens })).to.be.revertedWith('MIN_TOKENS');
    });
  });

  context('for a 2 token pool', () => {
    itBehavesAsStablePool(2);
  });

  context('for a 3 token pool', () => {
    itBehavesAsStablePool(3);
  });

  context('for a too-many token pool', () => {
    it('reverts if there are too many tokens', async () => {
      // The maximum number of tokens is 5
      const tokens = await TokenList.create(6, { sorted: true });

      await expect(StablePool.create({ tokens, swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE })).to.be.revertedWith(
        'MAX_TOKENS'
      );
    });
  });

  function itBehavesAsStablePool(numberOfTokens: number) {
    let pool: StablePool, tokens: TokenList;

    const ZEROS = Array(numberOfTokens).fill(bn(0));
    const initialBalances = INITIAL_BALANCES.slice(0, numberOfTokens);

    async function deployPool(params: RawStablePoolDeployment = {}): Promise<void> {
      params = Object.assign(
        {},
        { tokens, amplificationParameter: AMPLIFICATION_PARAMETER, swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE },
        params
      );
      pool = await StablePool.create(params);
    }

    beforeEach('define pool tokens', () => {
      tokens = allTokens.subset(numberOfTokens);
    });

    describe('creation', () => {
      context('when the creation succeeds', () => {
        sharedBeforeEach('deploy pool from factory', async () => {
          await deployPool({ fromFactory: true });
        });

        it('sets the vault', async () => {
          expect(await pool.getVault()).to.equal(pool.vault.address);
        });

        it('uses general specialization', async () => {
          const { address, specialization } = await pool.getRegisteredInfo();
          expect(address).to.equal(pool.address);
          expect(specialization).to.equal(
            numberOfTokens == 2 ? PoolSpecialization.TwoTokenPool : PoolSpecialization.GeneralPool
          );
        });

        it('registers tokens in the vault', async () => {
          const { tokens, balances } = await pool.getTokens();

          expect(tokens).to.have.members(tokens);
          expect(balances).to.be.zeros;
        });

        it('starts with no BPT', async () => {
          expect(await pool.totalSupply()).to.be.equal(0);
        });

        it('sets the asset managers', async () => {
          await tokens.asyncEach(async (token) => {
            const { assetManager } = await pool.getTokenInfo(token);
            expect(assetManager).to.be.zeroAddress;
          });
        });

        it('sets amplification', async () => {
          const { value, isUpdating, precision } = await pool.getAmplificationParameter();
          expect(value).to.be.equal(AMPLIFICATION_PARAMETER.mul(precision));
          expect(isUpdating).to.be.false;
        });

        it('sets swap fee', async () => {
          expect(await pool.getSwapFeePercentage()).to.equal(POOL_SWAP_FEE_PERCENTAGE);
        });

        it('sets the name', async () => {
          expect(await pool.name()).to.equal('Balancer Pool Token');
        });

        it('sets the symbol', async () => {
          expect(await pool.symbol()).to.equal('BPT');
        });

        it('sets the decimals', async () => {
          expect(await pool.decimals()).to.equal(18);
        });
      });

      context('when the creation fails', () => {
        it('reverts if there are repeated tokens', async () => {
          const badTokens = new TokenList(Array(numberOfTokens).fill(tokens.first));

          await expect(deployPool({ tokens: badTokens, fromFactory: true })).to.be.revertedWith('UNSORTED_ARRAY');
        });

        it('reverts if the swap fee is too high', async () => {
          const badSwapFeePercentage = fp(0.1).add(1);

          await expect(deployPool({ swapFeePercentage: badSwapFeePercentage })).to.be.revertedWith(
            'MAX_SWAP_FEE_PERCENTAGE'
          );
        });

        it('reverts if amplification coefficient is too high', async () => {
          const highAmp = bn(5001);

          await expect(deployPool({ amplificationParameter: highAmp })).to.be.revertedWith('MAX_AMP');
        });

        it('reverts if amplification coefficient is too low', async () => {
          const lowAmp = bn(0);

          await expect(deployPool({ amplificationParameter: lowAmp })).to.be.revertedWith('MIN_AMP');
        });
      });
    });

    describe('onJoinPool', () => {
      sharedBeforeEach('deploy pool', async () => {
        await deployPool();
      });

      it('fails if caller is not the vault', async () => {
        await expect(
          pool.instance.connect(lp).onJoinPool(pool.poolId, lp.address, other.address, [0], 0, 0, '0x')
        ).to.be.revertedWith('CALLER_NOT_VAULT');
      });

      it('fails if no user data', async () => {
        await expect(pool.join({ data: '0x' })).to.be.revertedWith('Transaction reverted without a reason');
      });

      it('fails if wrong user data', async () => {
        const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);

        await expect(pool.join({ data: wrongUserData })).to.be.revertedWith('Transaction reverted without a reason');
      });

      context('initialization', () => {
        it('grants the invariant amount of BPT', async () => {
          const invariant = await pool.estimateInvariant(initialBalances);

          const { amountsIn, dueProtocolFeeAmounts } = await pool.init({ recipient, initialBalances });

          // Amounts in should be the same as initial ones
          expect(amountsIn).to.deep.equal(initialBalances);

          // Protocol fees should be zero
          expect(dueProtocolFeeAmounts).to.be.zeros;

          // Initial balances should equal invariant
          expect(await pool.balanceOf(recipient)).to.be.equalWithError(invariant, 0.001);
        });

        it('fails if already initialized', async () => {
          await pool.init({ recipient, initialBalances });

          await expect(pool.init({ initialBalances })).to.be.revertedWith('UNHANDLED_JOIN_KIND');
        });

        it('reverts if paused', async () => {
          await pool.pause();

          await expect(pool.init({ initialBalances })).to.be.revertedWith('PAUSED');
        });
      });

      context('join exact tokens in for BPT out', () => {
        it('fails if not initialized', async () => {
          await expect(pool.joinGivenIn({ recipient, amountsIn: initialBalances })).to.be.revertedWith('UNINITIALIZED');
        });

        context('once initialized', () => {
          let expectedBptOut: BigNumberish;
          const amountsIn = ZEROS.map((n, i) => (i === 1 ? fp(0.1) : n));

          sharedBeforeEach('initialize pool', async () => {
            await pool.init({ recipient, initialBalances });
            expectedBptOut = await pool.estimateBptOut(amountsIn, initialBalances);
          });

          it('grants BPT for exact tokens', async () => {
            const previousBptBalance = await pool.balanceOf(recipient);
            const minimumBptOut = pct(expectedBptOut, 0.99);

            const result = await pool.joinGivenIn({ amountsIn, minimumBptOut, recipient });

            // Amounts in should be the same as initial ones
            expect(result.amountsIn).to.deep.equal(amountsIn);

            // Protocol fees should be zero
            expect(result.dueProtocolFeeAmounts).to.be.zeros;

            // Make sure received BPT is closed to what we expect
            const currentBptBalance = await pool.balanceOf(recipient);
            expect(currentBptBalance.sub(previousBptBalance)).to.be.equalWithError(expectedBptOut, 0.0001);
          });

          it('can tell how much BPT it will give in return', async () => {
            const minimumBptOut = pct(expectedBptOut, 0.99);

            const result = await pool.queryJoinGivenIn({ amountsIn, minimumBptOut });

            expect(result.amountsIn).to.deep.equal(amountsIn);
            expect(result.bptOut).to.be.equalWithError(expectedBptOut, 0.0001);
          });

          it('fails if not enough BPT', async () => {
            // This call should fail because we are requesting minimum 1% more
            const minimumBptOut = pct(expectedBptOut, 1.01);

            await expect(pool.joinGivenIn({ amountsIn, minimumBptOut })).to.be.revertedWith('BPT_OUT_MIN_AMOUNT');
          });

          it('reverts if paused', async () => {
            await pool.pause();

            await expect(pool.joinGivenIn({ amountsIn })).to.be.revertedWith('PAUSED');
          });
        });
      });

      context('join token in for exact BPT out', () => {
        const token = 0;
        const bptOut = fp(2);

        it('fails if not initialized', async () => {
          await expect(pool.joinGivenOut({ bptOut, token })).to.be.revertedWith('UNINITIALIZED');
        });

        context('once initialized', () => {
          sharedBeforeEach('initialize pool', async () => {
            await pool.init({ recipient, initialBalances });
          });

          it('grants exact BPT for token in', async () => {
            const previousBptBalance = await pool.balanceOf(recipient);
            const expectedAmountIn = await pool.estimateTokenIn(token, bptOut, initialBalances);

            const result = await pool.joinGivenOut({ recipient, bptOut, token });

            // Only token in should be the one transferred
            expect(result.amountsIn[token]).to.be.equalWithError(expectedAmountIn, 0.001);
            expect(result.amountsIn.filter((_, i) => i != token)).to.be.zeros;

            // Protocol fees should be zero
            expect(result.dueProtocolFeeAmounts).to.be.zeros;

            // Make sure received BPT is closed to what we expect
            const currentBptBalance = await pool.balanceOf(recipient);
            expect(currentBptBalance.sub(previousBptBalance)).to.be.equal(bptOut);
          });

          it('can tell how many token amounts it will have to receive', async () => {
            const expectedAmountIn = await pool.estimateTokenIn(token, bptOut, initialBalances);

            const result = await pool.queryJoinGivenOut({ bptOut, token });

            expect(result.bptOut).to.be.equal(bptOut);
            expect(result.amountsIn[token]).to.be.equalWithError(expectedAmountIn, 0.001);
            expect(result.amountsIn.filter((_, i) => i != token)).to.be.zeros;
          });

          it('reverts if paused', async () => {
            await pool.pause();

            await expect(pool.joinGivenOut({ bptOut, token })).to.be.revertedWith('PAUSED');
          });
        });
      });
    });

    describe('onExitPool', () => {
      let previousBptBalance: BigNumber;

      sharedBeforeEach('deploy and initialize pool', async () => {
        await deployPool();
        await pool.init({ initialBalances, recipient: lp });
        previousBptBalance = await pool.balanceOf(lp);
      });

      it('fails if caller is not the vault', async () => {
        await expect(
          pool.instance.connect(lp).onExitPool(pool.poolId, recipient.address, other.address, [0], 0, 0, '0x')
        ).to.be.revertedWith('CALLER_NOT_VAULT');
      });

      it('fails if no user data', async () => {
        await expect(pool.exit({ data: '0x' })).to.be.revertedWith('Transaction reverted without a reason');
      });

      it('fails if wrong user data', async () => {
        const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);

        await expect(pool.exit({ data: wrongUserData })).to.be.revertedWith('Transaction reverted without a reason');
      });

      context('exit exact BPT in for one token out', () => {
        const token = 0;

        it('grants one token for exact bpt', async () => {
          // 20% of previous balance
          const previousBptBalance = await pool.balanceOf(lp);
          const bptIn = pct(previousBptBalance, 0.2);
          const expectedTokenOut = await pool.estimateTokenOut(token, bptIn);

          const result = await pool.singleExitGivenIn({ from: lp, bptIn, token });

          // Protocol fees should be zero
          expect(result.dueProtocolFeeAmounts).to.be.zeros;

          // Only token out should be the one transferred
          expect(result.amountsOut[token]).to.be.equalWithError(expectedTokenOut, 0.0001);
          expect(result.amountsOut.filter((_, i) => i != token)).to.be.zeros;

          // Current BPT balance should decrease
          expect(await pool.balanceOf(lp)).to.equal(previousBptBalance.sub(bptIn));
        });

        it('can tell how many tokens it will give in return', async () => {
          const bptIn = pct(await pool.balanceOf(lp), 0.2);
          const expectedTokenOut = await pool.estimateTokenOut(token, bptIn);

          const result = await pool.querySingleExitGivenIn({ bptIn, token });

          expect(result.bptIn).to.equal(bptIn);
          expect(result.amountsOut.filter((_, i) => i != token)).to.be.zeros;
          expect(result.amountsOut[token]).to.be.equalWithError(expectedTokenOut, 0.0001);
        });
      });

      context('exit exact BPT in for all tokens out', () => {
        it('grants all tokens for exact bpt', async () => {
          // Exit with half of the BPT balance
          const bptIn = previousBptBalance.div(2);
          const expectedAmountsOut = initialBalances.map((balance) => balance.div(2));

          const result = await pool.multiExitGivenIn({ from: lp, bptIn });

          // Protocol fees should be zero
          expect(result.dueProtocolFeeAmounts).to.be.zeros;

          // Balances are reduced by half because we are returning half of the BPT supply
          expect(result.amountsOut).to.be.equalWithError(expectedAmountsOut, 0.001);

          // Current BPT balance should have been reduced by half
          expect(await pool.balanceOf(lp)).to.be.equalWithError(bptIn, 0.001);
        });

        it('fully exit', async () => {
          // The LP doesn't own all BPT, since some was locked. They will only be able to extract a (large) percentage
          // of the Pool's balance: the rest remains there forever.
          const totalBPT = await pool.totalSupply();
          const expectedAmountsOut = initialBalances.map((balance) => balance.mul(previousBptBalance).div(totalBPT));

          const result = await pool.multiExitGivenIn({ from: lp, bptIn: previousBptBalance });

          // Protocol fees should be zero
          expect(result.dueProtocolFeeAmounts).to.be.zeros;

          // All balances are extracted
          expect(result.amountsOut).to.be.lteWithError(expectedAmountsOut, 0.00001);

          // Current BPT balances should be zero due to full exit
          expect(await pool.balanceOf(lp)).to.equal(0);
        });

        it('can tell how many token amounts it will give in return', async () => {
          const totalBPT = await pool.totalSupply();
          const expectedAmountsOut = initialBalances.map((balance) => balance.mul(previousBptBalance).div(totalBPT));

          const result = await pool.queryMultiExitGivenIn({ bptIn: previousBptBalance });

          expect(result.bptIn).to.equal(previousBptBalance);
          expect(result.amountsOut).to.be.lteWithError(expectedAmountsOut, 0.00001);
        });

        it('does not revert if paused', async () => {
          await pool.pause();

          const bptIn = previousBptBalance.div(2);
          await expect(pool.multiExitGivenIn({ from: lp, bptIn })).not.to.be.reverted;
        });
      });

      context('exit BPT in for exact tokens out', () => {
        it('grants exact tokens for bpt', async () => {
          // Request half of the token balances
          const amountsOut = initialBalances.map((balance) => balance.div(2));

          const expectedBptIn = previousBptBalance.div(2);
          const maximumBptIn = pct(expectedBptIn, 1.01);

          const result = await pool.exitGivenOut({ from: lp, amountsOut, maximumBptIn });

          // Protocol fees should be zero
          expect(result.dueProtocolFeeAmounts).to.be.zeros;

          // Token balances should been reduced as requested
          expect(result.amountsOut).to.deep.equal(amountsOut);

          // BPT balance should have been reduced by half because we are returning half of the tokens
          expect(await pool.balanceOf(lp)).to.be.equalWithError(previousBptBalance.div(2), 0.001);
        });

        it('can tell how much BPT it will have to receive', async () => {
          const amountsOut = initialBalances.map((balance) => balance.div(2));
          const expectedBptIn = previousBptBalance.div(2);
          const maximumBptIn = pct(expectedBptIn, 1.01);

          const result = await pool.queryExitGivenOut({ amountsOut, maximumBptIn });

          expect(result.amountsOut).to.deep.equal(amountsOut);
          expect(result.bptIn).to.be.equalWithError(previousBptBalance.div(2), 0.001);
        });

        it('fails if more BTP needed', async () => {
          // Call should fail because we are requesting a max amount lower than the actual needed
          const amountsOut = initialBalances;
          const maximumBptIn = previousBptBalance.div(2);

          await expect(pool.exitGivenOut({ from: lp, amountsOut, maximumBptIn })).to.be.revertedWith(
            'BPT_IN_MAX_AMOUNT'
          );
        });

        it('reverts if paused', async () => {
          await pool.pause();

          const amountsOut = initialBalances;
          await expect(pool.exitGivenOut({ from: lp, amountsOut })).to.be.revertedWith('PAUSED');
        });
      });
    });

    describe('swaps', () => {
      sharedBeforeEach('deploy and join pool', async () => {
        await deployPool();
        await pool.init({ initialBalances });
      });

      context('given in', () => {
        it('calculates amount out', async () => {
          const amount = fp(0.1);
          const amountWithFees = amount.mul(POOL_SWAP_FEE_PERCENTAGE.add(fp(1))).div(fp(1));
          const expectedAmountOut = await pool.estimateGivenIn({ in: 1, out: 0, amount: amountWithFees });

          const result = await pool.swapGivenIn({ in: 1, out: 0, amount: amountWithFees });

          //TODO: review small relative error
          expect(result).to.be.equalWithError(expectedAmountOut, 0.1);
        });

        if (numberOfTokens == 2) {
          it('calculates the same amount regardless of the interface used', async () => {
            const amount = fp(0.1);
            const resultMinimalSwapInfo = await pool.swapGivenIn(
              { in: 1, out: 0, amount },
              SWAP_INTERFACE.MINIMAL_SWAP_INFO
            );
            const resultGeneral = await pool.swapGivenIn({ in: 1, out: 0, amount }, SWAP_INTERFACE.GENERAL);

            expect(resultMinimalSwapInfo).to.be.equal(resultGeneral);
          });
        } else {
          it('reverts if using the minimal swap info interface', async () => {
            const amount = fp(0.1);
            await expect(
              pool.swapGivenIn({ in: 1, out: 0, amount }, SWAP_INTERFACE.MINIMAL_SWAP_INFO)
            ).to.be.revertedWith('NOT_TWO_TOKENS');
          });

          it('reverts if invalid token in index', async () => {
            await expect(pool.swapGivenIn({ in: 10, out: 0, amount: 1 })).to.be.revertedWith('OUT_OF_BOUNDS');
          });

          it('reverts if invalid token out index', async () => {
            await expect(pool.swapGivenIn({ in: 1, out: 10, amount: 1 })).to.be.revertedWith('OUT_OF_BOUNDS');
          });
        }

        it('reverts if paused', async () => {
          await pool.pause();

          await expect(pool.swapGivenIn({ in: 1, out: 0, amount: 1 })).to.be.revertedWith('PAUSED');
        });
      });

      context('given out', () => {
        it('calculates amount in', async () => {
          const amount = fp(0.1);
          const expectedAmountIn = await pool.estimateGivenOut({ in: 1, out: 0, amount });

          const result = await pool.swapGivenOut({ in: 1, out: 0, amount });

          expect(result).to.be.equalWithError(expectedAmountIn, 0.1);
        });

        if (numberOfTokens == 2) {
          it('calculates the same amount regardless of the interface used', async () => {
            const amount = fp(0.1);
            const resultMinimalSwapInfo = await pool.swapGivenOut(
              { in: 1, out: 0, amount },
              SWAP_INTERFACE.MINIMAL_SWAP_INFO
            );
            const resultGeneral = await pool.swapGivenOut({ in: 1, out: 0, amount }, SWAP_INTERFACE.GENERAL);

            expect(resultMinimalSwapInfo).to.be.equal(resultGeneral);
          });
        } else {
          it('reverts if using the minimal swap info interface', async () => {
            const amount = fp(0.1);
            await expect(
              pool.swapGivenOut({ in: 1, out: 0, amount }, SWAP_INTERFACE.MINIMAL_SWAP_INFO)
            ).to.be.revertedWith('NOT_TWO_TOKENS');
          });

          it('reverts if invalid token in index', async () => {
            await expect(pool.swapGivenOut({ in: 10, out: 0, amount: 1 })).to.be.revertedWith('OUT_OF_BOUNDS');
          });

          it('reverts if invalid token out index', async () => {
            await expect(pool.swapGivenOut({ in: 1, out: 10, amount: 1 })).to.be.revertedWith('OUT_OF_BOUNDS');
          });
        }

        it('reverts if paused', async () => {
          await pool.pause();

          await expect(pool.swapGivenOut({ in: 1, out: 0, amount: 1 })).to.be.revertedWith('PAUSED');
        });
      });
    });

    describe('protocol swap fees', () => {
      const protocolFeePercentage = fp(0.1); // 10 %

      sharedBeforeEach('deploy and join pool', async () => {
        await deployPool({ owner });
        await pool.init({ initialBalances, from: lp, protocolFeePercentage });
      });

      context('without balance changes', () => {
        it('joins and exits do not accumulate fees', async () => {
          let joinResult = await pool.joinGivenIn({ from: lp, amountsIn: fp(100), protocolFeePercentage });
          expect(joinResult.dueProtocolFeeAmounts).to.be.zeros;

          joinResult = await pool.joinGivenOut({ from: lp, bptOut: fp(1), token: 0, protocolFeePercentage });
          expect(joinResult.dueProtocolFeeAmounts).to.be.zeros;

          let exitResult = await pool.singleExitGivenIn({ from: lp, bptIn: fp(10), token: 0, protocolFeePercentage });
          expect(exitResult.dueProtocolFeeAmounts).to.be.zeros;

          exitResult = await pool.multiExitGivenIn({ from: lp, bptIn: fp(10), protocolFeePercentage });
          expect(exitResult.dueProtocolFeeAmounts).to.be.zeros;

          joinResult = await pool.joinGivenIn({ from: lp, amountsIn: fp(10), protocolFeePercentage });
          expect(joinResult.dueProtocolFeeAmounts).to.be.zeros;

          exitResult = await pool.exitGivenOut({ from: lp, amountsOut: fp(10), protocolFeePercentage });
          expect(exitResult.dueProtocolFeeAmounts).to.be.zeros;
        });
      });

      context('with previous swap', () => {
        let currentBalances: BigNumber[], expectedDueProtocolFeeAmounts: BigNumber[];

        sharedBeforeEach('compute expected due protocol fees ', async () => {
          // 4/3 of the initial balances - these balances are simulated: we rely on MockVault passing them in the Pool
          // hook, so we don't need to actually perform any swaps
          currentBalances = initialBalances.map((balance) => balance.mul(4).div(3));

          const maxBalance = currentBalances.reduce((max, balance) => (balance.gt(max) ? balance : max), bn(0));
          const paidTokenIndex = currentBalances.indexOf(maxBalance);
          const protocolFeeAmount = await pool.estimateSwapFeeAmount(
            paidTokenIndex,
            protocolFeePercentage,
            currentBalances
          );
          expectedDueProtocolFeeAmounts = ZEROS.map((n, i) => (i === paidTokenIndex ? protocolFeeAmount : n));
        });

        context('with same amplification parameter', () => {
          itPaysExpectedProtocolFees();
        });

        context('with different amplification parameter', () => {
          sharedBeforeEach('change amplification parameter', async () => {
            const newAmplificationParameter = AMPLIFICATION_PARAMETER.div(8);

            await pool.startAmpChange(newAmplificationParameter, await fromNow(MONTH), { from: owner });
            await advanceTime(MONTH);

            const { value, precision } = await pool.getAmplificationParameter();
            expect(value.div(precision)).to.equal(newAmplificationParameter);
          });

          itPaysExpectedProtocolFees();
        });

        function itPaysExpectedProtocolFees() {
          it('pays swap protocol fees on join exact tokens in for BPT out', async () => {
            const result = await pool.joinGivenIn({
              from: lp,
              amountsIn: fp(1),
              currentBalances,
              protocolFeePercentage,
            });

            expect(result.dueProtocolFeeAmounts).to.be.equalWithError(expectedDueProtocolFeeAmounts, 0.0001);
          });

          it('pays swap protocol fees on exit exact BPT in for one token out', async () => {
            const result = await pool.singleExitGivenIn({
              from: lp,
              bptIn: fp(0.5),
              token: 0,
              currentBalances,
              protocolFeePercentage,
            });

            expect(result.dueProtocolFeeAmounts).to.be.equalWithError(expectedDueProtocolFeeAmounts, 0.0001);
          });

          it('pays swap protocol fees on exit exact BPT in for all tokens out', async () => {
            const result = await pool.multiExitGivenIn({
              from: lp,
              bptIn: fp(1),
              currentBalances,
              protocolFeePercentage,
            });

            expect(result.dueProtocolFeeAmounts).to.be.equalWithError(expectedDueProtocolFeeAmounts, 0.0001);
          });

          it('pays swap protocol fees on exit BPT In for exact tokens out', async () => {
            const result = await pool.exitGivenOut({
              from: lp,
              amountsOut: fp(1),
              currentBalances,
              protocolFeePercentage,
            });

            expect(result.dueProtocolFeeAmounts).to.be.equalWithError(expectedDueProtocolFeeAmounts, 0.0001);
          });

          it('does not charges fee on exit if paused', async () => {
            await pool.pause();

            const exitResult = await pool.multiExitGivenIn({ from: lp, bptIn: fp(0.5), protocolFeePercentage });
            expect(exitResult.dueProtocolFeeAmounts).to.be.zeros;
          });
        }
      });
    });

    describe('get rate', () => {
      sharedBeforeEach('deploy pool', async () => {
        tokens = (
          await TokenList.create(
            [
              { decimals: 18, symbol: 'MKR' },
              { decimals: 18, symbol: 'DAI' },
              { decimals: 6, symbol: 'USDT' },
            ],
            { sorted: true }
          )
        ).subset(numberOfTokens);

        const swapFeePercentage = fp(0.1);
        await deployPool({ swapFeePercentage, tokens });
      });

      context('before initialized', () => {
        it('rate is zero', async () => {
          await expect(pool.getRate()).to.be.revertedWith('ZERO_DIVISION');
        });
      });

      context('once initialized', () => {
        sharedBeforeEach('initialize pool', async () => {
          await pool.init({ recipient, initialBalances });
        });

        it('rate equals to one', async () => {
          const result = await pool.getRate();

          expect(result).to.equalWithError(fp(1), 0.0001);
        });
      });
    });

    describe('set amp', () => {
      sharedBeforeEach('deploy pool', async () => {
        await deployPool({ owner });
      });

      context('when the sender is allowed', () => {
        context('when requesting a reasonable change duration', () => {
          const duration = DAY * 2;
          let endTime: BigNumber;

          sharedBeforeEach('set end time', async () => {
            const startTime = (await currentTimestamp()).add(100);
            await setNextBlockTimestamp(startTime);
            endTime = startTime.add(duration);
          });

          context('when requesting a valid amp', () => {
            const itUpdatesAmpCorrectly = (newAmp: BigNumber) => {
              const increasing = AMPLIFICATION_PARAMETER.lt(newAmp);

              context('when there was no previous ongoing update', () => {
                it('starts changing the amp', async () => {
                  await pool.startAmpChange(newAmp, endTime);

                  await advanceTime(duration / 2);

                  const { value, isUpdating } = await pool.getAmplificationParameter();
                  expect(isUpdating).to.be.true;

                  if (increasing) {
                    const diff = newAmp.sub(AMPLIFICATION_PARAMETER).mul(AMP_PRECISION);
                    expect(value).to.be.equal(AMPLIFICATION_PARAMETER.mul(AMP_PRECISION).add(diff.div(2)));
                  } else {
                    const diff = AMPLIFICATION_PARAMETER.sub(newAmp).mul(AMP_PRECISION);
                    expect(value).to.be.equal(AMPLIFICATION_PARAMETER.mul(AMP_PRECISION).sub(diff.div(2)));
                  }
                });

                it('stops updating after duration', async () => {
                  await pool.startAmpChange(newAmp, endTime);

                  await advanceTime(duration + 1);

                  const { value, isUpdating } = await pool.getAmplificationParameter();
                  expect(value).to.be.equal(newAmp.mul(AMP_PRECISION));
                  expect(isUpdating).to.be.false;
                });

                it('emits an event', async () => {
                  const receipt = await pool.startAmpChange(newAmp, endTime);

                  expectEvent.inReceipt(await receipt.wait(), 'AmpUpdateStarted', {
                    startValue: AMPLIFICATION_PARAMETER.mul(AMP_PRECISION),
                    endValue: newAmp.mul(AMP_PRECISION),
                    endTime,
                  });
                });
              });

              context('when there was a previous ongoing update', () => {
                sharedBeforeEach('start change', async () => {
                  await pool.startAmpChange(newAmp, endTime);
                });

                it('reverts', async () => {
                  await expect(pool.startAmpChange(newAmp, endTime)).to.be.revertedWith('AMP_ONGOING_UPDATE');
                });

                it('can stop and change', async () => {
                  await advanceTime(duration / 3);
                  const beforeStop = await pool.getAmplificationParameter();
                  expect(beforeStop.isUpdating).to.be.true;

                  const stopReceipt = await pool.stopAmpChange();
                  expectEvent.inReceipt(await stopReceipt.wait(), 'AmpUpdateStopped');

                  const afterStop = await pool.getAmplificationParameter();
                  expect(afterStop.value).to.be.equalWithError(beforeStop.value, 0.001);
                  expect(afterStop.isUpdating).to.be.false;

                  const newEndTime = (await currentTimestamp()).add(DAY * 2);
                  const startReceipt = await pool.startAmpChange(newAmp, newEndTime);
                  const now = await currentTimestamp();
                  expectEvent.inReceipt(await startReceipt.wait(), 'AmpUpdateStarted', {
                    endValue: newAmp.mul(AMP_PRECISION),
                    startTime: now,
                    endTime: newEndTime,
                  });

                  await advanceTime(duration / 3);

                  const afterStart = await pool.getAmplificationParameter();
                  expect(afterStart.isUpdating).to.be.true;
                  expect(afterStart.value).to.be[increasing ? 'gt' : 'lt'](afterStop.value);
                });
              });
            };

            context('when increasing the amp', () => {
              context('when increasing the amp by 2x', () => {
                const newAmp = AMPLIFICATION_PARAMETER.mul(2);

                itUpdatesAmpCorrectly(newAmp);
              });
            });

            context('when decreasing the amp', () => {
              context('when decreasing the amp by 2x', () => {
                const newAmp = AMPLIFICATION_PARAMETER.div(2);

                itUpdatesAmpCorrectly(newAmp);
              });
            });
          });

          context('when requesting an invalid amp', () => {
            it('reverts when requesting below the min', async () => {
              const lowAmp = bn(0);
              await expect(pool.startAmpChange(lowAmp)).to.be.revertedWith('MIN_AMP');
            });

            it('reverts when requesting above the max', async () => {
              const highAmp = bn(5001);
              await expect(pool.startAmpChange(highAmp)).to.be.revertedWith('MAX_AMP');
            });

            describe('rate limits', () => {
              let startTime: BigNumber;

              beforeEach('set start time', async () => {
                startTime = (await currentTimestamp()).add(100);
                await setNextBlockTimestamp(startTime);
              });

              it('reverts when increasing the amp by more than 2x in a single day', async () => {
                const newAmp = AMPLIFICATION_PARAMETER.mul(2).add(1);
                const endTime = startTime.add(DAY);

                await expect(pool.startAmpChange(newAmp, endTime)).to.be.revertedWith('AMP_RATE_TOO_HIGH');
              });

              it('reverts when increasing the amp by more than 2x daily over multiple days', async () => {
                const newAmp = AMPLIFICATION_PARAMETER.mul(5).add(1);
                const endTime = startTime.add(DAY * 2);

                await expect(pool.startAmpChange(newAmp, endTime)).to.be.revertedWith('AMP_RATE_TOO_HIGH');
              });

              it('reverts when decreasing the amp by more than 2x in a single day', async () => {
                const newAmp = AMPLIFICATION_PARAMETER.div(2).sub(1);
                const endTime = startTime.add(DAY);

                await expect(pool.startAmpChange(newAmp, endTime)).to.be.revertedWith('AMP_RATE_TOO_HIGH');
              });

              it('reverts when decreasing the amp by more than 2x daily over multiple days', async () => {
                const newAmp = AMPLIFICATION_PARAMETER.div(5).sub(1);
                const endTime = startTime.add(DAY * 2);

                await expect(pool.startAmpChange(newAmp, endTime)).to.be.revertedWith('AMP_RATE_TOO_HIGH');
              });
            });
          });
        });

        context('when requesting a short duration change', () => {
          let endTime;

          it('reverts', async () => {
            endTime = (await currentTimestamp()).add(DAY).sub(1);
            await expect(pool.startAmpChange(AMPLIFICATION_PARAMETER, endTime)).to.be.revertedWith(
              'AMP_END_TIME_TOO_CLOSE'
            );
          });
        });
      });

      context('when the sender is not allowed', () => {
        it('reverts', async () => {
          const from = trader;

          await expect(pool.stopAmpChange({ from })).to.be.revertedWith('SENDER_NOT_ALLOWED');
          await expect(pool.startAmpChange(AMPLIFICATION_PARAMETER, DAY, { from })).to.be.revertedWith(
            'SENDER_NOT_ALLOWED'
          );
        });
      });
    });
  }
});
