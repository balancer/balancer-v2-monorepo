import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, BigNumberish, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '../../helpers/expectEvent';
import { expectEqualWithError } from '../../helpers/relativeError';
import {
  calcBptOutGivenExactTokensIn,
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

describe('WeightedPool', function () {
  let authorizer: Contract, tokenList: TokenList, tokens: Array<Contract>;
  let admin: SignerWithAddress, creator: SignerWithAddress, lp: SignerWithAddress;
  let trader: SignerWithAddress, beneficiary: SignerWithAddress, other: SignerWithAddress;

  const POOL_SWAP_FEE = fp(0.01);
  const SYMBOLS = ['DAI', 'MKR', 'SNX', 'BAT'];
  const WEIGHTS = [bn(70), bn(30), bn(5), bn(5)];
  const INITIAL_BALANCES = [bn(0.9e18), bn(1.8e18), bn(2.7e18), bn(3.6e18)];

  before('setup signers', async () => {
    [, admin, creator, lp, trader, beneficiary, other] = await ethers.getSigners();
    authorizer = await deploy('Authorizer', { args: [admin.address] });
  });

  beforeEach('deploy tokens', async () => {
    tokenList = await deploySortedTokens(SYMBOLS, [18, 18, 18, 18]);
    tokens = Object.values(tokenList);

    for (const token of tokens) {
      await token.mint(creator.address, bn(100e18));
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
      await expect(deploy('WeightedPool', { args })).to.be.revertedWith('ERR_MIN_TOKENS');
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
      await expect(deploy('WeightedPool', { args })).to.be.revertedWith('ERR_MAX_TOKENS');
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

      let pool, vault;

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

      const poolId = await pool.getPoolId();
      return { pool, vault, poolId };
    }

    beforeEach('define pool tokens', () => {
      poolTokens = tokens.map((token) => token.address).slice(0, numberOfTokens);
    });

    describe('creation', () => {
      context('when the creation succeeds', () => {
        beforeEach('deploy pool from factory', async () => {
          ({ pool, poolId, vault } = await deployPool({ fromFactory: true }));
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

          await expect(deployPool({ weights })).to.be.revertedWith('ERR_TOKENS_WEIGHTS_LENGTH');
        });

        it('reverts if there are repeated tokens', async () => {
          const tokens = new Array(poolTokens.length).fill(poolTokens[0]);

          await expect(deployPool({ tokens, fromFactory: true })).to.be.revertedWith('Create2: Failed on deploy');
        });

        it('reverts if the swap fee is too high', async () => {
          const swapFee = fp(0.1).add(1);

          await expect(deployPool({ swapFee })).to.be.revertedWith('ERR_MAX_SWAP_FEE');
        });
      });
    });

    describe('onJoinPool', () => {
      beforeEach('deploy pool', async () => {
        ({ vault, pool, poolId } = await deployPool());
      });

      it('fails if caller is not the vault', async () => {
        await expect(
          pool.connect(lp).onJoinPool(poolId, lp.address, other.address, [0], [0], 0, 0, '0x')
        ).to.be.revertedWith('ERR_CALLER_NOT_VAULT');
      });

      it.skip('fails if wrong pool id'); // if Pools can only register themselves, this is unnecessary

      it('fails if no user data', async () => {
        await expect(
          vault.connect(lp).callJoinPool(pool.address, poolId, beneficiary.address, ZEROS, ZEROS, 0, 0, '0x')
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      it('fails if wrong user data', async () => {
        const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);

        await expect(
          vault.connect(lp).callJoinPool(pool.address, poolId, beneficiary.address, ZEROS, ZEROS, 0, 0, wrongUserData)
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      context('initialization', () => {
        let initialJoinUserData: string;

        beforeEach(async () => {
          initialJoinUserData = encodeJoinWeightedPool({ kind: 'Init' });
        });

        it('grants the invariant amount of BPT', async () => {
          const invariant = calculateInvariant(poolInitialBalances, poolWeights);

          const receipt = await (
            await vault
              .connect(creator)
              .callJoinPool(
                pool.address,
                poolId,
                beneficiary.address,
                ZEROS,
                poolInitialBalances,
                0,
                0,
                initialJoinUserData
              )
          ).wait();

          const { amountsIn, dueProtocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolJoined').args;

          // Amounts in should be the same as initial ones
          expect(amountsIn).to.deep.equal(poolInitialBalances);

          // TODO: fix - Protocol fees should be zero
          // expect(dueProtocolFeeAmounts).to.deep.equal(ZEROS);

          // Initial balances should equal invariant
          const currentBptBalance = await pool.balanceOf(beneficiary.address);
          expectEqualWithError(currentBptBalance, invariant, 0.001);
        });

        it('fails if already initialized', async () => {
          await vault
            .connect(creator)
            .callJoinPool(
              pool.address,
              poolId,
              beneficiary.address,
              ZEROS,
              poolInitialBalances,
              0,
              0,
              initialJoinUserData
            );

          await expect(
            vault
              .connect(creator)
              .callJoinPool(
                pool.address,
                poolId,
                beneficiary.address,
                ZEROS,
                poolInitialBalances,
                0,
                0,
                initialJoinUserData
              )
          ).to.be.be.revertedWith('ERR_ALREADY_INITIALIZED');
        });
      });

      context('join exact tokens in for BPT out', () => {
        it('fails if not initialized', async () => {
          const joinUserData = encodeJoinWeightedPool({ kind: 'ExactTokensInForBPTOut', minimumBPT: 0 });
          await expect(
            vault
              .connect(creator)
              .callJoinPool(pool.address, poolId, beneficiary.address, ZEROS, poolInitialBalances, 0, 0, joinUserData)
          ).to.be.be.revertedWith('ERR_UNINITIALIZED');
        });

        context('once initialized', () => {
          let maxAmountsIn: BigNumber[], previousBptSupply: BigNumber, expectedBptAmount: BigNumber;

          beforeEach('initialize pool', async () => {
            const initialJoinUserData = encodeJoinWeightedPool({ kind: 'Init' });
            await vault
              .connect(creator)
              .callJoinPool(
                pool.address,
                poolId,
                beneficiary.address,
                ZEROS,
                poolInitialBalances,
                0,
                0,
                initialJoinUserData
              );
          });

          beforeEach('compute expected BPT balances', async () => {
            previousBptSupply = await pool.totalSupply();

            maxAmountsIn = ZEROS;
            maxAmountsIn[1] = bn(0.1e18);

            expectedBptAmount = await calcBptOutGivenExactTokensIn(
              poolInitialBalances,
              poolWeights,
              maxAmountsIn,
              previousBptSupply,
              POOL_SWAP_FEE
            );
          });

          it('grants BPT for exact tokens', async () => {
            const previousBptBalance = await pool.balanceOf(beneficiary.address);

            const minimumBPT = pct(expectedBptAmount, 0.99);
            const joinUserData = encodeJoinWeightedPool({ kind: 'ExactTokensInForBPTOut', minimumBPT });

            const receipt = await (
              await vault
                .connect(lp)
                .callJoinPool(
                  pool.address,
                  poolId,
                  beneficiary.address,
                  poolInitialBalances,
                  maxAmountsIn,
                  0,
                  0,
                  joinUserData
                )
            ).wait();

            const { amountsIn, dueProtocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolJoined').args;

            // Amounts in should be the same as initial ones
            expect(amountsIn).to.deep.equal(maxAmountsIn);

            // TODO: fix - Protocol fees should be zero
            // expect(dueProtocolFeeAmounts).to.deep.equal(ZEROS);

            // Make sure received BPT is closed to what we expect
            const currentBptBalance = await pool.balanceOf(beneficiary.address);
            expectEqualWithError(currentBptBalance.sub(previousBptBalance), expectedBptAmount, 0.0001);
          });

          it('fails if not enough BPT', async () => {
            // This call should fail cause we are requesting minimum 1% more
            const minimumBPT = pct(expectedBptAmount, 1.01);
            const joinUserData = encodeJoinWeightedPool({ kind: 'ExactTokensInForBPTOut', minimumBPT });

            await expect(
              vault
                .connect(lp)
                .callJoinPool(
                  pool.address,
                  poolId,
                  beneficiary.address,
                  poolInitialBalances,
                  maxAmountsIn,
                  0,
                  0,
                  joinUserData
                )
            ).to.be.be.revertedWith('ERR_BPT_OUT_MIN_AMOUNT');
          });
        });
      });
    });

    describe('onExitPool', () => {
      let previousBptBalance: BigNumber, previousBptSupply: BigNumber;

      beforeEach('deploy and initialize pool', async () => {
        ({ vault, pool, poolId } = await deployPool());

        // Initialize from creator
        const initialJoinUserData = encodeJoinWeightedPool({ kind: 'Init' });
        await vault
          .connect(creator)
          .callJoinPool(pool.address, poolId, lp.address, ZEROS, poolInitialBalances, 0, 0, initialJoinUserData);

        previousBptSupply = await pool.totalSupply();
        previousBptBalance = await pool.balanceOf(lp.address);
      });

      it('fails if caller is not the vault', async () => {
        await expect(
          pool.connect(lp).onExitPool(poolId, beneficiary.address, other.address, [0], [0], 0, 0, '0x')
        ).to.be.revertedWith('ERR_CALLER_NOT_VAULT');
      });

      it.skip('fails if wrong pool id'); // if Pools can only register themselves, this is unnecessary

      it('fails if no user data', async () => {
        await expect(
          vault
            .connect(lp)
            .callExitPool(pool.address, poolId, beneficiary.address, poolInitialBalances, ZEROS, 0, 0, '0x')
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      it('fails if wrong user data', async () => {
        const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);

        await expect(
          vault
            .connect(lp)
            .callExitPool(pool.address, poolId, beneficiary.address, poolInitialBalances, ZEROS, 0, 0, wrongUserData)
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

          const minAmountsOut = ZEROS;
          minAmountsOut[exitTokenIndex] = pct(expectedTokenOut, 1.01);

          const exitUserData = encodeExitWeightedPool({
            kind: 'ExactBPTInForOneTokenOut',
            bptAmountIn: exactBptIn,
            exitTokenIndex,
          });

          const receipt = await (
            await vault
              .connect(lp)
              .callExitPool(
                pool.address,
                poolId,
                beneficiary.address,
                poolInitialBalances,
                minAmountsOut,
                0,
                0,
                exitUserData
              )
          ).wait();

          const { amountsOut, dueProtocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolExited').args;

          // TODO: fix - Protocol fees should be zero
          // expect(dueProtocolFeeAmounts).to.deep.equal(ZEROS);

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
          const minAmountsOut = poolInitialBalances.map((balance) => pct(balance.div(2), 0.99));

          const receipt = await (
            await vault
              .connect(lp)
              .callExitPool(
                pool.address,
                poolId,
                beneficiary.address,
                poolInitialBalances,
                minAmountsOut,
                0,
                0,
                exitUserData
              )
          ).wait();

          const { amountsOut, dueProtocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolExited').args;

          // TODO: fix - Protocol fees should be zero
          // expect(dueProtocolFeeAmounts).to.deep.equal(ZEROS);

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
          const minAmountsOut = poolInitialBalances.map((balance) => pct(balance, 0.99));

          const receipt = await (
            await vault
              .connect(lp)
              .callExitPool(
                pool.address,
                poolId,
                beneficiary.address,
                poolInitialBalances,
                minAmountsOut,
                0,
                0,
                exitUserData
              )
          ).wait();

          const { amountsOut, dueProtocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolExited').args;

          // TODO: fix - Protocol fees should be zero
          // expect(dueProtocolFeeAmounts).to.deep.equal(ZEROS);

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
          const exitUserData = encodeExitWeightedPool({ kind: 'BPTInForExactTokensOut', maxBPTAmountIn: maxBptIn });

          const receipt = await (
            await vault
              .connect(lp)
              .callExitPool(
                pool.address,
                poolId,
                beneficiary.address,
                poolInitialBalances,
                exactTokensOut,
                0,
                0,
                exitUserData
              )
          ).wait();

          const { amountsOut, dueProtocolFeeAmounts } = expectEvent.inReceipt(receipt, 'PoolExited').args;

          // TODO: fix - Protocol fees should be zero
          // expect(dueProtocolFeeAmounts).to.deep.equal(ZEROS);

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
          const exitUserData = encodeExitWeightedPool({ kind: 'BPTInForExactTokensOut', maxBPTAmountIn: maxBptIn });

          await expect(
            vault
              .connect(lp)
              .callExitPool(
                pool.address,
                poolId,
                beneficiary.address,
                poolInitialBalances,
                exactTokensOut,
                0,
                0,
                exitUserData
              )
          ).to.be.be.revertedWith('ERR_BPT_IN_MAX_AMOUNT');
        });
      });
    });

    describe('quotes', () => {
      let quoteData: {
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

      beforeEach('set default quote data', async () => {
        ({ pool, poolId } = await deployPool());

        quoteData = {
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
        it('quotes amount out', async () => {
          // swap the same amount as the initial balance for token #0
          const AMOUNT_IN = bn(0.9e18);
          const AMOUNT_IN_WITH_FEES = AMOUNT_IN.mul(POOL_SWAP_FEE.add(bn(1e18))).div(bn(1e18));

          const result = await pool.quoteOutGivenIn(
            { ...quoteData, amountIn: AMOUNT_IN_WITH_FEES },
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
          const quote = pool.quoteOutGivenIn(
            { ...quoteData, tokenIn: tokenList.BAT.address, amountIn: 100 },
            poolInitialBalances[0], // tokenInBalance
            poolInitialBalances[1] // tokenOutBalance
          );

          await expect(quote).to.be.revertedWith('ERR_INVALID_TOKEN');
        });

        it('reverts if token out is not in the pool', async () => {
          const quote = pool.quoteOutGivenIn(
            { ...quoteData, tokenOut: tokenList.BAT.address, amountIn: 100 },
            poolInitialBalances[0], // tokenInBalance
            poolInitialBalances[1] // tokenOutBalance
          );

          await expect(quote).to.be.revertedWith('ERR_INVALID_TOKEN');
        });
      });

      context('given out', () => {
        it('quotes amount in', async () => {
          const AMOUNT_OUT = bn(1.35e18);

          const result = await pool.quoteInGivenOut(
            { ...quoteData, amountOut: AMOUNT_OUT },
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
          const quote = pool.quoteInGivenOut(
            { ...quoteData, tokenIn: tokenList.BAT.address, amountOut: 100 },
            poolInitialBalances[0], // tokenInBalance
            poolInitialBalances[1] // tokenOutBalance
          );

          await expect(quote).to.be.revertedWith('ERR_INVALID_TOKEN');
        });

        it('reverts if token out is not in the pool', async () => {
          const quote = pool.quoteInGivenOut(
            { ...quoteData, tokenOut: tokenList.BAT.address, amountOut: 100 },
            poolInitialBalances[0], // tokenInBalance
            poolInitialBalances[1] // tokenOutBalance
          );

          await expect(quote).to.be.revertedWith('ERR_INVALID_TOKEN');
        });
      });
    });

    describe('protocol swap fees', () => {
      let pool: Contract;
      let poolId: string;

      const protocolSwapFee = fp(0.1); // 10 %

      beforeEach(async () => {
        //Use a mock vault
        ({ vault, pool, poolId } = await deployPool());

        // Initialize from creator
        const initialJoinUserData = encodeJoinWeightedPool({ kind: 'Init' });
        await vault
          .connect(creator)
          .callJoinPool(
            pool.address,
            poolId,
            lp.address,
            ZEROS,
            poolInitialBalances,
            protocolSwapFee,
            0,
            initialJoinUserData
          );
      });

      const expectJoinProtocolSwapFeeEqualWithError = async (
        initialBalances: BigNumber[],
        maxAmounts: BigNumber[],
        expectedDueProtocolFeeAmounts: BigNumber[],
        joinUserData: string
      ): Promise<BigNumber[]> => {
        const receipt = await (
          await vault
            .connect(lp)
            .callJoinPool(
              pool.address,
              poolId,
              lp.address,
              initialBalances,
              maxAmounts,
              protocolSwapFee,
              0,
              joinUserData
            )
        ).wait();
        const event = expectEvent.inReceipt(receipt, 'PoolJoined');
        const amountsIn = event.args.amountsIn;
        const dueProtocolFeeAmounts = event.args.dueProtocolFeeAmounts;

        for (let index = 0; index < dueProtocolFeeAmounts.length; index++) {
          expectEqualWithError(dueProtocolFeeAmounts[index], expectedDueProtocolFeeAmounts[index], 0.1);
        }

        return initialBalances.map((balance: BigNumber, index: number) => balance.add(amountsIn[index]));
      };

      const expectExitProtocolSwapFeeEqualWithError = async (
        initialBalances: BigNumber[],
        minAmounts: BigNumber[],
        expectedDueProtocolFeeAmounts: BigNumber[],
        exitUserData: string
      ): Promise<BigNumber[]> => {
        const receipt = await (
          await vault
            .connect(lp)
            .callExitPool(
              pool.address,
              poolId,
              lp.address,
              initialBalances,
              minAmounts,
              protocolSwapFee,
              0,
              exitUserData
            )
        ).wait();
        const event = expectEvent.inReceipt(receipt, 'PoolExited');
        const amountsOut = event.args.amountsOut;
        const dueProtocolFeeAmounts = event.args.dueProtocolFeeAmounts;

        for (let index = 0; index < dueProtocolFeeAmounts.length; index++) {
          expectEqualWithError(dueProtocolFeeAmounts[index], expectedDueProtocolFeeAmounts[index], 0.1);
        }

        return initialBalances.map((balance: BigNumber, index: number) => balance.sub(amountsOut[index]));
      };

      it('joins and exits do not accumulate fees', async () => {
        let joinUserData = encodeJoinWeightedPool({ kind: 'ExactTokensInForBPTOut', minimumBPT: 0 });
        let newBalances = await expectJoinProtocolSwapFeeEqualWithError(
          poolInitialBalances,
          Array(poolTokens.length).fill(bn(100e18)),
          Array(poolTokens.length).fill(bn(0)),
          joinUserData
        );

        joinUserData = encodeJoinWeightedPool({ kind: 'ExactTokensInForBPTOut', minimumBPT: 0 });

        newBalances = await expectJoinProtocolSwapFeeEqualWithError(
          newBalances,
          Array(poolTokens.length).fill(bn(100e18)),
          Array(poolTokens.length).fill(bn(0)),
          joinUserData
        );

        let exitUserData = encodeExitWeightedPool({
          kind: 'ExactBPTInForOneTokenOut',
          bptAmountIn: bn((10e18).toString()),
          exitTokenIndex: 0,
        });

        newBalances = await expectExitProtocolSwapFeeEqualWithError(
          newBalances,
          Array(poolTokens.length).fill(bn(0)),
          Array(poolTokens.length).fill(bn(0)),
          exitUserData
        );

        exitUserData = encodeExitWeightedPool({
          kind: 'ExactBPTInForAllTokensOut',
          bptAmountIn: bn((10e18).toString()),
        });

        newBalances = await expectExitProtocolSwapFeeEqualWithError(
          newBalances,
          Array(poolTokens.length).fill(bn(0)),
          Array(poolTokens.length).fill(bn(0)),
          exitUserData
        );

        joinUserData = encodeJoinWeightedPool({ kind: 'ExactTokensInForBPTOut', minimumBPT: 0 });
        newBalances = await expectJoinProtocolSwapFeeEqualWithError(
          newBalances,
          Array(poolTokens.length).fill(bn(10e18)),
          Array(poolTokens.length).fill(bn(0)),
          joinUserData
        );

        exitUserData = encodeExitWeightedPool({ kind: 'BPTInForExactTokensOut', maxBPTAmountIn: MAX_UINT112 });
        await expectExitProtocolSwapFeeEqualWithError(
          newBalances,
          Array(poolTokens.length).fill(bn(10e18)),
          Array(poolTokens.length).fill(bn(0)),
          exitUserData
        );
      });

      context('with swap', () => {
        let currentBalances: BigNumber[];
        let expectedDueProtocolFeeAmounts: BigNumber[];

        beforeEach(async () => {
          const previousBlockHash = (await ethers.provider.getBlock('latest')).hash;
          const paidTokenIndex = decimal(previousBlockHash).mod(numberOfTokens).toNumber();

          const lastInvariant = calculateInvariant(poolInitialBalances, poolWeights);
          currentBalances = poolInitialBalances.map((balance) => balance.mul(2)); //twice the initial balances

          const feeAmount = calculateOneTokenSwapFee(currentBalances, poolWeights, lastInvariant, paidTokenIndex);

          const protocolFeeAmount = bn(feeAmount.toString()).mul(protocolSwapFee).div((1e18).toString());

          expectedDueProtocolFeeAmounts = Array(poolTokens.length).fill(bn(0));
          expectedDueProtocolFeeAmounts[paidTokenIndex] = protocolFeeAmount;
        });

        it('pays swap protocol fees on join exact tokens in for BPT out', async () => {
          const joinUserData = encodeJoinWeightedPool({ kind: 'ExactTokensInForBPTOut', minimumBPT: 0 });
          await expectJoinProtocolSwapFeeEqualWithError(
            currentBalances,
            Array(poolTokens.length).fill(bn(1e18)),
            expectedDueProtocolFeeAmounts,
            joinUserData
          );
        });

        it('pays swap protocol fees on exit exact BPT in for one token out', async () => {
          const exitUserData = encodeExitWeightedPool({
            kind: 'ExactBPTInForOneTokenOut',
            bptAmountIn: bn((1e18).toString()),
            exitTokenIndex: 0,
          });
          await expectExitProtocolSwapFeeEqualWithError(
            currentBalances,
            Array(poolTokens.length).fill(bn(0)),
            expectedDueProtocolFeeAmounts,
            exitUserData
          );
        });

        it('pays swap protocol fees on exit exact BPT in for all tokens out', async () => {
          const exitUserData = encodeExitWeightedPool({
            kind: 'ExactBPTInForAllTokensOut',
            bptAmountIn: bn((1e18).toString()),
          });
          await expectExitProtocolSwapFeeEqualWithError(
            currentBalances,
            Array(poolTokens.length).fill(bn(0)),
            expectedDueProtocolFeeAmounts,
            exitUserData
          );
        });

        it('pays swap protocol fees on exit BPT In for exact tokens out', async () => {
          const exitUserData = encodeExitWeightedPool({ kind: 'BPTInForExactTokensOut', maxBPTAmountIn: MAX_UINT112 });
          await expectExitProtocolSwapFeeEqualWithError(
            currentBalances,
            Array(poolTokens.length).fill(bn(1e18)),
            expectedDueProtocolFeeAmounts,
            exitUserData
          );
        });
      });
    });
  }
});
