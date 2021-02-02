import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, BigNumberish, Contract, ContractFunction } from 'ethers';
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
} from '../../helpers/math/weighted';

import { deploy } from '../../../lib/helpers/deploy';
import { bn, fp, decimal, pct } from '../../../lib/helpers/numbers';
import { MinimalSwapInfoPool, TwoTokenPool } from '../../../lib/helpers/pools';
import { MAX_UINT128, ZERO_ADDRESS } from '../../../lib/helpers/constants';
import { deploySortedTokens, deployTokens, TokenList } from '../../../lib/helpers/tokens';
import { encodeExitWeightedPool, encodeJoinWeightedPool } from '../../../lib/helpers/weightedPoolEncoding';

describe('WeightedPool', function () {
  let authorizer: Contract, tokenList: TokenList, tokens: Array<Contract>;
  let admin: SignerWithAddress, creator: SignerWithAddress, lp: SignerWithAddress;
  let trader: SignerWithAddress, beneficiary: SignerWithAddress, feeSetter: SignerWithAddress, other: SignerWithAddress;

  const POOL_SWAP_FEE = fp(0.01);
  const SYMBOLS = ['DAI', 'MKR', 'SNX', 'BAT'];
  const WEIGHTS = [bn(70e18), bn(30e18), bn(5e18), bn(5e18)];
  const INITIAL_BALANCES = [bn(0.9e18), bn(1.8e18), bn(2.7e18), bn(3.6e18)];

  before('setup signers', async () => {
    [, admin, creator, lp, trader, beneficiary, feeSetter, other] = await ethers.getSigners();
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

        it('reverts if at least one weight is too high', async () => {
          const weights = WEIGHTS.slice(0, numberOfTokens);
          weights[0] = bn(50000).mul(bn(10e18));

          await expect(deployPool({ weights: weights })).to.be.revertedWith('ERR_MAX_WEIGHT');
        });

        it('reverts if at least one weight is too low', async () => {
          const weights = WEIGHTS.slice(0, numberOfTokens);
          weights[0] = bn(10);

          await expect(deployPool({ weights: weights })).to.be.revertedWith('ERR_MIN_WEIGHT');
        });
      });
    });

    describe('onJoinPool', () => {
      beforeEach('deploy pool', async () => {
        ({ vault, pool, poolId } = await deployPool());
      });

      it('fails if caller is not the vault', async () => {
        await expect(
          pool.connect(lp).onJoinPool(poolId, lp.address, other.address, [0], [0], 0, '0x')
        ).to.be.revertedWith('ERR_CALLER_NOT_VAULT');
      });

      it.skip('fails if wrong pool id'); // if Pools can only register themselves, this is unnecessary

      it('fails if no user data', async () => {
        await expect(
          vault.connect(lp).callJoinPool(pool.address, poolId, beneficiary.address, ZEROS, ZEROS, 0, '0x')
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      it('fails if wrong user data', async () => {
        const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);

        await expect(
          vault.connect(lp).callJoinPool(pool.address, poolId, beneficiary.address, ZEROS, ZEROS, 0, wrongUserData)
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
              .callJoinPool(pool.address, poolId, beneficiary.address, ZEROS, poolInitialBalances, 0, joinUserData)
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
          .callJoinPool(pool.address, poolId, lp.address, ZEROS, poolInitialBalances, 0, initialJoinUserData);

        previousBptSupply = await pool.totalSupply();
        previousBptBalance = await pool.balanceOf(lp.address);
      });

      it('fails if caller is not the vault', async () => {
        await expect(
          pool.connect(lp).onExitPool(poolId, beneficiary.address, other.address, [0], [0], 0, '0x')
        ).to.be.revertedWith('ERR_CALLER_NOT_VAULT');
      });

      it.skip('fails if wrong pool id'); // if Pools can only register themselves, this is unnecessary

      it('fails if no user data', async () => {
        await expect(
          vault.connect(lp).callExitPool(pool.address, poolId, beneficiary.address, poolInitialBalances, ZEROS, 0, '0x')
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      it('fails if wrong user data', async () => {
        const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);

        await expect(
          vault
            .connect(lp)
            .callExitPool(pool.address, poolId, beneficiary.address, poolInitialBalances, ZEROS, 0, wrongUserData)
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
            {
              poolId,
              from: other.address,
              to: other.address,
              tokenIn: tokenList.DAI.address,
              tokenOut: tokenList.MKR.address,
              amountOut: AMOUNT_OUT,
              userData: '0x',
            },
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

    // TODO: fix
    describe.skip('protocol swap fees', () => {
      const SWAP_FEE = fp(0.05); // 5 %
      const PROTOCOL_SWAP_FEE = fp(0.1); // 10 %
      const MAX_UINT128S = Array(numberOfTokens).fill(MAX_UINT128);

      beforeEach(async () => {
        await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_SWAP_FEE_ROLE(), feeSetter.address);
        await vault.connect(feeSetter).setProtocolSwapFee(PROTOCOL_SWAP_FEE);

        ({ pool, poolId } = await deployPool({ swapFee: SWAP_FEE }));
        await pool.connect(lp).callJoinPool(bn(1e18), MAX_UINT128S, true, lp.address);
      });

      it('joins and exits do not accumulate fees', async () => {
        await pool.connect(lp).callJoinPool(bn(1e18), MAX_UINT128S, true, lp.address);
        await pool.connect(lp).callJoinPool(bn(4e18), MAX_UINT128S, true, lp.address);

        await pool.connect(lp).callExitPool(bn(0.5e18), ZEROS, true, lp.address);
        await pool.connect(lp).callExitPool(bn(2.5e18), ZEROS, true, lp.address);

        await pool.connect(lp).callJoinPool(bn(7e18), MAX_UINT128S, true, lp.address);

        await pool.connect(lp).callExitPool(bn(5e18), ZEROS, true, lp.address);

        for (const token of poolTokens) {
          const collectedFees = await vault.getCollectedFeesByToken(token);
          expect(collectedFees).to.equal(0);
        }
      });

      context('with swap', () => {
        const AMOUNT_IN = bn(10e18);

        beforeEach('swap given in', async () => {
          const swap = {
            poolId,
            amountIn: AMOUNT_IN,
            tokenInIndex: 0, // send DAI, get MKR
            tokenOutIndex: 1,
            userData: '0x',
          };

          const funds = {
            sender: trader.address,
            recipient: trader.address,
            fromInternalBalance: false,
            toInternalBalance: false,
          };

          await vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', [swap], poolTokens, funds);
        });

        async function assertProtocolSwapFeeIsCharged(payFeesAction: ContractFunction) {
          const previousBlockHash = (await ethers.provider.getBlock('latest')).hash;
          const paidTokenIndex = bn(previousBlockHash).mod(numberOfTokens).toNumber();
          const paidFeeToken = poolTokens[paidTokenIndex];

          const lastInvariant = decimal(await pool.getLastInvariant());
          const currentInvariant = decimal(await pool.getInvariant());
          const ratio = lastInvariant.div(currentInvariant);
          const normalizedWeight = decimal(await pool.getNormalizedWeight(paidFeeToken));
          const exponent = decimal(1e18).div(normalizedWeight);
          const tokenBalances = (await vault.getPoolTokens(poolId)).balances[paidFeeToken];
          const paidTokenBalance = decimal(tokenBalances[0]);
          const collectedSwapFees = decimal(1).sub(ratio.pow(exponent)).mul(paidTokenBalance);
          const protocolSwapFee = decimal(PROTOCOL_SWAP_FEE.toString()).div(1e18);
          const expectedPaidFees = bn(collectedSwapFees.mul(protocolSwapFee));

          await payFeesAction();

          const paidTokenFees = await vault.getCollectedFeesByToken(poolTokens[paidTokenIndex]);
          expectEqualWithError(paidTokenFees, expectedPaidFees, 0.001);

          const nonPaidTokens = poolTokens.filter((token) => token != paidFeeToken);
          for (const token of nonPaidTokens) {
            const notPaidTokenFees = await vault.getCollectedFeesByToken(token);
            expect(notPaidTokenFees).to.equal(0);
          }
        }

        it('pays swap protocol fees if requested', async () => {
          await assertProtocolSwapFeeIsCharged(() => pool.payProtocolFees());
        });

        it('pays swap protocol fees on join', async () => {
          await assertProtocolSwapFeeIsCharged(() =>
            pool.connect(lp).callJoinPool(bn(1e18), MAX_UINT128S, true, lp.address)
          );
        });

        it('pays swap protocol fees on join-swap exact tokens in', async () => {
          await assertProtocolSwapFeeIsCharged(() =>
            pool.connect(lp).joinPoolExactTokensInForBPTOut(0, Array(numberOfTokens).fill(bn(1e18)), true, lp.address)
          );
        });

        it('pays swap protocol fees on join exact BPT out', async () => {
          await assertProtocolSwapFeeIsCharged(() =>
            pool
              .connect(lp)
              .joinPoolTokenInForExactBPTOut(bn(1e18), tokenList.DAI.address, MAX_UINT128, true, lp.address)
          );
        });

        it('pays swap protocol fees on exit', async () => {
          await assertProtocolSwapFeeIsCharged(() => pool.connect(lp).callExitPool(bn(1e18), ZEROS, true, lp.address));
        });

        it('pays swap protocol fees on exit exact BPT in', async () => {
          await assertProtocolSwapFeeIsCharged(() =>
            pool.connect(lp).exitPoolExactBPTInForTokenOut(bn(1e18), tokenList.DAI.address, 0, true, lp.address)
          );
        });

        it('pays swap protocol fees on exit exact tokens out', async () => {
          await assertProtocolSwapFeeIsCharged(() =>
            pool.connect(lp).exitPoolBPTInForExactTokensOut(MAX_UINT128, ZEROS, true, lp.address)
          );
        });
      });
    });
  }
});
