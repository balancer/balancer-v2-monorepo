import Decimal from 'decimal.js';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract, ContractFunction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { expectEqualWithError, bn } from '../../helpers/numbers';
import { deploy } from '../../../scripts/helpers/deploy';
import { toFixedPoint } from '../../../scripts/helpers/fixedPoint';
import { SimplifiedQuotePool, TwoTokenPool } from '../../../scripts/helpers/pools';
import { deploySortedTokens, deployTokens, TokenList } from '../../helpers/tokens';
import { MAX_UINT128, MAX_UINT256, ZERO_ADDRESS } from '../../helpers/constants';
import { expectBalanceChange } from '../../helpers/tokenBalance';
import {
  calculateInvariant,
  calcBptInGivenExactTokensOut,
  calcBptOutGivenExactTokensIn,
  calcTokenInGivenExactBptOut,
  calcTokenOutGivenExactBptIn,
} from '../../helpers/math/weighted';

const INIT = 0;
const EXACT_TOKENS_IN_FOR_BPT_OUT = 1;

const encodeInitialJoinUserData = (): string => {
  return ethers.utils.defaultAbiCoder.encode(['uint256'], [INIT]);
};
const encodeJoinExactTokensInForBPTOutUserData = (minimumBPT: string): string => {
  return ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256'], [EXACT_TOKENS_IN_FOR_BPT_OUT, minimumBPT]);
};

const EXACT_BPT_IN_FOR_ONE_TOKEN_OUT = 0;
const EXACT_BPT_IN_FOR_ALL_TOKENS_OUT = 1;
const BPT_IN_FOR_EXACT_TOKENS_OUT = 2;

const encodeExitExactBPTInForOneTokenOutUserData = (bptAmountIn: string, tokenIndex: number): string => {
  return ethers.utils.defaultAbiCoder.encode(
    ['uint256', 'uint256', 'uint256'],
    [EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, bptAmountIn, tokenIndex]
  );
};

const encodeExitExactBPTInForAllTokensOutUserData = (bptAmountIn: string): string => {
  return ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256'], [EXACT_BPT_IN_FOR_ALL_TOKENS_OUT, bptAmountIn]);
};

const encodeExitBPTInForExactTokensOutUserData = (maxBPTAmountIn: string): string => {
  return ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256'], [BPT_IN_FOR_EXACT_TOKENS_OUT, maxBPTAmountIn]);
};

