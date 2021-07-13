import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import { BigNumberish, bn, fp, pct } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { RawWeightedPoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';

export function itBehavesAsWeightedPool(numberOfTokens: number, useCustomTwoTokenPool = false): void {
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const WEIGHTS = [fp(30), fp(70), fp(5), fp(5)];
  const INITIAL_BALANCES = [fp(0.9), fp(1.8), fp(2.7), fp(3.6)];

  let recipient: SignerWithAddress, other: SignerWithAddress, lp: SignerWithAddress, assetManager: SignerWithAddress;

  let pool: WeightedPool, allTokens: TokenList, tokens: TokenList;

  const ZEROS = Array(numberOfTokens).fill(bn(0));
  const weights: BigNumberish[] = WEIGHTS.slice(0, numberOfTokens);
  const initialBalances = INITIAL_BALANCES.slice(0, numberOfTokens);

  async function deployPool(params: RawWeightedPoolDeployment = {}): Promise<void> {
    const assetManagers = Array(numberOfTokens).fill(assetManager.address);

    params = Object.assign(
      {},
      { tokens, weights, assetManagers, swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE, twoTokens: useCustomTwoTokenPool },
      params
    );
    pool = await WeightedPool.create(params);
  }

  before('setup signers', async () => {
    [, lp, recipient, other, assetManager] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy tokens', async () => {
    allTokens = await TokenList.create(['MKR', 'DAI', 'SNX', 'BAT'], { sorted: true });
    await allTokens.mint({ to: lp, amount: fp(100) });
  });

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

      it('uses the corresponding specialization', async () => {
        const expectedSpecialization =
          numberOfTokens == 2 ? PoolSpecialization.TwoTokenPool : PoolSpecialization.MinimalSwapInfoPool;

        const { address, specialization } = await pool.getRegisteredInfo();
        expect(address).to.equal(pool.address);
        expect(specialization).to.equal(expectedSpecialization);
      });

      it('registers tokens in the vault', async () => {
        const poolTokens = await pool.getTokens();

        expect(poolTokens.tokens).to.have.members(tokens.addresses);
        expect(poolTokens.balances).to.be.zeros;
      });

      it('starts with no BPT', async () => {
        expect(await pool.totalSupply()).to.be.equal(0);
      });

      it('sets the asset managers', async () => {
        await tokens.asyncEach(async (token) => {
          const info = await pool.getTokenInfo(token);
          expect(info.assetManager).to.equal(useCustomTwoTokenPool ? ZERO_ADDRESS : assetManager.address);
        });
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
      if (!useCustomTwoTokenPool) {
        it('reverts if the number of tokens and weights do not match', async () => {
          const badWeights = weights.slice(1);

          await expect(deployPool({ weights: badWeights })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });
      }

      it('reverts if there are repeated tokens', async () => {
        const badTokens = new TokenList(Array(numberOfTokens).fill(tokens.first));

        const error = useCustomTwoTokenPool ? 'TOKEN_ALREADY_REGISTERED' : 'UNSORTED_ARRAY';
        await expect(deployPool({ tokens: badTokens, fromFactory: true })).to.be.revertedWith(error);
      });

      it('reverts if the swap fee is too high', async () => {
        const badSwapFeePercentage = fp(0.1).add(1);

        await expect(deployPool({ swapFeePercentage: badSwapFeePercentage })).to.be.revertedWith(
          'MAX_SWAP_FEE_PERCENTAGE'
        );
      });

      it('reverts if at least one weight is too low', async () => {
        const badWeights = WEIGHTS.slice(0, numberOfTokens);
        badWeights[0] = bn(99);

        await expect(deployPool({ weights: badWeights })).to.be.revertedWith('MIN_WEIGHT');
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
      it('grants the n * invariant amount of BPT', async () => {
        const invariant = await pool.estimateInvariant(initialBalances);

        const { amountsIn, dueProtocolFeeAmounts } = await pool.init({ recipient, initialBalances });

        // Amounts in should be the same as initial ones
        expect(amountsIn).to.deep.equal(initialBalances);

        // Protocol fees should be zero
        expect(dueProtocolFeeAmounts).to.be.zeros;

        // Initial balances should equal invariant
        expect(await pool.balanceOf(recipient)).to.be.equalWithError(invariant.mul(numberOfTokens), 0.001);
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

        it('fails if invariant increases more than max allowed', async () => {
          // Calculate bpt out so that the invariant ratio
          // ((bptTotalSupply + bptAmountOut / bptTotalSupply))
          // is more than 3
          const bptOut = (await pool.getMaxInvariantIncrease()).add(10);

          await expect(pool.joinGivenOut({ bptOut, token })).to.be.revertedWith('MAX_OUT_BPT_FOR_TOKEN_IN');
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

      it('fails if invariant decreases more than max allowed', async () => {
        // Calculate bpt amount in so that the invariant ratio
        // ((bptTotalSupply - bptAmountIn / bptTotalSupply))
        // is more than 0.7
        const bptIn = (await pool.getMaxInvariantDecrease()).add(5);
        await expect(pool.singleExitGivenIn({ bptIn, token })).to.be.revertedWith('MIN_BPT_IN_FOR_TOKEN_OUT');
      });

      it('reverts if paused', async () => {
        await pool.pause();

        const bptIn = await pool.getMaxInvariantDecrease();
        await expect(pool.singleExitGivenIn({ bptIn, token })).to.be.revertedWith('PAUSED');
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

        await expect(pool.exitGivenOut({ from: lp, amountsOut, maximumBptIn })).to.be.revertedWith('BPT_IN_MAX_AMOUNT');
      });

      it('reverts if paused', async () => {
        await pool.pause();

        const amountsOut = initialBalances;
        await expect(pool.exitGivenOut({ from: lp, amountsOut })).to.be.revertedWith('PAUSED');
      });
    });
  });

  describe('onSwap', () => {
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

        expect(result).to.be.equalWithError(expectedAmountOut, 0.01);
      });

      it('calculates max amount out', async () => {
        const maxAmountIn = await pool.getMaxIn(1);
        const maxAmountInWithFees = maxAmountIn.mul(POOL_SWAP_FEE_PERCENTAGE.add(fp(1))).div(fp(1));
        const expectedAmountOut = await pool.estimateGivenIn({ in: 1, out: 0, amount: maxAmountInWithFees });

        const result = await pool.swapGivenIn({ in: 1, out: 0, amount: maxAmountInWithFees });

        expect(result).to.be.equalWithError(expectedAmountOut, 0.05);
      });

      it('reverts if token in exceeds max in ratio', async () => {
        const maxAmountIn = await pool.getMaxIn(1);
        const maxAmountInWithFees = maxAmountIn.mul(POOL_SWAP_FEE_PERCENTAGE.add(fp(1))).div(fp(1));

        const amount = maxAmountInWithFees.add(fp(1));
        await expect(pool.swapGivenIn({ in: 1, out: 0, amount })).to.be.revertedWith('MAX_IN_RATIO');
      });

      if (!useCustomTwoTokenPool) {
        it('reverts if token in is not in the pool', async () => {
          await expect(pool.swapGivenIn({ in: allTokens.BAT, out: 0, amount: 1 })).to.be.revertedWith('INVALID_TOKEN');
        });

        it('reverts if token out is not in the pool', async () => {
          await expect(pool.swapGivenIn({ in: 1, out: allTokens.BAT, amount: 1 })).to.be.revertedWith('INVALID_TOKEN');
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

      it('calculates max amount in', async () => {
        const amount = await pool.getMaxOut(0);
        const expectedAmountIn = await pool.estimateGivenOut({ in: 1, out: 0, amount });

        const result = await pool.swapGivenOut({ in: 1, out: 0, amount });

        expect(result).to.be.equalWithError(expectedAmountIn, 0.1);
      });

      it('reverts if token in exceeds max out ratio', async () => {
        const amount = (await pool.getMaxOut(0)).add(2);

        await expect(pool.swapGivenOut({ in: 1, out: 0, amount })).to.be.revertedWith('MAX_OUT_RATIO');
      });

      if (!useCustomTwoTokenPool) {
        it('reverts if token in is not in the pool when given out', async () => {
          await expect(pool.swapGivenOut({ in: allTokens.BAT, out: 0, amount: 1 })).to.be.revertedWith('INVALID_TOKEN');
        });

        it('reverts if token out is not in the pool', async () => {
          await expect(pool.swapGivenOut({ in: 1, out: allTokens.BAT, amount: 1 })).to.be.revertedWith('INVALID_TOKEN');
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
      await deployPool();
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

      sharedBeforeEach('simulate doubled initial balances ', async () => {
        // 4/3 of the initial balances
        currentBalances = initialBalances.map((balance) => balance.mul(4).div(3));
      });

      sharedBeforeEach('compute expected due protocol fees', async () => {
        const paidTokenIndex = pool.weights.indexOf(pool.maxWeight);
        const protocolFeeAmount = await pool.estimateSwapFeeAmount(
          paidTokenIndex,
          protocolFeePercentage,
          currentBalances
        );
        expectedDueProtocolFeeAmounts = ZEROS.map((n, i) => (i === paidTokenIndex ? protocolFeeAmount : n));
      });

      it('pays swap protocol fees on join exact tokens in for BPT out', async () => {
        const result = await pool.joinGivenIn({ from: lp, amountsIn: fp(1), currentBalances, protocolFeePercentage });

        expect(result.dueProtocolFeeAmounts).to.be.equalWithError(expectedDueProtocolFeeAmounts, 0.1);
      });

      it('pays swap protocol fees on exit exact BPT in for one token out', async () => {
        const result = await pool.singleExitGivenIn({
          from: lp,
          bptIn: fp(0.5),
          token: 0,
          currentBalances,
          protocolFeePercentage,
        });

        expect(result.dueProtocolFeeAmounts).to.be.equalWithError(expectedDueProtocolFeeAmounts, 0.1);
      });

      it('pays swap protocol fees on exit exact BPT in for all tokens out', async () => {
        const result = await pool.multiExitGivenIn({
          from: lp,
          bptIn: fp(1),
          currentBalances,
          protocolFeePercentage,
        });

        expect(result.dueProtocolFeeAmounts).to.be.equalWithError(expectedDueProtocolFeeAmounts, 0.1);
      });

      it('pays swap protocol fees on exit BPT In for exact tokens out', async () => {
        const result = await pool.exitGivenOut({
          from: lp,
          amountsOut: fp(1),
          currentBalances,
          protocolFeePercentage,
        });

        expect(result.dueProtocolFeeAmounts).to.be.equalWithError(expectedDueProtocolFeeAmounts, 0.1);
      });

      it('does not charges fee on exit if paused', async () => {
        await pool.pause();

        const exitResult = await pool.multiExitGivenIn({ from: lp, bptIn: fp(0.5), protocolFeePercentage });
        expect(exitResult.dueProtocolFeeAmounts).to.be.zeros;
      });
    });

    context('with swap and exceeded min invariant ratio', () => {
      let currentBalances: BigNumber[], expectedDueProtocolFeeAmounts: BigNumber[];

      sharedBeforeEach('simulate doubled initial balances ', async () => {
        // twice the initial balances
        currentBalances = initialBalances.map((balance) => balance.mul(2));
      });

      sharedBeforeEach('compute expected due protocol fees', async () => {
        const paidTokenIndex = pool.weights.indexOf(pool.maxWeight);
        const feeAmount = await pool.estimateMaxSwapFeeAmount(paidTokenIndex, protocolFeePercentage, currentBalances);
        expectedDueProtocolFeeAmounts = ZEROS.map((n, i) => (i === paidTokenIndex ? feeAmount : n));
      });

      it('pays swap protocol fees on join exact tokens in for BPT out', async () => {
        const result = await pool.joinGivenIn({ from: lp, amountsIn: fp(1), currentBalances, protocolFeePercentage });

        expect(result.dueProtocolFeeAmounts).to.be.equalWithError(expectedDueProtocolFeeAmounts, 0.1);
      });

      it('pays swap protocol fees on exit exact BPT in for one token out', async () => {
        const result = await pool.singleExitGivenIn({
          from: lp,
          bptIn: fp(0.5),
          token: 0,
          currentBalances,
          protocolFeePercentage,
        });

        expect(result.dueProtocolFeeAmounts).to.be.equalWithError(expectedDueProtocolFeeAmounts, 0.1);
      });

      it('pays swap protocol fees on exit exact BPT in for all tokens out', async () => {
        const result = await pool.multiExitGivenIn({
          from: lp,
          bptIn: fp(1),
          currentBalances,
          protocolFeePercentage,
        });

        expect(result.dueProtocolFeeAmounts).to.be.equalWithError(expectedDueProtocolFeeAmounts, 0.1);
      });

      it('pays swap protocol fees on exit BPT In for exact tokens out', async () => {
        const result = await pool.exitGivenOut({
          from: lp,
          amountsOut: fp(1),
          currentBalances,
          protocolFeePercentage,
        });

        expect(result.dueProtocolFeeAmounts).to.be.equalWithError(expectedDueProtocolFeeAmounts, 0.1);
      });
    });
  });
}
