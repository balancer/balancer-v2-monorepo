import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, BigNumberish, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '../../helpers/expectEvent';
import { expectEqualWithError } from '../../helpers/relativeError';
import {
  calcBptOutGivenExactTokensIn,
  calcTokenInGivenExactBptOut,
  calcInGivenOut,
  calcTokenOutGivenExactBptIn,
  calculateInvariant,
  calcOutGivenIn,
  toNormalizedWeights,
  calculateOneTokenSwapFee,
} from '../../helpers/math/weighted';

import { deploy } from '../../../lib/helpers/deploy';
import { bn, fp, decimal, pct } from '../../../lib/helpers/numbers';
import { ZERO_ADDRESS, MAX_UINT112 } from '../../../lib/helpers/constants';
import { MinimalSwapInfoPool, TwoTokenPool } from '../../../lib/helpers/pools';
import { deploySortedTokens, deployTokens, TokenList } from '../../../lib/helpers/tokens';
import { encodeExitWeightedPool, encodeJoinWeightedPool } from '../../../lib/helpers/weightedPoolEncoding';

describe.only('WeightedPool', function () {
  let authorizer: Contract, tokenList: TokenList, tokens: Array<Contract>;
  let admin: SignerWithAddress, lp: SignerWithAddress;
  let trader: SignerWithAddress, beneficiary: SignerWithAddress, other: SignerWithAddress;

  const POOL_SWAP_FEE = fp(0.01);
  const SYMBOLS = ['DAI', 'MKR', 'SNX', 'BAT'];
  const WEIGHTS = [bn(70e18), bn(30e18), bn(5e18), bn(5e18)];
  const INITIAL_BALANCES = [bn(0.9e18), bn(1.8e18), bn(2.7e18), bn(3.6e18)];

  before('setup signers', async () => {
    [, admin, lp, trader, beneficiary, other] = await ethers.getSigners();
    authorizer = await deploy('Authorizer', { args: [admin.address] });
  });

  beforeEach('deploy tokens', async () => {
    tokenList = await deploySortedTokens(SYMBOLS, [18, 18, 18, 18]);
    tokens = Object.values(tokenList);

    for (const token of tokens) {
      await token.mint(lp.address, bn(100e18));
      await token.mint(trader.address, bn(100e18));
    }
  });

  context('for a 1 token pool', () => {
    it('reverts if there is a single token', async () => {
      const poolTokens = tokens.map((token) => token.address).slice(0, 1);
      const poolWeights = WEIGHTS.slice(0, 1);
      const vault = await deploy('Vault', { args: [authorizer.address] });

      const args = [vault.address, 'Balancer Pool Token', 'BPT', poolTokens, poolWeights, POOL_SWAP_FEE];
      await expect(deploy('WeightedPool', { args })).to.be.revertedWith('MIN_TOKENS');
    });
  });

  context('for a 2 token pool', () => {
    itBehavesAsWeightedPool(2);
  });

  context('for a 3 token pool', () => {
    itBehavesAsWeightedPool(3);
  });

  context('for a too-many token pool', () => {
    it('reverts if there are too many tokens', async () => {
      // The maximum number of tokens is 16
      const manyTokens = await deployTokens(
        Array(17)
          .fill('TK')
          .map((v, i) => `${v}${i}`),
        Array(17).fill(18)
      );

      const poolTokens = Object.values(manyTokens).map((token) => token.address);
      const poolWeights = new Array(17).fill(fp(1));
      const vault = await deploy('Vault', { args: [authorizer.address] });

      const args = [vault.address, 'Balancer Pool Token', 'BPT', poolTokens, poolWeights, POOL_SWAP_FEE];
      await expect(deploy('WeightedPool', { args })).to.be.revertedWith('MAX_TOKENS');
    });
  });

  function itBehavesAsWeightedPool(numberOfTokens: number) {
    let pool: Contract, poolId: string, vault: Contract, factory: Contract, poolTokens: string[];

    const ZEROS = Array(numberOfTokens).fill(bn(0));
    const poolWeights = WEIGHTS.slice(0, numberOfTokens);
    const poolInitialBalances = INITIAL_BALANCES.slice(0, numberOfTokens);

    async function deployPool({
      tokens,
      weights,
      swapFee,
      fromFactory,
    }: {
      tokens?: string[];
      weights?: BigNumber[];
      swapFee?: BigNumber;
      fromFactory?: boolean;
    } = {}) {
      tokens = tokens ?? poolTokens;
      weights = weights ?? poolWeights;
      swapFee = swapFee ?? POOL_SWAP_FEE;
      fromFactory = fromFactory ?? false;

      if (fromFactory) {
        vault = await deploy('Vault', { args: [authorizer.address] });
        factory = await deploy('WeightedPoolFactory', { args: [vault.address] });
        const tx = await factory.create('Balancer Pool Token', 'BPT', tokens, weights, swapFee);
        const receipt = await tx.wait();
        const event = expectEvent.inReceipt(receipt, 'PoolCreated');
        pool = await ethers.getContractAt('WeightedPool', event.args.pool);
      } else {
        vault = await deploy('MockVault', { args: [] });
        const args = [vault.address, 'Balancer Pool Token', 'BPT', tokens, weights, swapFee];
        pool = await deploy('WeightedPool', { args });
      }

      poolId = await pool.getPoolId();
    }

    beforeEach('define pool tokens', () => {
      poolTokens = tokens.map((token) => token.address).slice(0, numberOfTokens);
    });

    describe('creation', () => {
      context('when the creation succeeds', () => {
        beforeEach('deploy pool from factory', async () => {
          await deployPool({ fromFactory: true });
        });

        it('sets the vault', async () => {
          expect(await pool.getVault()).to.equal(vault.address);
        });

        it('uses the corresponding specialization', async () => {
          const expectedSpecialization = numberOfTokens == 2 ? TwoTokenPool : MinimalSwapInfoPool;

          expect(await vault.getPool(poolId)).to.have.members([pool.address, expectedSpecialization]);
        });

        it('registers tokens in the vault', async () => {
          const { tokens, balances } = await vault.getPoolTokens(poolId);

          expect(tokens).to.have.members(poolTokens);
          expect(balances).to.deep.equal(ZEROS);
        });

        it('starts with no BPT', async () => {
          expect(await pool.totalSupply()).to.deep.equal(0);
        });

        it('sets the asset managers', async () => {
          for (const token of poolTokens) {
            expect(await vault.getPoolAssetManager(poolId, token)).to.equal(ZERO_ADDRESS);
          }
        });

        it('sets token weights', async () => {
          const normalizedWeights = await pool.getNormalizedWeights(poolTokens);
          const expectedNormalizedWeights = toNormalizedWeights(poolWeights).map((w) => bn(w.mul(1e18)));

          normalizedWeights.map((weight: BigNumber, i: number) => {
            expectEqualWithError(weight, expectedNormalizedWeights[i], 0.0000001);
          });
        });

        it('sets swap fee', async () => {
          expect(await pool.getSwapFee()).to.equal(POOL_SWAP_FEE);
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
        it('reverts if the number of tokens and weights do not match', async () => {
          const weights = poolWeights.slice(1);

          await expect(deployPool({ weights })).to.be.revertedWith('ARRAY_LENGTH_MISMATCH');
        });

        it('reverts if there are repeated tokens', async () => {
          const tokens = new Array(numberOfTokens).fill(poolTokens[0]);

          await expect(deployPool({ tokens, fromFactory: true })).to.be.revertedWith('Create2: Failed on deploy');
        });

        it('reverts if the swap fee is too high', async () => {
          const swapFee = fp(0.1).add(1);

          await expect(deployPool({ swapFee })).to.be.revertedWith('MAX_SWAP_FEE');
        });

        it('reverts if at least one weight is too high', async () => {
          const weights = WEIGHTS.slice(0, numberOfTokens);
          weights[0] = bn(50000).mul(bn(10e18));

          await expect(deployPool({ weights: weights })).to.be.revertedWith('MAX_WEIGHT');
        });

        it('reverts if at least one weight is too low', async () => {
          const weights = WEIGHTS.slice(0, numberOfTokens);
          weights[0] = bn(10);

          await expect(deployPool({ weights: weights })).to.be.revertedWith('MIN_WEIGHT');
        });
      });
    });

    describe('onJoinPool', () => {
      beforeEach('deploy pool', async () => {
        await deployPool();
      });

      it('fails if caller is not the vault', async () => {
        await expect(
          pool.connect(lp).onJoinPool(poolId, lp.address, other.address, [0], 0, 0, '0x')
        ).to.be.revertedWith('CALLER_NOT_VAULT');
      });

      it.skip('fails if wrong pool id'); // if Pools can only register themselves, this is unnecessary

      it('fails if no user data', async () => {
        await expect(
          vault.connect(lp).callJoinPool(pool.address, poolId, beneficiary.address, ZEROS, 0, 0, '0x')
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      it('fails if wrong user data', async () => {
        const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);

        await expect(
          vault.connect(lp).callJoinPool(pool.address, poolId, beneficiary.address, ZEROS, 0, 0, wrongUserData)
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      context('initialization', () => {
        let initialJoinUserData: string;

        beforeEach(async () => {
          initialJoinUserData = encodeJoinWeightedPool({ kind: 'Init', amountsIn: poolInitialBalances });
        });

        it('grants the n * invariant amount of BPT', async () => {
          const invariant = calculateInvariant(poolInitialBalances, poolWeights);

          const receipt = await (
            await vault.callJoinPool(pool.address, poolId, beneficiary.address, ZEROS, 0, 0, initialJoinUserData)
          ).wait();

          const { amountsIn, dueProtocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolJoined').args;

          // Amounts in should be the same as initial ones
          expect(amountsIn).to.deep.equal(poolInitialBalances);

          // Protocol fees should be zero
          expect(dueProtocolFeeAmounts).to.deep.equal(ZEROS);

          // Initial balances should equal invariant
          const currentBptBalance = await pool.balanceOf(beneficiary.address);
          expectEqualWithError(currentBptBalance, invariant.mul(numberOfTokens), 0.001);
        });

        it('fails if already initialized', async () => {
          await vault.callJoinPool(pool.address, poolId, beneficiary.address, ZEROS, 0, 0, initialJoinUserData);

          await expect(
            vault.callJoinPool(pool.address, poolId, beneficiary.address, ZEROS, 0, 0, initialJoinUserData)
          ).to.be.be.revertedWith('UNHANDLED_JOIN_KIND');
        });
      });

      context('join exact tokens in for BPT out', () => {
        it('fails if not initialized', async () => {
          const joinUserData = encodeJoinWeightedPool({
            kind: 'ExactTokensInForBPTOut',
            amountsIn: poolInitialBalances,
            minimumBPT: 0,
          });
          await expect(
            vault.callJoinPool(pool.address, poolId, beneficiary.address, ZEROS, 0, 0, joinUserData)
          ).to.be.be.revertedWith('UNINITIALIZED');
        });

        context('once initialized', () => {
          let exactAmountsIn: BigNumber[], previousBptSupply: BigNumber, expectedBptAmount: BigNumber;

          beforeEach('initialize pool', async () => {
            const initialJoinUserData = encodeJoinWeightedPool({ kind: 'Init', amountsIn: poolInitialBalances });
            await vault.callJoinPool(pool.address, poolId, beneficiary.address, ZEROS, 0, 0, initialJoinUserData);
          });

          beforeEach('compute expected BPT balances', async () => {
            previousBptSupply = await pool.totalSupply();

            exactAmountsIn = [...ZEROS];
            exactAmountsIn[1] = bn(0.1e18);

            expectedBptAmount = await calcBptOutGivenExactTokensIn(
              poolInitialBalances,
              poolWeights,
              exactAmountsIn,
              previousBptSupply,
              POOL_SWAP_FEE
            );
          });

          it('grants BPT for exact tokens', async () => {
            const previousBptBalance = await pool.balanceOf(beneficiary.address);

            const minimumBPT = pct(expectedBptAmount, 0.99);
            const joinUserData = encodeJoinWeightedPool({
              kind: 'ExactTokensInForBPTOut',
              amountsIn: exactAmountsIn,
              minimumBPT,
            });

            const receipt = await (
              await vault
                .connect(lp)
                .callJoinPool(pool.address, poolId, beneficiary.address, poolInitialBalances, 0, 0, joinUserData)
            ).wait();

            const { amountsIn, dueProtocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolJoined').args;

            // Amounts in should be the same as initial ones
            expect(amountsIn).to.deep.equal(exactAmountsIn);

            // Protocol fees should be zero
            expect(dueProtocolFeeAmounts).to.deep.equal(ZEROS);

            // Make sure received BPT is closed to what we expect
            const currentBptBalance = await pool.balanceOf(beneficiary.address);
            expectEqualWithError(currentBptBalance.sub(previousBptBalance), expectedBptAmount, 0.0001);
          });

          it('fails if not enough BPT', async () => {
            // This call should fail cause we are requesting minimum 1% more
            const minimumBPT = pct(expectedBptAmount, 1.01);
            const joinUserData = encodeJoinWeightedPool({
              kind: 'ExactTokensInForBPTOut',
              amountsIn: exactAmountsIn,
              minimumBPT,
            });

            await expect(
              vault
                .connect(lp)
                .callJoinPool(pool.address, poolId, beneficiary.address, poolInitialBalances, 0, 0, joinUserData)
            ).to.be.be.revertedWith('BPT_OUT_MIN_AMOUNT');
          });
        });
      });

      context('join token in for exact BPT out', () => {
        const enterTokenIndex = 0;

        it('fails if not initialized', async () => {
          const joinUserData = encodeJoinWeightedPool({
            kind: 'TokenInForExactBPTOut',
            bptAmountOut: bn(10e18),
            enterTokenIndex,
          });
          await expect(
            vault.callJoinPool(pool.address, poolId, beneficiary.address, ZEROS, 0, 0, joinUserData)
          ).to.be.be.revertedWith('UNINITIALIZED');
        });

        context('once initialized', () => {
          beforeEach('initialize pool', async () => {
            const initialJoinUserData = encodeJoinWeightedPool({ kind: 'Init', amountsIn: poolInitialBalances });
            await vault.callJoinPool(pool.address, poolId, beneficiary.address, ZEROS, 0, 0, initialJoinUserData);
          });

          it('grants exact BPT for token in', async () => {
            const previousBptSupply = await pool.totalSupply();

            const bptAmountOut = bn(10e18);

            const exactAmountsIn = [...ZEROS];
            exactAmountsIn[enterTokenIndex] = await calcTokenInGivenExactBptOut(
              enterTokenIndex,
              poolInitialBalances,
              poolWeights,
              bn(10e18),
              previousBptSupply,
              POOL_SWAP_FEE
            );

            const previousBptBalance = await pool.balanceOf(beneficiary.address);

            const joinUserData = encodeJoinWeightedPool({
              kind: 'TokenInForExactBPTOut',
              bptAmountOut,
              enterTokenIndex,
            });

            const receipt = await (
              await vault
                .connect(lp)
                .callJoinPool(pool.address, poolId, beneficiary.address, poolInitialBalances, 0, 0, joinUserData)
            ).wait();

            const { amountsIn, dueProtocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolJoined').args;

            // Only token in should be the one transferred
            expectEqualWithError(amountsIn[enterTokenIndex], exactAmountsIn[enterTokenIndex], 0.001);
            amountsIn
              .filter((amountIn: BigNumber, i: number) => i != enterTokenIndex)
              .forEach((amountIn: BigNumber) => expect(amountIn).to.equal(0));

            // Protocol fees should be zero
            expect(dueProtocolFeeAmounts).to.deep.equal(ZEROS);

            // Make sure received BPT is closed to what we expect
            const currentBptBalance = await pool.balanceOf(beneficiary.address);
            expectEqualWithError(currentBptBalance.sub(previousBptBalance), bptAmountOut, 0.001);
          });
        });
      });
    });

    describe('onExitPool', () => {
      let previousBptBalance: BigNumber, previousBptSupply: BigNumber;

      beforeEach('deploy and initialize pool', async () => {
        await deployPool();

        const initialJoinUserData = encodeJoinWeightedPool({ kind: 'Init', amountsIn: poolInitialBalances });
        await vault.callJoinPool(pool.address, poolId, lp.address, ZEROS, 0, 0, initialJoinUserData);

        previousBptSupply = await pool.totalSupply();
        previousBptBalance = await pool.balanceOf(lp.address);
      });

      it('fails if caller is not the vault', async () => {
        await expect(
          pool.connect(lp).onExitPool(poolId, beneficiary.address, other.address, [0], 0, 0, '0x')
        ).to.be.revertedWith('CALLER_NOT_VAULT');
      });

      it.skip('fails if wrong pool id'); // if Pools can only register themselves, this is unnecessary

      it('fails if no user data', async () => {
        await expect(
          vault.connect(lp).callExitPool(pool.address, poolId, beneficiary.address, poolInitialBalances, 0, 0, '0x')
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      it('fails if wrong user data', async () => {
        const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);

        await expect(
          vault
            .connect(lp)
            .callExitPool(pool.address, poolId, beneficiary.address, poolInitialBalances, 0, 0, wrongUserData)
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      context('exit exact BPT in for one token out', () => {
        it('grants one token for exact bpt', async () => {
          // Fully exit
          const exitTokenIndex = 0;
          const exactBptIn = previousBptBalance;

          const expectedTokenOut = calcTokenOutGivenExactBptIn(
            exitTokenIndex,
            poolInitialBalances,
            poolWeights,
            exactBptIn,
            previousBptSupply,
            POOL_SWAP_FEE
          );

          const exitUserData = encodeExitWeightedPool({
            kind: 'ExactBPTInForOneTokenOut',
            bptAmountIn: exactBptIn,
            exitTokenIndex,
          });

          const receipt = await (
            await vault
              .connect(lp)
              .callExitPool(pool.address, poolId, beneficiary.address, poolInitialBalances, 0, 0, exitUserData)
          ).wait();

          const { amountsOut, dueProtocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolExited').args;

          // Protocol fees should be zero
          expect(dueProtocolFeeAmounts).to.deep.equal(ZEROS);

          // Only token out should be the one transferred
          expectEqualWithError(amountsOut[exitTokenIndex], expectedTokenOut, 0.0001);
          amountsOut
            .filter((amountOut: BigNumber, i: number) => i != exitTokenIndex)
            .forEach((amountOut: BigNumber) => expect(amountOut).to.equal(0));

          // Current BPT balance should be zero
          const currentBptBalance = await pool.balanceOf(lp.address);
          expect(currentBptBalance).to.equal(bn(0));
        });
      });

      context('exit exact BPT in for all tokens out', () => {
        it('grants all tokens for exact bpt', async () => {
          // Exit with half of the BPT balance
          const exactBptIn = previousBptBalance.div(2);
          const exitUserData = encodeExitWeightedPool({ kind: 'ExactBPTInForAllTokensOut', bptAmountIn: exactBptIn });

          const receipt = await (
            await vault
              .connect(lp)
              .callExitPool(pool.address, poolId, beneficiary.address, poolInitialBalances, 0, 0, exitUserData)
          ).wait();

          const { amountsOut, dueProtocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolExited').args;

          // Protocol fees should be zero
          expect(dueProtocolFeeAmounts).to.deep.equal(ZEROS);

          // Balances are reduced by half because we are returning half of the BPT supply
          poolInitialBalances.map((balance, i) => expectEqualWithError(amountsOut[i], balance.div(2), 0.001));

          // Current BPT balance should have been reduced by half
          const currentBptBalance = await pool.balanceOf(lp.address);
          expectEqualWithError(currentBptBalance, exactBptIn, 0.001);
        });

        it('fully exit', async () => {
          // Fully exit
          const exactBptIn = previousBptSupply;
          const exitUserData = encodeExitWeightedPool({ kind: 'ExactBPTInForAllTokensOut', bptAmountIn: exactBptIn });

          const receipt = await (
            await vault
              .connect(lp)
              .callExitPool(pool.address, poolId, beneficiary.address, poolInitialBalances, 0, 0, exitUserData)
          ).wait();

          const { amountsOut, dueProtocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolExited').args;

          // Protocol fees should be zero
          expect(dueProtocolFeeAmounts).to.deep.equal(ZEROS);

          // All token balances should have been extracted because we are returning the entire BPT supply
          expect(amountsOut).to.deep.equal(poolInitialBalances);

          // Current BPT balances should be zero due to full exit
          const currentBptBalance = await pool.balanceOf(lp.address);
          expect(currentBptBalance).to.equal(0);
        });
      });

      context('exit BPT in for exact tokens out', () => {
        it('grants exact tokens for bpt', async () => {
          // Request half of the token balances
          const exactTokensOut = poolInitialBalances.map((amount: BigNumber) => amount.div(2));
          const maxBptIn = pct(previousBptBalance.div(2), 1.01);
          const exitUserData = encodeExitWeightedPool({
            kind: 'BPTInForExactTokensOut',
            amountsOut: exactTokensOut,
            maxBPTAmountIn: maxBptIn,
          });

          const receipt = await (
            await vault
              .connect(lp)
              .callExitPool(pool.address, poolId, beneficiary.address, poolInitialBalances, 0, 0, exitUserData)
          ).wait();

          const { amountsOut, dueProtocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolExited').args;

          // Protocol fees should be zero
          expect(dueProtocolFeeAmounts).to.deep.equal(ZEROS);

          // Token balances should been reduced as requested
          expect(amountsOut).to.deep.equal(exactTokensOut);

          // BPT balance should have been reduced by half because we are returning half of the tokens
          const currentBptBalance = await pool.balanceOf(lp.address);
          expectEqualWithError(currentBptBalance, previousBptBalance.div(2), 0.001);
        });

        it('fails if more BTP needed', async () => {
          // Call should fail cause we are requesting a max amount lower than the actual needed
          const exactTokensOut = poolInitialBalances;
          const maxBptIn = previousBptBalance.div(2);
          const exitUserData = encodeExitWeightedPool({
            kind: 'BPTInForExactTokensOut',
            amountsOut: exactTokensOut,
            maxBPTAmountIn: maxBptIn,
          });

          await expect(
            vault
              .connect(lp)
              .callExitPool(pool.address, poolId, beneficiary.address, poolInitialBalances, 0, 0, exitUserData)
          ).to.be.be.revertedWith('BPT_IN_MAX_AMOUNT');
        });
      });
    });

    describe('swaps', () => {
      let swapRequestData: {
        tokenIn: string;
        tokenOut: string;
        amountIn?: BigNumberish;
        amountOut?: BigNumberish;
        poolId: string;
        from: string;
        to: string;
        latestBlockNumberUsed: number;
        userData: string;
      };

      beforeEach('set default swap request data', async () => {
        await deployPool();

        swapRequestData = {
          poolId,
          from: other.address,
          to: other.address,
          tokenIn: tokenList.DAI.address,
          tokenOut: tokenList.MKR.address,
          latestBlockNumberUsed: 0,
          userData: '0x',
        };
      });

      context('given in', () => {
        it('calculates amount out', async () => {
          // swap the same amount as the initial balance for token #0
          const AMOUNT_IN = bn(0.9e18);
          const AMOUNT_IN_WITH_FEES = AMOUNT_IN.mul(POOL_SWAP_FEE.add(bn(1e18))).div(bn(1e18));

          const result = await pool.callStatic.onSwapGivenIn(
            { ...swapRequestData, amountIn: AMOUNT_IN_WITH_FEES },
            poolInitialBalances[0], // tokenInBalance
            poolInitialBalances[1] // tokenOutBalance
          );

          const expectedAmountOut = calcOutGivenIn(
            poolInitialBalances[0],
            poolWeights[0],
            poolInitialBalances[1],
            poolWeights[1],
            AMOUNT_IN_WITH_FEES
          );

          expectEqualWithError(result, bn(expectedAmountOut), 0.005);
        });

        it('reverts if token in is not in the pool', async () => {
          await expect(
            pool.onSwapGivenIn(
              { ...swapRequestData, tokenIn: tokenList.BAT.address, amountIn: 100 },
              poolInitialBalances[0], // tokenInBalance
              poolInitialBalances[1] // tokenOutBalance
            )
          ).to.be.revertedWith('INVALID_TOKEN');
        });

        it('reverts if token out is not in the pool', async () => {
          await expect(
            pool.onSwapGivenIn(
              { ...swapRequestData, tokenOut: tokenList.BAT.address, amountIn: 100 },
              poolInitialBalances[0], // tokenInBalance
              poolInitialBalances[1] // tokenOutBalance
            )
          ).to.be.revertedWith('INVALID_TOKEN');
        });
      });

      context('given out', () => {
        it('calculates amount in', async () => {
          const AMOUNT_OUT = bn(1.35e18);

          const result = await pool.callStatic.onSwapGivenOut(
            { ...swapRequestData, amountOut: AMOUNT_OUT },
            poolInitialBalances[0], // tokenInBalance
            poolInitialBalances[1] // tokenOutBalance
          );

          const expectedAmountIn = calcInGivenOut(
            poolInitialBalances[0],
            poolWeights[0],
            poolInitialBalances[1],
            poolWeights[1],
            AMOUNT_OUT
          );

          expectEqualWithError(result, bn(expectedAmountIn), 0.1);
        });

        it('reverts if token in is not in the pool when given out', async () => {
          await expect(
            pool.onSwapGivenOut(
              { ...swapRequestData, tokenIn: tokenList.BAT.address, amountOut: 100 },
              poolInitialBalances[0], // tokenInBalance
              poolInitialBalances[1] // tokenOutBalance
            )
          ).to.be.revertedWith('INVALID_TOKEN');
        });

        it('reverts if token out is not in the pool', async () => {
          await expect(
            pool.onSwapGivenOut(
              { ...swapRequestData, tokenOut: tokenList.BAT.address, amountOut: 100 },
              poolInitialBalances[0], // tokenInBalance
              poolInitialBalances[1] // tokenOutBalance
            )
          ).to.be.revertedWith('INVALID_TOKEN');
        });
      });
    });

    describe('protocol swap fees', () => {
      const PROTOCOL_SWAP_FEE = fp(0.1); // 10 %

      beforeEach('deploy and join pool', async () => {
        await deployPool();

        const initialJoinUserData = encodeJoinWeightedPool({ kind: 'Init', amountsIn: poolInitialBalances });
        await vault.callJoinPool(pool.address, poolId, lp.address, ZEROS, 0, PROTOCOL_SWAP_FEE, initialJoinUserData);
      });

      const expectJoinProtocolSwapFeeEqualWithError = async (
        initialBalances: BigNumber[],
        expectedDueProtocolFeeAmounts: BigNumber[],
        joinUserData: string
      ): Promise<BigNumber[]> => {
        const receipt = await (
          await vault
            .connect(lp)
            .callJoinPool(pool.address, poolId, lp.address, initialBalances, 0, PROTOCOL_SWAP_FEE, joinUserData)
        ).wait();

        const { amountsIn, dueProtocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolJoined').args;

        for (let index = 0; index < dueProtocolFeeAmounts.length; index++) {
          expectEqualWithError(dueProtocolFeeAmounts[index], expectedDueProtocolFeeAmounts[index], 0.1);
        }

        return initialBalances.map((balance: BigNumber, index: number) => balance.add(amountsIn[index]));
      };

      const expectExitProtocolSwapFeeEqualWithError = async (
        initialBalances: BigNumber[],
        expectedDueProtocolFeeAmounts: BigNumber[],
        exitUserData: string
      ): Promise<BigNumber[]> => {
        const receipt = await (
          await vault
            .connect(lp)
            .callExitPool(pool.address, poolId, lp.address, initialBalances, 0, PROTOCOL_SWAP_FEE, exitUserData)
        ).wait();
        const { amountsOut, dueProtocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolExited').args;

        for (let index = 0; index < dueProtocolFeeAmounts.length; index++) {
          expectEqualWithError(dueProtocolFeeAmounts[index], expectedDueProtocolFeeAmounts[index], 0.1);
        }

        return initialBalances.map((balance: BigNumber, index: number) => balance.sub(amountsOut[index]));
      };

      it('joins and exits do not accumulate fees', async () => {
        let joinUserData = encodeJoinWeightedPool({
          kind: 'ExactTokensInForBPTOut',
          amountsIn: Array(poolTokens.length).fill(bn(100e18)),
          minimumBPT: 0,
        });
        let newBalances = await expectJoinProtocolSwapFeeEqualWithError(poolInitialBalances, ZEROS, joinUserData);

        joinUserData = encodeJoinWeightedPool({
          kind: 'TokenInForExactBPTOut',
          bptAmountOut: bn(1e18),
          enterTokenIndex: 0,
        });
        newBalances = await expectJoinProtocolSwapFeeEqualWithError(newBalances, ZEROS, joinUserData);

        let exitUserData = encodeExitWeightedPool({
          kind: 'ExactBPTInForOneTokenOut',
          bptAmountIn: bn(10e18),
          exitTokenIndex: 0,
        });
        newBalances = await expectExitProtocolSwapFeeEqualWithError(newBalances, ZEROS, exitUserData);

        exitUserData = encodeExitWeightedPool({ kind: 'ExactBPTInForAllTokensOut', bptAmountIn: bn(10e18) });
        newBalances = await expectExitProtocolSwapFeeEqualWithError(newBalances, ZEROS, exitUserData);

        joinUserData = encodeJoinWeightedPool({
          kind: 'ExactTokensInForBPTOut',
          amountsIn: Array(poolTokens.length).fill(bn(10e18)),
          minimumBPT: 0,
        });
        newBalances = await expectJoinProtocolSwapFeeEqualWithError(newBalances, ZEROS, joinUserData);

        exitUserData = encodeExitWeightedPool({
          kind: 'BPTInForExactTokensOut',
          amountsOut: Array(poolTokens.length).fill(bn(10e18)),
          maxBPTAmountIn: MAX_UINT112,
        });
        await expectExitProtocolSwapFeeEqualWithError(newBalances, ZEROS, exitUserData);
      });

      context('with swap', () => {
        let currentBalances: BigNumber[];
        let expectedDueProtocolFeeAmounts: BigNumber[];

        beforeEach('compute expected due protocol fees', async () => {
          const previousBlockHash = (await ethers.provider.getBlock('latest')).hash;
          const paidTokenIndex = decimal(previousBlockHash).mod(numberOfTokens).toNumber();

          const lastInvariant = calculateInvariant(poolInitialBalances, poolWeights);
          currentBalances = poolInitialBalances.map((balance) => balance.mul(2)); // twice the initial balances

          const feeAmount = calculateOneTokenSwapFee(currentBalances, poolWeights, lastInvariant, paidTokenIndex);
          const protocolFeeAmount = bn(feeAmount).mul(PROTOCOL_SWAP_FEE).div(bn(1e18));

          expectedDueProtocolFeeAmounts = [...ZEROS];
          expectedDueProtocolFeeAmounts[paidTokenIndex] = protocolFeeAmount;
        });

        it('pays swap protocol fees on join exact tokens in for BPT out', async () => {
          const joinUserData = encodeJoinWeightedPool({
            kind: 'ExactTokensInForBPTOut',
            amountsIn: Array(poolTokens.length).fill(bn(1e18)),
            minimumBPT: 0,
          });

          await expectJoinProtocolSwapFeeEqualWithError(currentBalances, expectedDueProtocolFeeAmounts, joinUserData);
        });

        it('pays swap protocol fees on exit exact BPT in for one token out', async () => {
          const exitUserData = encodeExitWeightedPool({
            kind: 'ExactBPTInForOneTokenOut',
            bptAmountIn: bn(1e18),
            exitTokenIndex: 0,
          });

          await expectExitProtocolSwapFeeEqualWithError(currentBalances, expectedDueProtocolFeeAmounts, exitUserData);
        });

        it('pays swap protocol fees on exit exact BPT in for all tokens out', async () => {
          const exitUserData = encodeExitWeightedPool({ kind: 'ExactBPTInForAllTokensOut', bptAmountIn: bn(1e18) });

          await expectExitProtocolSwapFeeEqualWithError(currentBalances, expectedDueProtocolFeeAmounts, exitUserData);
        });

        it('pays swap protocol fees on exit BPT In for exact tokens out', async () => {
          const exitUserData = encodeExitWeightedPool({
            kind: 'BPTInForExactTokensOut',
            amountsOut: Array(poolTokens.length).fill(bn(1e18)),
            maxBPTAmountIn: MAX_UINT112,
          });

          await expectExitProtocolSwapFeeEqualWithError(currentBalances, expectedDueProtocolFeeAmounts, exitUserData);
        });
      });
    });
  }
});
