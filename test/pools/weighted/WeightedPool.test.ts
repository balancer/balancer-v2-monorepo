import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, BigNumberish, Contract, ContractFunction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '../../helpers/expectEvent';
import { calculateInvariant } from '../../helpers/math/weighted';
import { expectEqualWithError } from '../../helpers/relativeError';

import { deploy } from '../../../lib/helpers/deploy';
import { bn, fp, decimal } from '../../../lib/helpers/numbers';
import { MinimalSwapInfoPool, TwoTokenPool } from '../../../lib/helpers/pools';
import { MAX_UINT128, MAX_UINT256, ZERO_ADDRESS } from '../../../lib/helpers/constants';
import { deploySortedTokens, deployTokens, TokenList } from '../../../lib/helpers/tokens';
import { encodeExitWeightedPool, encodeJoinWeightedPool } from '../../../lib/helpers/weightedPoolEncoding';

describe('WeightedPool', function () {
  let authorizer: Contract, vault: Contract, factory: Contract;
  let tokenList: TokenList, tokens: Array<Contract>;
  let admin: SignerWithAddress, creator: SignerWithAddress, lp: SignerWithAddress;
  let trader: SignerWithAddress, beneficiary: SignerWithAddress, feeSetter: SignerWithAddress, other: SignerWithAddress;

  const POOL_SWAP_FEE = fp(0.01);

  const SYMBOLS = ['DAI', 'MKR', 'SNX', 'BAT'];
  const WEIGHTS = [bn(70), bn(30), bn(5), bn(5)];
  const INITIAL_BALANCES = [bn(0.9e18), bn(1.8e18), bn(2.7e18), bn(3.6e18)];

  before('setup signers', async () => {
    [, admin, creator, lp, trader, beneficiary, feeSetter, other] = await ethers.getSigners();
    authorizer = await deploy('Authorizer', { args: [admin.address] });
  });

  beforeEach('deploy tokens', async () => {
    vault = await deploy('Vault', { args: [authorizer.address] });
    factory = await deploy('WeightedPoolFactory', { args: [vault.address] });
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

  context('for a 1 token pool', () => {
    it('reverts if there is a single token', async () => {
      const poolTokens = tokens.map((token) => token.address).slice(0, 1);
      const poolWeights = WEIGHTS.slice(0, 1);
      await expect(
        deploy('WeightedPool', {
          args: [vault.address, 'Balancer Pool Token', 'BPT', poolTokens, poolWeights, POOL_SWAP_FEE],
        })
      ).to.be.revertedWith('ERR_MIN_TOKENS');
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

      await expect(
        deploy('WeightedPool', {
          args: [vault.address, 'Balancer Pool Token', 'BPT', poolTokens, poolWeights, POOL_SWAP_FEE],
        })
      ).to.be.revertedWith('ERR_MAX_TOKENS');
    });
  });

  function itBehavesAsWeightedPool(numberOfTokens: number) {
    let poolTokens: string[];

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
        const receipt = await (await factory.create('Balancer Pool Token', 'BPT', tokens, weights, swapFee)).wait();

        const event = expectEvent.inReceipt(receipt, 'PoolCreated');
        return ethers.getContractAt('WeightedPool', event.args.pool);
      } else {
        return deploy('WeightedPool', {
          args: [vault.address, 'Balancer Pool Token', 'BPT', tokens, weights, swapFee],
        });
      }
    }

    const itOnlyMinimalSwapInfoPool = (title: string, test: Mocha.AsyncFunc) =>
      (numberOfTokens == 2 ? it.skip : it)(title, test);

    beforeEach('define pool tokens', () => {
      poolTokens = tokens.map((token) => token.address).slice(0, numberOfTokens);
    });

    describe('creation', async () => {
      context('when the creation succeeds', () => {
        let pool: Contract;

        beforeEach('deploy pool from factory', async () => {
          // Deploy from the Pool factory to test that it works properly
          pool = await deployPool({ fromFactory: true });
        });

        it('sets the vault', async () => {
          expect(await pool.getVault()).to.equal(vault.address);
        });

        it('uses the corresponding specialization', async () => {
          const poolId = await pool.getPoolId();
          const expectedSpecialization = numberOfTokens == 2 ? TwoTokenPool : MinimalSwapInfoPool;

          expect(await vault.getPool(poolId)).to.have.members([pool.address, expectedSpecialization]);
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

        it('sets the asset managers', async () => {
          const poolId = await pool.getPoolId();

          for (const token of poolTokens) {
            expect(await vault.getPoolAssetManager(poolId, token)).to.equal(ZERO_ADDRESS);
          }
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

        it('initializes the asset managers', async () => {
          const pool = await deployPool();
          const poolId = await pool.getPoolId();

          for (const symbol in poolTokens) {
            expect(await vault.getPoolAssetManager(poolId, tokens[symbol].address)).to.equal(ZERO_ADDRESS);
          }
        });

        it('reverts if there are repeated tokens', async () => {
          const tokens = new Array(poolTokens.length).fill(poolTokens[0]);

          await expect(deployPool({ tokens })).to.be.revertedWith('ERR_TOKEN_ALREADY_REGISTERED');
        });

        it('reverts if the swap fee is too high', async () => {
          const swapFee = fp(0.1).add(1);

          await expect(deployPool({ swapFee })).to.be.revertedWith('ERR_MAX_SWAP_FEE');
        });
      });
    });

    describe('onJoinPool', () => {
      let pool: Contract;
      let poolId: string;

      beforeEach(async () => {
        //Use a mock vault
        vault = await deploy('MockVault', { args: [] });
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
            .callJoinPool(
              pool.address,
              poolId,
              beneficiary.address,
              Array(poolTokens.length).fill(0),
              Array(poolTokens.length).fill(0),
              0,
              '0x'
            )
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      it('fails if wrong user data', async () => {
        const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);

        await expect(
          vault
            .connect(lp)
            .callJoinPool(
              pool.address,
              poolId,
              beneficiary.address,
              Array(poolTokens.length).fill(0),
              Array(poolTokens.length).fill(0),
              0,
              wrongUserData
            )
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      context('initialization', () => {
        let initialJoinUserData: string;

        beforeEach(async () => {
          initialJoinUserData = encodeJoinWeightedPool({ kind: 'Init' });
        });

        it('grants the invariant amount of BPT', async () => {
          const invariant = bn(
            calculateInvariant(
              poolInitialBalances.map((value) => value.toString()),
              poolWeights.map((value) => value.toString())
            ).toFixed(0)
          );

          const receipt = await (
            await vault
              .connect(creator)
              .callJoinPool(
                pool.address,
                poolId,
                beneficiary.address,
                Array(poolTokens.length).fill(0),
                poolInitialBalances,
                0,
                initialJoinUserData
              )
          ).wait();

          const event = expectEvent.inReceipt(receipt, 'PoolJoined');
          const amountsIn = event.args.amountsIn;
          const dueProtocolFeeAmounts = event.args.dueProtocolFeeAmounts;

          // Amounts in should be the same as initial ones
          expect(amountsIn).to.deep.equal(poolInitialBalances);

          // Protocol fees should be zero
          expect(dueProtocolFeeAmounts).to.deep.equal(Array(poolTokens.length).fill(bn(0)));

          // Initial balances should equal invariant
          const bpt = await pool.balanceOf(beneficiary.address);
          expectEqualWithError(bpt, invariant, 0.001);
        });

        it('fails if already initialized', async () => {
          await vault
            .connect(creator)
            .callJoinPool(
              pool.address,
              poolId,
              beneficiary.address,
              Array(poolTokens.length).fill(0),
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
                Array(poolTokens.length).fill(0),
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
              .callJoinPool(
                pool.address,
                poolId,
                beneficiary.address,
                Array(poolTokens.length).fill(0),
                poolInitialBalances,
                0,
                joinUserData
              )
          ).to.be.be.revertedWith('ERR_UNINITIALIZED');
        });

        context('once initialized', () => {
          beforeEach(async () => {
            const initialJoinUserData = encodeJoinWeightedPool({ kind: 'Init' });
            await vault
              .connect(creator)
              .callJoinPool(
                pool.address,
                poolId,
                beneficiary.address,
                Array(poolTokens.length).fill(0),
                poolInitialBalances,
                0,
                initialJoinUserData
              );
          });

          it('grants BPT for exact tokens', async () => {
            const previousBPT = await pool.balanceOf(beneficiary.address);

            const minimumBPT = bn(0.01e18);
            const joinUserData = encodeJoinWeightedPool({ kind: 'ExactTokensInForBPTOut', minimumBPT });
            const maxAmountsIn = Array(poolTokens.length).fill(bn(0));
            maxAmountsIn[1] = bn(0.1e18);

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

            const event = expectEvent.inReceipt(receipt, 'PoolJoined');
            const amountsIn = event.args.amountsIn;
            const dueProtocolFeeAmounts = event.args.dueProtocolFeeAmounts;

            // Amounts in should be the same as initial ones
            expect(amountsIn).to.deep.equal(maxAmountsIn);

            // Protocol fees should be zero
            expect(dueProtocolFeeAmounts).to.deep.equal(Array(poolTokens.length).fill(bn(0)));

            const newBPT = await pool.balanceOf(beneficiary.address);
            expectEqualWithError(newBPT.sub(previousBPT), 0.0179e18, 0.01);
          });

          it('fails if not enough BPT', async () => {
            const minimumBPT = bn(1e18);
            const joinUserData = encodeJoinWeightedPool({ kind: 'ExactTokensInForBPTOut', minimumBPT });
            const maxAmountsIn = Array(poolTokens.length).fill(bn(0));
            maxAmountsIn[1] = bn(0.1e18);

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
      let pool: Contract;
      let poolId: string;

      beforeEach(async () => {
        //Use a mock vault
        vault = await deploy('MockVault', { args: [] });
        pool = await deployPool();
        poolId = await pool.getPoolId();

        // Initialize from creator
        const initialJoinUserData = encodeJoinWeightedPool({ kind: 'Init' });
        await vault
          .connect(creator)
          .callJoinPool(
            pool.address,
            poolId,
            lp.address,
            Array(poolTokens.length).fill(0),
            poolInitialBalances,
            0,
            initialJoinUserData
          );
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
            .callExitPool(
              pool.address,
              poolId,
              beneficiary.address,
              poolInitialBalances,
              Array(poolTokens.length).fill(0),
              0,
              '0x'
            )
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      it('fails if wrong user data', async () => {
        const wrongUserData = ethers.utils.defaultAbiCoder.encode(['address'], [lp.address]);

        await expect(
          vault
            .connect(lp)
            .callExitPool(
              pool.address,
              poolId,
              beneficiary.address,
              poolInitialBalances,
              Array(poolTokens.length).fill(0),
              0,
              wrongUserData
            )
        ).to.be.be.revertedWith('Transaction reverted without a reason');
      });

      context('exit exact BPT in for one token out', () => {
        it('grants one token for exact bpt', async () => {
          const exitTokenIndex = 0;

          // Fully exit
          const prevBPT = await pool.balanceOf(lp.address);
          const exitUserData = encodeExitWeightedPool({
            kind: 'ExactBPTInForOneTokenOut',
            bptAmountIn: prevBPT,
            exitTokenIndex,
          });
          const minAmountsOut = Array(poolTokens.length).fill(bn(0));
          minAmountsOut[exitTokenIndex] = bn(0.01e18);

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

          const event = expectEvent.inReceipt(receipt, 'PoolExited');
          const amountsOut = event.args.amountsOut;
          const dueProtocolFeeAmounts = event.args.dueProtocolFeeAmounts;

          // Protocol fees should be zero
          expect(dueProtocolFeeAmounts).to.deep.equal(Array(poolTokens.length).fill(bn(0)));

          for (let i = 0; i < poolTokens.length; ++i) {
            if (i == exitTokenIndex) {
              expectEqualWithError(amountsOut[i], bn(0.8973e18), 0.001);
            } else {
              expect(amountsOut[i]).to.equal(0);
            }
          }

          expect(await pool.balanceOf(lp.address)).to.equal(bn(0));
        });
      });

      context('exit exact BPT in for all tokens out', () => {
        it('grants all tokens for exact bpt', async () => {
          // Exit with half of BPT
          const prevBPT = await pool.balanceOf(lp.address);
          const exitUserData = encodeExitWeightedPool({
            kind: 'ExactBPTInForAllTokensOut',
            bptAmountIn: prevBPT.div(2),
          });
          const minAmountsOut = Array(poolTokens.length).fill(bn(0.01e18));

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

          const event = expectEvent.inReceipt(receipt, 'PoolExited');
          const amountsOut = event.args.amountsOut;
          const dueProtocolFeeAmounts = event.args.dueProtocolFeeAmounts;

          // Protocol fees should be zero
          expect(dueProtocolFeeAmounts).to.deep.equal(Array(poolTokens.length).fill(bn(0)));

          //All balances are extracted
          for (let i = 0; i < poolTokens.length; ++i) {
            expectEqualWithError(amountsOut[i], poolInitialBalances[i].div(2), 0.001);
          }

          expectEqualWithError(await pool.balanceOf(lp.address), prevBPT.div(2), 0.001);
        });

        it('fully exit', async () => {
          const prevBPT = await pool.balanceOf(lp.address);
          const exitUserData = encodeExitWeightedPool({ kind: 'ExactBPTInForAllTokensOut', bptAmountIn: prevBPT });
          const minAmountsOut = Array(poolTokens.length).fill(bn(0.01e18));

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

          const event = expectEvent.inReceipt(receipt, 'PoolExited');
          const amountsOut = event.args.amountsOut;
          const dueProtocolFeeAmounts = event.args.dueProtocolFeeAmounts;

          // Protocol fees should be zero
          expect(dueProtocolFeeAmounts).to.deep.equal(Array(poolTokens.length).fill(bn(0)));

          //All balances are extracted
          expect(amountsOut).to.deep.equal(poolInitialBalances);

          expect(await pool.balanceOf(lp.address)).to.equal(0);
        });
      });

      context('exit BPT in for exact tokens out', () => {
        it('grants exact tokens for bpt', async () => {
          const prevBPT = await pool.balanceOf(lp.address);
          const maxBPTAmountIn = await pool.balanceOf(lp.address);
          const exitUserData = encodeExitWeightedPool({ kind: 'BPTInForExactTokensOut', maxBPTAmountIn });

          const minAmountsOut = poolInitialBalances.map((amount: BigNumber) => amount.div(2));
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

          const event = expectEvent.inReceipt(receipt, 'PoolExited');
          const amountsOut = event.args.amountsOut;
          const dueProtocolFeeAmounts = event.args.dueProtocolFeeAmounts;

          // Protocol fees should be zero
          expect(dueProtocolFeeAmounts).to.deep.equal(Array(poolTokens.length).fill(bn(0)));

          expect(amountsOut).to.deep.equal(minAmountsOut);

          expect(await pool.balanceOf(lp.address)).to.be.at.most(prevBPT.div(2).add(10));
        });

        it('fails if more BTP needed', async () => {
          const maxBPTAmountIn = (await pool.balanceOf(lp.address)).div(2);

          const exitUserData = encodeExitWeightedPool({
            kind: 'BPTInForExactTokensOut',
            maxBPTAmountIn,
          });
          const minAmountsOut = poolInitialBalances.map((amount: BigNumber) => amount);

          await expect(
            vault
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
          ).to.be.be.revertedWith('ERR_BPT_IN_MAX_AMOUNT');
        });
      });
    });

    describe('quotes', () => {
      let pool: Contract;
      let poolId: string;

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

          expect(result).to.be.at.least(bn(1.44e18));
          expect(result).to.be.at.most(bn(1.45e18));
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

          expect(result).to.be.at.least(bn(0.73e18));
          expect(result).to.be.at.most(bn(0.74e18));
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

    describe.skip('protocol swap fees', () => {
      const SWAP_FEE = fp(0.05); // 5 %
      const PROTOCOL_SWAP_FEE = fp(0.1); // 10 %

      const ZEROS = Array(numberOfTokens).fill(0);
      const MAX_UINT128S = Array(numberOfTokens).fill(MAX_UINT128);

      let pool: Contract;
      let poolId: string;

      beforeEach(async () => {
        await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_SWAP_FEE_ROLE(), feeSetter.address);
        await vault.connect(feeSetter).setProtocolSwapFee(PROTOCOL_SWAP_FEE);

        pool = await deployPool({ swapFee: SWAP_FEE });
        poolId = await pool.getPoolId();
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
          const tokenBalances = await vault.getPoolTokenBalances(poolId, [paidFeeToken]);
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

        itOnlyMinimalSwapInfoPool('pays swap protocol fees on join exact BPT out', async () => {
          await assertProtocolSwapFeeIsCharged(() =>
            pool
              .connect(lp)
              .joinPoolTokenInForExactBPTOut(bn(1e18), tokenList.DAI.address, MAX_UINT128, true, lp.address)
          );
        });

        it('pays swap protocol fees on exit', async () => {
          await assertProtocolSwapFeeIsCharged(() => pool.connect(lp).callExitPool(bn(1e18), ZEROS, true, lp.address));
        });

        itOnlyMinimalSwapInfoPool('pays swap protocol fees on exit exact BPT in', async () => {
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