describe.only('WeightedPool', function () {
  let authorizer: Contract, vault: Contract;
  let tokenList: TokenList, tokens: Array<Contract>;
  let admin: SignerWithAddress, creator: SignerWithAddress, lp: SignerWithAddress;
  let trader: SignerWithAddress, beneficiary: SignerWithAddress, feeSetter: SignerWithAddress, other: SignerWithAddress;

  const POOL_SWAP_FEE = toFixedPoint(0.01);

  const SYMBOLS = ['DAI', 'MKR', 'SNX', 'BAT'];
  const WEIGHTS = [bn(70), bn(30), bn(5), bn(5)];
  const INITIAL_BALANCES = [bn(0.9e18), bn(1.8e18), bn(2.7e18), bn(3.6e18)];

  before('setup signers', async () => {
    [, admin, creator, lp, trader, beneficiary, feeSetter, other] = await ethers.getSigners();
    authorizer = await deploy('Authorizer', { args: [admin.address] });
  });

  beforeEach('deploy tokens', async () => {
    vault = await deploy('Vault', { args: [authorizer.address] });
    tokenList = await deploySortedTokens(SYMBOLS, [18, 18, 18, 18]);
    tokens = Object.values(tokenList);

    for (const token of tokens) {
      await token.mint(creator.address, bn(100e18));
      await token.connect(creator).approve(vault.address, MAX_UINT256);

      await token.mint(lp.address, bn(100e18));
      await token.connect(lp).approve(vault.address, MAX_UINT256);

      await token.mint(trader.address, bn(100e18));
      await token.connect(trader).approve(vault.address, MAX_UINT256);
    }
  });

  context.only('for a 2 token pool', () => {
    itBehavesAsWeightedPool(2);
  });

  context.skip('for a 3 token pool', () => {
    itBehavesAsWeightedPool(3);
  });

  function itBehavesAsWeightedPool(numberOfTokens: number) {
    let poolTokens: string[];

    const poolSymbols = SYMBOLS.slice(0, numberOfTokens);
    const poolWeights = WEIGHTS.slice(0, numberOfTokens);
    const poolInitialBalances = INITIAL_BALANCES.slice(0, numberOfTokens);

    async function deployPool({ tokens, weights, swapFee }: any = {}) {
      return deploy('WeightedPool', {
        args: [
          vault.address,
          'Balancer Pool Token',
          'BPT',
          tokens || poolTokens,
          weights || poolWeights,
          swapFee || POOL_SWAP_FEE,
        ],
      });
    }

    const itOnlySimplifiedQuotePool = (title: string, test: any) => (numberOfTokens == 2 ? it.skip : it)(title, test);

    beforeEach('define pool tokens', () => {
      poolTokens = tokens.map((token) => token.address).slice(0, numberOfTokens);
    });

    describe('creation', async () => {
      context('when the creation succeeds', () => {
        let pool: Contract;

        beforeEach('deploy pool', async () => {
          pool = await deployPool();
        });

        it('creates a pool in the vault', async () => {
          expect(await pool.getVault()).to.equal(vault.address);
        });

        it('uses the corresponding optimization', async () => {
          const poolId = await pool.getPoolId();
          const expectedOptimization = numberOfTokens == 2 ? TwoTokenPool : SimplifiedQuotePool;

          expect(await vault.getPool(poolId)).to.have.members([pool.address, expectedOptimization]);
        });

        it('registers tokens in the vault', async () => {
          const poolId = await pool.getPoolId();

          expect(await vault.getPoolTokens(poolId)).to.have.members(poolTokens);
          expect(await vault.getPoolTokenBalances(poolId, poolTokens)).to.deep.equal(
            Array(poolTokens.length).fill(bn(0))
          );
        });

        it('starts with no BPT', async () => {
          expect(await pool.totalSupply()).to.deep.equal(0);
        });

        it('sets token weights', async () => {
          expect(await pool.getWeights(poolTokens)).to.deep.equal(poolWeights);
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

        it('reverts if there is a single token', async () => {
          const tokens = poolTokens.slice(0, 1);
          const weights = poolWeights.slice(0, 1);
          const balances = poolInitialBalances.slice(0, 1);

          await expect(deployPool({ tokens, balances, weights })).to.be.revertedWith('ERR_MIN_TOKENS');
        });

        it('reverts if there are repeated tokens', async () => {
          const tokens = new Array(poolTokens.length).fill(poolTokens[0]);

          await expect(deployPool({ tokens })).to.be.revertedWith('ERR_TOKEN_ALREADY_REGISTERED');
        });

        it('reverts if there are too many tokens', async () => {
          // The maximum number of tokens is 16
          const manyTokens = await deployTokens(
            Array(17)
              .fill('TK')
              .map((v, i) => `${v}${i}`),
            Array(17).fill(18)
          );

          const tokens = Object.values(manyTokens).map((token) => token.address);
          const balances = new Array(17).fill(100);
          const weights = new Array(17).fill(toFixedPoint(1));

          await expect(deployPool({ tokens, balances, weights })).to.be.revertedWith('ERR_MAX_TOKENS');
        });

        it('reverts if the swap fee is too high', async () => {
          const swapFee = toFixedPoint(0.1).add(1);

          await expect(deployPool({ swapFee })).to.be.revertedWith('ERR_MAX_SWAP_FEE');
        });
      });
    });

    describe('onJoinPool', () => {
      let pool: Contract;
      let poolId: string;

      beforeEach(async () => {
        pool = await deployPool();
        poolId = await pool.getPoolId();
      });

      it('fails if caller is not the vault', async () => {
        await expect(
          pool.connect(lp).onJoinPool(poolId, lp.address, other.address, [0], [0], 0, '0x')
        ).to.be.revertedWith('ERR_CALLER_NOT_VAULT');
      });

      it.skip('fails if wrong pool id'); // if Pools can only register themselves, this is unnecessary

      it('fails if no user data', async () => {
        await expect(
          vault
            .connect(lp)
            .joinPool(poolId, beneficiary.address, poolTokens, Array(poolTokens.length).fill(0), false, '0x')
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      it('fails if wrong user data', async () => {
        const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);

        await expect(
          vault
            .connect(lp)
            .joinPool(poolId, beneficiary.address, poolTokens, Array(poolTokens.length).fill(0), false, wrongUserData)
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      context('intialization', () => {
        let initialJoinUserData: string;

        beforeEach(async () => {
          initialJoinUserData = encodeInitialJoinUserData();
        });

        it('grants the invariant amount of BPT', async () => {
          const invariant = bn(
            calculateInvariant(
              poolInitialBalances.map((value) => value.toString()),
              poolWeights.map((value) => value.toString())
            ).toFixed(0)
          );

          await vault
            .connect(creator)
            .joinPool(poolId, beneficiary.address, poolTokens, poolInitialBalances, false, initialJoinUserData);

          // Balances should be the same as initial ones
          expect(await vault.getPoolTokenBalances(poolId, poolTokens)).to.deep.equal(poolInitialBalances);

          // Initial balances should equal invariant
          const bpt = await pool.balanceOf(beneficiary.address);
          expectEqualWithError(bpt, invariant, 0.001);
        });

        it('fails if already intialized', async () => {
          await vault
            .connect(creator)
            .joinPool(poolId, beneficiary.address, poolTokens, poolInitialBalances, false, initialJoinUserData);

          await expect(
            vault
              .connect(creator)
              .joinPool(poolId, beneficiary.address, poolTokens, poolInitialBalances, false, initialJoinUserData)
          ).to.be.be.revertedWith('ERR_ALREADY_INITIALIZED');
        });
      });

      context('join exact tokens in for BPT out', () => {
        it('fails if not intialized', async () => {
          const joinUserData = encodeJoinExactTokensInForBPTOutUserData('0');
          await expect(
            vault
              .connect(creator)
              .joinPool(poolId, beneficiary.address, poolTokens, Array(poolTokens.length).fill(0), false, joinUserData)
          ).to.be.be.revertedWith('ERR_UNINITIALIZED');
        });

        context('once initialized', () => {
          beforeEach(async () => {
            const initialBalances = [bn(0.9e18), bn(1.8e18)];
            const initialJoinUserData = encodeInitialJoinUserData();
            await vault
              .connect(creator)
              .joinPool(poolId, beneficiary.address, poolTokens, initialBalances, false, initialJoinUserData);
          });

          it('grants BPT for exact tokens', async () => {
            const prevBalances = await vault.getPoolTokenBalances(poolId, poolTokens);
            const previousBPT = await pool.balanceOf(lp.address);

            const minimumBPT = (0.01e18).toString();
            const joinUserData = encodeJoinExactTokensInForBPTOutUserData(minimumBPT);
            const maxAmountsIn = [bn(0), bn(0.1e18)];

            await vault
              .connect(lp)
              .joinPool(poolId, beneficiary.address, poolTokens, maxAmountsIn, false, joinUserData);

            const newBalances = await vault.getPoolTokenBalances(poolId, poolTokens);
            expect(newBalances[1].sub(prevBalances[1])).to.equal(bn(0.1e18));

            const newBPT = await pool.balanceOf(beneficiary.address);
            expectEqualWithError(newBPT.sub(previousBPT), 0.0179e18, 0.01);
          });

          it('fails if not enough BPT', async () => {
            const minimumBPT = (1e18).toString();
            const joinUserData = encodeJoinExactTokensInForBPTOutUserData(minimumBPT);
            const inBalances = [bn(0), bn(0.1e18)];

            await expect(
              vault.connect(lp).joinPool(poolId, beneficiary.address, poolTokens, inBalances, false, joinUserData)
            ).to.be.be.revertedWith('ERR_BPT_OUT_MIN_AMOUNT');
          });
        });
      });
    });

    describe('onExitPool', () => {
      let pool: Contract;
      let poolId: string;

      let poolTokens: string[];

      beforeEach(async () => {
        poolTokens = [tokenList.DAI.address, tokenList.MKR.address];

        pool = await deployPool();

        poolId = await pool.getPoolId();

        // Initialize from creator

        const initialBalances = [bn(0.9e18), bn(1.8e18)];
        const initialJoinUserData = encodeInitialJoinUserData();
        await vault
          .connect(creator)
          .joinPool(poolId, beneficiary.address, poolTokens, initialBalances, false, initialJoinUserData);

        // Join from lp

        const minimumBPT = (0.01e18).toString();
        const joinUserData = encodeJoinExactTokensInForBPTOutUserData(minimumBPT);
        const inBalances = [bn(0), bn(0.1e18)];
        await vault.connect(lp).joinPool(poolId, beneficiary.address, poolTokens, inBalances, false, joinUserData);
      });

      it('fails if caller is not the vault', async () => {
        await expect(
          pool.connect(lp).onExitPool(poolId, beneficiary.address, other.address, [0], [0], 0, '0x')
        ).to.be.revertedWith('ERR_CALLER_NOT_VAULT');
      });

      it.skip('fails if wrong pool id'); // if Pools can only register themselves, this is unnecessary

      it('fails if no user data', async () => {
        await expect(
          vault
            .connect(lp)
            .exitPool(poolId, beneficiary.address, poolTokens, Array(poolTokens.length).fill(0), false, '0x')
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      it('fails if wrong user data', async () => {
        const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);

        await expect(
          vault
            .connect(lp)
            .exitPool(poolId, beneficiary.address, poolTokens, Array(poolTokens.length).fill(0), false, wrongUserData)
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      context('exit exact BPT in for one token out', () => {
        it('grants one token for exact bpt', async () => {
          const prevBalances = await vault.getPoolTokenBalances(poolId, poolTokens);

          const exitTokenIndex = 0;

          // Fully exit
          const prevBPT = await pool.balanceOf(beneficiary.address);
          const exitUserData = encodeExitExactBPTInForOneTokenOutUserData(prevBPT, exitTokenIndex);

          const minAmountsOut = [bn(0.01e18), bn(0)];
          await vault.connect(lp).exitPool(poolId, beneficiary.address, poolTokens, minAmountsOut, false, exitUserData);

          const newBalances = await vault.getPoolTokenBalances(poolId, poolTokens);

          for (let i = 0; i < poolTokens.length; ++i) {
            const delta = prevBalances[i].sub(newBalances[i]);

            if (i == exitTokenIndex) {
              expectEqualWithError(delta, bn(0.0204e18), 0.001);
            } else {
              expect(delta).to.equal(0);
            }
          }

          expect(await pool.balanceOf(lp.address)).to.equal((0).toString());
        });
      });

      context('exit exact BPT in for all tokens out', () => {
        it('grants all tokens for exact bpt', async () => {
          const prevBalances = await vault.getPoolTokenBalances(poolId, poolTokens);

          // Fully exit
          const prevBPT = await pool.balanceOf(lp.address);
          const exitUserData = encodeExitExactBPTInForAllTokensOutUserData(prevBPT);
          const minAmountsOut = [bn(0.01e18), bn(0.01e18)];

          await vault.connect(lp).exitPool(poolId, beneficiary.address, poolTokens, minAmountsOut, false, exitUserData);

          const newBalances = await vault.getPoolTokenBalances(poolId, poolTokens);

          expectEqualWithError(prevBalances[0].sub(newBalances[0]), 0.0145e18, 0.01);
          expectEqualWithError(prevBalances[1].sub(newBalances[1]), 0.03e18, 0.1);

          expect(await pool.balanceOf(lp.address)).to.equal(0);
        });
      });

      context('exit BPT in for exact tokens out', () => {
        it('grants exact tokens for bpt', async () => {
          const prevBalances = await vault.getPoolTokenBalances(poolId, poolTokens);

          const maxBPTAmountIn = await pool.balanceOf(lp.address);
          const exitUserData = encodeExitBPTInForExactTokensOutUserData(maxBPTAmountIn);

          const minAmountsOut = [bn(0.014e18), bn(0.03e18)];
          await vault.connect(lp).exitPool(poolId, beneficiary.address, poolTokens, minAmountsOut, false, exitUserData);

          const newBalances = await vault.getPoolTokenBalances(poolId, poolTokens);
          expect(prevBalances[0].sub(newBalances[0])).to.equal(bn(0.014e18));
          expect(prevBalances[1].sub(newBalances[1])).to.equal(bn(0.03e18));

          expect(await pool.balanceOf(lp.address)).to.be.at.most(bn(0.001e18));
        });

        it('fails if more BTP needed', async () => {
          const maxBPTAmountIn = await pool.balanceOf(lp.address);

          const exitUserData = encodeExitBPTInForExactTokensOutUserData(maxBPTAmountIn);
          const amountsOut = [bn(0.02e18), bn(0.04e18)];

          await expect(
            vault.connect(lp).exitPool(poolId, beneficiary.address, poolTokens, amountsOut, false, exitUserData)
          ).to.be.be.revertedWith('ERR_BPT_IN_MAX_AMOUNT');
        });
      });
    });

    describe('quotes', () => {
      let pool: Contract;
      let poolId: string;

      let quoteData: any;

      beforeEach('set default quote data', async () => {
        pool = await deployPool();
        poolId = await pool.getPoolId();

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

          expect(result).to.be.at.least(bn(1.349e18));
          expect(result).to.be.at.most(bn(1.35e18));
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

          expect(result).to.be.at.least(bn(0.9e18));
          expect(result).to.be.at.most(bn(0.91e18));
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
      const SWAP_FEE = toFixedPoint(0.05); // 5 %
      const PROTOCOL_SWAP_FEE = toFixedPoint(0.1); // 10 %

      const ZEROS = Array(numberOfTokens).fill(0);
      const MAX_UINT128S = Array(numberOfTokens).fill(MAX_UINT128);

      let pool: Contract;
      let poolId: string;

      beforeEach(async () => {
        await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_SWAP_FEE_ROLE(), feeSetter.address);
        await vault.connect(feeSetter).setProtocolSwapFee(PROTOCOL_SWAP_FEE);

        pool = await deployPool({ swapFee: SWAP_FEE });
        poolId = await pool.getPoolId();
        await pool.connect(lp).joinPool((1e18).toString(), MAX_UINT128S, true, lp.address);
      });

      it('joins and exits do not accumulate fees', async () => {
        await pool.connect(lp).joinPool(bn(1e18), MAX_UINT128S, true, lp.address);
        await pool.connect(lp).joinPool(bn(4e18), MAX_UINT128S, true, lp.address);

        await pool.connect(lp).exitPool(bn(0.5e18), ZEROS, true, lp.address);
        await pool.connect(lp).exitPool(bn(2.5e18), ZEROS, true, lp.address);

        await pool.connect(lp).joinPool(bn(7e18), MAX_UINT128S, true, lp.address);

        await pool.connect(lp).exitPool(bn(5e18), ZEROS, true, lp.address);

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
            withdrawFromInternalBalance: false,
            depositToInternalBalance: false,
          };

          await vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', [swap], poolTokens, funds);
        });

        async function assertProtocolSwapFeeIsCharged(payFeesAction: ContractFunction) {
          const previousBlockHash = (await ethers.provider.getBlock('latest')).hash;
          const paidTokenIndex = bn(previousBlockHash).mod(numberOfTokens).toNumber();
          const paidFeeToken = poolTokens[paidTokenIndex];

          const lastInvariant = new Decimal((await pool.getLastInvariant()).toString());
          const currentInvariant = new Decimal((await pool.getInvariant()).toString());
          const ratio = lastInvariant.div(currentInvariant);
          const normalizedWeight = new Decimal((await pool.getNormalizedWeight(paidFeeToken)).toString());
          const exponent = new Decimal(1e18).div(normalizedWeight);
          const tokenBalances = await vault.getPoolTokenBalances(poolId, [paidFeeToken]);
          const paidTokenBalance = new Decimal(tokenBalances[0].toString());
          const collectedSwapFees = new Decimal(1).minus(ratio.pow(exponent)).times(paidTokenBalance);
          const protocolSwapFee = new Decimal(PROTOCOL_SWAP_FEE.toString()).div(1e18);
          const expectedPaidFees = bn(parseInt(collectedSwapFees.times(protocolSwapFee).toString()));

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
            pool.connect(lp).joinPool((1e18).toString(), MAX_UINT128S, true, lp.address)
          );
        });

        it('pays swap protocol fees on join-swap exact tokens in', async () => {
          await assertProtocolSwapFeeIsCharged(() =>
            pool.connect(lp).joinPoolExactTokensInForBPTOut(0, Array(numberOfTokens).fill(bn(1e18)), true, lp.address)
          );
        });

        itOnlySimplifiedQuotePool('pays swap protocol fees on join exact BPT out', async () => {
          await assertProtocolSwapFeeIsCharged(() =>
            pool
              .connect(lp)
              .joinPoolTokenInForExactBPTOut((1e18).toString(), tokenList.DAI.address, MAX_UINT128, true, lp.address)
          );
        });

        it('pays swap protocol fees on exit', async () => {
          await assertProtocolSwapFeeIsCharged(() =>
            pool.connect(lp).exitPool((1e18).toString(), ZEROS, true, lp.address)
          );
        });

        itOnlySimplifiedQuotePool('pays swap protocol fees on exit exact BPT in', async () => {
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
