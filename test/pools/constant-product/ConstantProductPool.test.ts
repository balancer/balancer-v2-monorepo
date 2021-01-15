import Decimal from 'decimal.js';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract, ContractFunction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { assertEqualWithError, bn } from '../../helpers/numbers';
import { deploy } from '../../../scripts/helpers/deploy';
import { toFixedPoint } from '../../../scripts/helpers/fixedPoint';
import { deployPoolFromFactory, SimplifiedQuotePool, TwoTokenPool } from '../../../scripts/helpers/pools';
import { deploySortedTokens, deployTokens, TokenList } from '../../helpers/tokens';
import { MAX_UINT128, MAX_UINT256, ZERO_ADDRESS } from '../../helpers/constants';
import { expectBalanceChange } from '../../helpers/tokenBalance';
import {
  calcBptInGivenExactTokensOut,
  calcBptOutGivenExactTokensIn,
  calcTokenInGivenExactBptOut,
  calcTokenOutGivenExactBptIn,
} from '../../helpers/math/weightedProduct';

describe('ConstantProductPool', function () {
  let authorizer: Contract, vault: Contract;
  let tokenList: TokenList, tokens: Array<Contract>;
  let admin: SignerWithAddress, creator: SignerWithAddress, lp: SignerWithAddress;
  let trader: SignerWithAddress, beneficiary: SignerWithAddress, feeSetter: SignerWithAddress, other: SignerWithAddress;

  const INITIAL_BPT = bn(90e18);
  const POOL_SWAP_FEE = toFixedPoint(0.01);

  const SYMBOLS = ['DAI', 'MKR', 'SNX', 'BAT'];
  const WEIGHTS = [bn(60), bn(30), bn(5), bn(5)];
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

  context('for a 2 token pool', () => {
    itBehavesAsConstantProductPool(2);
  });

  context('for a 3 token pool', () => {
    itBehavesAsConstantProductPool(3);
  });

  function itBehavesAsConstantProductPool(numberOfTokens: number) {
    let poolTokens: string[];

    const poolSymbols = SYMBOLS.slice(0, numberOfTokens);
    const poolWeights = WEIGHTS.slice(0, numberOfTokens);
    const poolInitialBalances = INITIAL_BALANCES.slice(0, numberOfTokens);

    async function deployPool({ tokens, balances, weights, swapFee }: any = {}) {
      return deployPoolFromFactory(vault, admin, 'ConstantProductPool', {
        from: creator,
        parameters: [
          INITIAL_BPT,
          tokens || poolTokens,
          balances || poolInitialBalances,
          weights || poolWeights,
          swapFee || POOL_SWAP_FEE,
        ],
      });
    }

    function mapBalanceChanges(balances: Array<any>) {
      return balances.reduce((changes: any, balance: any, i) => ({ ...changes, [poolSymbols[i]]: balance }), {});
    }

    beforeEach('define pool tokens', () => {
      poolTokens = tokens.map((token) => token.address).slice(0, numberOfTokens);
    });

    context('creation via factory', async () => {
      context('when the creation succeeds', () => {
        let pool: Contract;

        beforeEach('deploy pool', async () => {
          pool = await deployPool();
        });

        it('creates a pool in the vault', async () => {
          expect(await pool.getVault()).to.equal(vault.address);
        });

        // TODO: Un-skip test when implemented
        it.skip('uses the corresponding optimization', async () => {
          const poolId = await pool.getPoolId();
          const expectedOptimization = numberOfTokens == 2 ? TwoTokenPool : SimplifiedQuotePool;

          expect(await vault.getPool(poolId)).to.have.members([pool.address, expectedOptimization]);
        });

        it('grants initial BPT to the pool creator', async () => {
          expect(await pool.balanceOf(creator.address)).to.equal(INITIAL_BPT);
        });

        it('adds tokens to pool', async () => {
          const poolId = await pool.getPoolId();

          expect(await vault.getPoolTokens(poolId)).to.have.members(poolTokens);
          expect(await vault.getPoolTokenBalances(poolId, poolTokens)).to.deep.equal(poolInitialBalances);
        });

        it('pulls tokens from the pool creator', async () => {
          const vaultChanges = mapBalanceChanges(poolInitialBalances);
          const accountChanges = mapBalanceChanges(poolInitialBalances.map((balance) => `-${balance}`));

          await expectBalanceChange(deployPool, tokenList, [
            { account: creator, changes: accountChanges },
            { account: vault, changes: vaultChanges },
          ]);
        });

        it('adds tokens to pool', async () => {
          const poolId = await pool.getPoolId();

          expect(await vault.getPoolTokens(poolId)).to.have.members(poolTokens);
          expect(await vault.getPoolTokenBalances(poolId, poolTokens)).to.deep.equal(poolInitialBalances);
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
        it('reverts if the number of tokens and amounts do not match', async () => {
          const balances = poolInitialBalances.slice(1);

          await expect(deployPool({ balances })).to.be.revertedWith('Create2: Failed on deploy');
        });

        it('reverts if the number of tokens and weights do not match', async () => {
          const weights = poolWeights.slice(1);

          await expect(deployPool({ weights })).to.be.revertedWith('Create2: Failed on deploy');
        });

        it('reverts if there is a single token', async () => {
          const tokens = poolTokens.slice(0, 1);
          const weights = poolWeights.slice(0, 1);
          const balances = poolInitialBalances.slice(0, 1);

          await expect(deployPool({ tokens, balances, weights })).to.be.revertedWith('Create2: Failed on deploy');
        });

        it('reverts if there are repeated tokens', async () => {
          const tokens = new Array(poolTokens.length).fill(poolTokens[0]);

          await expect(deployPool({ tokens })).to.be.revertedWith('Create2: Failed on deploy');
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

          await expect(deployPool({ tokens, balances, weights })).to.be.revertedWith('Create2: Failed on deploy');
        });

        it('reverts if the swap fee is too high', async () => {
          const swapFee = toFixedPoint(0.1).add(1);

          await expect(deployPool({ swapFee })).to.be.revertedWith('Create2: Failed on deploy');
        });
      });
    });

    context('with pool', () => {
      let pool: Contract;
      let poolId: string;

      beforeEach('deploy pool', async () => {
        pool = await deployPool();
        poolId = await pool.getPoolId();
      });

      describe('joining', () => {
        let maxAmountsIn: BigNumber[];
        const BPT_AMOUNT_OUT = bn(10e18);

        beforeEach('set max amounts in', async () => {
          maxAmountsIn = poolInitialBalances.map((balance) => balance.mul(BPT_AMOUNT_OUT).div(INITIAL_BPT));
        });

        it('grants BPT to specified beneficiary', async () => {
          const previousBPT = await pool.balanceOf(lp.address);

          await pool.connect(lp).joinPool(BPT_AMOUNT_OUT, maxAmountsIn, true, lp.address);

          const newBPTBalance = await pool.balanceOf(lp.address);
          expect(newBPTBalance.sub(previousBPT)).to.equal(BPT_AMOUNT_OUT);
        });

        it('pulls only the required tokens', async () => {
          const HUGE_MAX_AMOUNTS_IN = Array(numberOfTokens).fill(bn(10e18));
          const changes = mapBalanceChanges(maxAmountsIn.map((balance) => `-${balance}`));

          await expectBalanceChange(
            () => pool.connect(lp).joinPool(BPT_AMOUNT_OUT, HUGE_MAX_AMOUNTS_IN, true, lp.address),
            tokenList,
            { account: lp, changes }
          );
        });

        it('can withdraw from user balance', async () => {
          const depositedAmount = BigNumber.from((1e18).toString());
          for (const token of poolTokens) await vault.connect(lp).deposit(token, depositedAmount, lp.address);

          await expectBalanceChange(
            () => pool.connect(lp).joinPool(BPT_AMOUNT_OUT, maxAmountsIn, false, lp.address),
            tokenList,
            { account: lp }
          );

          for (const token of poolTokens) {
            const userBalance = await vault.getUserTokenBalance(lp.address, token);
            const expectedBalance = depositedAmount.sub(maxAmountsIn[poolTokens.indexOf(token)]);
            expect(userBalance).to.equal(expectedBalance);
          }
        });

        it('transfers missing tokens if user balance is not enough', async () => {
          for (const token of poolTokens) {
            const userBalance = await vault.getUserTokenBalance(lp.address, token);
            await vault.connect(lp).withdraw(token, userBalance, lp.address);
          }

          await vault.connect(lp).deposit(poolTokens[0], BigNumber.from((0.1e18).toString()).sub(1), lp.address);
          const otherTokens = poolTokens.slice(1);
          for (const token of otherTokens) await vault.connect(lp).deposit(token, (1e18).toString(), lp.address);

          await expectBalanceChange(
            () => pool.connect(lp).joinPool(BPT_AMOUNT_OUT, maxAmountsIn, false, lp.address),
            tokenList,
            { account: lp, changes: { DAI: -1 } }
          );
        });

        it('fails if maximum amounts are not enough', async () => {
          const notEnoughMaxAmounts = [...maxAmountsIn];
          notEnoughMaxAmounts[0] = notEnoughMaxAmounts[0].sub(1);

          const firstJoin = pool.connect(lp).joinPool(BPT_AMOUNT_OUT, notEnoughMaxAmounts, true, lp.address);
          await expect(firstJoin).to.be.revertedWith('ERR_LIMIT_IN');

          notEnoughMaxAmounts[0] = notEnoughMaxAmounts[0].add(1);
          notEnoughMaxAmounts[1] = notEnoughMaxAmounts[1].sub(1);

          const secondJoin = pool.connect(lp).joinPool(BPT_AMOUNT_OUT, notEnoughMaxAmounts, true, lp.address);
          await expect(secondJoin).to.be.revertedWith('ERR_LIMIT_IN');
        });

        it('fails if not supplying all tokens', async () => {
          const missingMaxAmountsIn = [bn(0.1e18)];

          const join = pool.connect(lp).joinPool(BPT_AMOUNT_OUT, missingMaxAmountsIn, false, lp.address);
          await expect(join).to.be.revertedWith('Tokens and amounts length mismatch');
        });

        it('fails if supplying extra tokens', async () => {
          const extraMaxAmountsIn = maxAmountsIn.concat(bn(0.3e18));

          const join = pool.connect(lp).joinPool(BPT_AMOUNT_OUT, extraMaxAmountsIn, true, lp.address);
          await expect(join).to.be.revertedWith('Tokens and amounts length mismatch');
        });
      });

      describe('joining & swapping', () => {
        let previousBPTBalance: BigNumber, previousTokenBalances: BigNumber[];

        beforeEach('compute previous balances', async () => {
          previousBPTBalance = await pool.balanceOf(lp.address);
          previousTokenBalances = await Promise.all(tokens.map((token) => token.balanceOf(lp.address)));
        });

        it('grants BPT for exact tokens', async () => {
          const MIN_BPT_OUT = bn(1e18);
          const EXACT_TOKENS_IN = [bn(0), bn(0.1e18), bn(0)].slice(0, numberOfTokens);

          await pool.connect(lp).joinPoolExactTokensInForBPTOut(MIN_BPT_OUT, EXACT_TOKENS_IN, true, lp.address);

          const expectedBPTOut = calcBptOutGivenExactTokensIn(
            poolInitialBalances,
            poolWeights,
            EXACT_TOKENS_IN,
            INITIAL_BPT,
            POOL_SWAP_FEE
          );

          const newBPTBalance = await pool.balanceOf(lp.address);
          const expectedNewBptBalance = previousBPTBalance.add(expectedBPTOut);
          assertEqualWithError(newBPTBalance, expectedNewBptBalance, 0.001);

          const newMKRBalance = await tokenList.MKR.balanceOf(lp.address);
          expect(newMKRBalance).to.be.equal(previousTokenBalances[1].sub(EXACT_TOKENS_IN[1]));

          const currentDAIBalance = await tokenList.DAI.balanceOf(lp.address);
          expect(currentDAIBalance).to.be.equal(previousTokenBalances[0]);

          const currentSNXBalance = await tokenList.SNX.balanceOf(lp.address);
          expect(currentSNXBalance).to.be.equal(previousTokenBalances[2]);
        });

        it('grants exact BPT for tokens', async () => {
          const MIN_MKR_IN = bn(0.15e18);
          const EXACT_BPT_OUT = bn(1.626e18);

          await pool
            .connect(lp)
            .joinPoolTokenInForExactBPTOut(EXACT_BPT_OUT, tokenList.MKR.address, MIN_MKR_IN, true, lp.address);

          const newBPTBalance = await pool.balanceOf(lp.address);
          expect(newBPTBalance.sub(previousBPTBalance)).to.equal(EXACT_BPT_OUT);

          const expectedTokenIn = calcTokenInGivenExactBptOut(
            1,
            poolInitialBalances,
            poolWeights,
            EXACT_BPT_OUT,
            INITIAL_BPT,
            POOL_SWAP_FEE
          );

          const newMKRBalance = await tokenList.MKR.balanceOf(lp.address);
          const expectedNewMKRBalance = previousTokenBalances[1].sub(expectedTokenIn);
          assertEqualWithError(newMKRBalance, expectedNewMKRBalance, 0.01);

          const currentDAIBalance = await tokenList.DAI.balanceOf(lp.address);
          expect(currentDAIBalance).to.be.equal(previousTokenBalances[0]);

          const currentSNXBalance = await tokenList.SNX.balanceOf(lp.address);
          expect(currentSNXBalance).to.be.equal(previousTokenBalances[2]);
        });
      });

      describe('exiting', () => {
        let minAmountsOut: BigNumber[];

        const BPT_AMOUNT_IN = bn(10e18);
        const ZEROED_MIN_AMOUNTS_OUT = Array(numberOfTokens).fill(0);

        beforeEach('join pool', async () => {
          // Join the pool with the same amount we will use later to exit (BPT amount in)
          const BPT_OUT = BPT_AMOUNT_IN;
          await pool.connect(lp).joinPool(BPT_OUT, Array(numberOfTokens).fill(bn(10e18)), true, lp.address);

          expect(await pool.totalSupply()).to.equal((100e18).toString());

          const expectedAmountsIn = poolInitialBalances.map((balance) => balance.mul(BPT_OUT).div(INITIAL_BPT));
          const expectedPoolBalances = poolInitialBalances.map((b, i) => b.add(expectedAmountsIn[i]));
          expect(await vault.getPoolTokenBalances(poolId, poolTokens)).to.deep.equal(expectedPoolBalances);
        });

        beforeEach('compute min amount out', () => {
          minAmountsOut = poolInitialBalances.map((balance) => balance.mul(BPT_AMOUNT_IN).div(INITIAL_BPT));
        });

        it('takes BPT in return', async () => {
          const previousBPT = await pool.balanceOf(lp.address);

          await pool.connect(lp).exitPool(BPT_AMOUNT_IN, ZEROED_MIN_AMOUNTS_OUT, true, lp.address);

          const newBPTBalance = await pool.balanceOf(lp.address);
          expect(previousBPT.sub(BPT_AMOUNT_IN)).to.equal(newBPTBalance);
        });

        it('all tokens due are pushed', async () => {
          const changes = mapBalanceChanges(minAmountsOut);

          await expectBalanceChange(
            () => pool.connect(lp).exitPool(BPT_AMOUNT_IN, ZEROED_MIN_AMOUNTS_OUT, true, lp.address),
            tokenList,
            { account: lp, changes }
          );
        });

        it('all tokens due are pushed to a specified beneficiary', async () => {
          const changes = mapBalanceChanges(minAmountsOut);

          await expectBalanceChange(
            () => pool.connect(lp).exitPool(BPT_AMOUNT_IN, ZEROED_MIN_AMOUNTS_OUT, true, beneficiary.address),
            tokenList,
            { account: beneficiary, changes }
          );
        });

        it('can deposit into user balance', async () => {
          await expectBalanceChange(
            () => pool.connect(lp).exitPool(BPT_AMOUNT_IN, ZEROED_MIN_AMOUNTS_OUT, false, lp.address),
            tokenList,
            { account: lp }
          );

          await Promise.all(
            poolTokens.map(async (token, index) => {
              const userTokenBalance = await vault.getUserTokenBalance(lp.address, token);
              expect(userTokenBalance).to.equal(minAmountsOut[index]);
            })
          );
        });

        it("can deposit into a beneficiary's user balance", async () => {
          await expectBalanceChange(
            () => pool.connect(lp).exitPool(BPT_AMOUNT_IN, ZEROED_MIN_AMOUNTS_OUT, false, beneficiary.address),
            tokenList,
            { account: beneficiary }
          );

          for (const token of poolTokens) {
            const userBalance = await vault.getUserTokenBalance(beneficiary.address, token);
            expect(userBalance).to.equal(minAmountsOut[poolTokens.indexOf(token)]);
          }
        });

        it('can charge protocol withdraw fees', async () => {
          const protocolWithdrawFee = 0.01;
          const role = await authorizer.SET_PROTOCOL_WITHDRAW_FEE_ROLE();

          await authorizer.connect(admin).grantRole(role, feeSetter.address);
          await vault.connect(feeSetter).setProtocolWithdrawFee(toFixedPoint(protocolWithdrawFee));

          const changes = mapBalanceChanges(minAmountsOut.map((balance) => balance.mul(99).div(100)));
          await expectBalanceChange(
            () => pool.connect(lp).exitPool(BPT_AMOUNT_IN, ZEROED_MIN_AMOUNTS_OUT, true, lp.address),
            tokenList,
            { account: lp, changes }
          );
        });

        it('fails if minimum amounts are not enough', async () => {
          const lowMinimumAmountsOut = [...minAmountsOut];
          lowMinimumAmountsOut[0] = lowMinimumAmountsOut[0].add(1);

          const firstExit = pool.connect(lp).exitPool(BPT_AMOUNT_IN, lowMinimumAmountsOut, true, lp.address);
          await expect(firstExit).to.be.revertedWith('NOT EXITING ENOUGH');

          lowMinimumAmountsOut[0] = lowMinimumAmountsOut[0].sub(1);
          lowMinimumAmountsOut[1] = lowMinimumAmountsOut[1].add(1);

          const secondExit = pool.connect(lp).exitPool(BPT_AMOUNT_IN, lowMinimumAmountsOut, true, lp.address);
          await expect(secondExit).to.be.revertedWith('NOT EXITING ENOUGH');
        });

        it('fails if not requesting all tokens', async () => {
          const missingMinAmountsOut = [bn(0.1e18)];

          const exitPool = pool.connect(lp).exitPool(BPT_AMOUNT_IN, missingMinAmountsOut, true, lp.address);
          await expect(exitPool).to.be.revertedWith('Tokens and amounts length mismatch');
        });

        it('fails if exiting with excess BPT', async () => {
          const exceedingBPT = BPT_AMOUNT_IN.add(1);

          const exitPool = pool.connect(lp).exitPool(exceedingBPT, ZEROED_MIN_AMOUNTS_OUT, true, lp.address);
          await expect(exitPool).to.be.revertedWith('ERR_INSUFFICIENT_BAL');
        });

        it('fails if requesting extra tokens', async () => {
          const extraMinAmountOut = minAmountsOut.concat(bn(1));

          const exitPool = pool.connect(lp).exitPool(BPT_AMOUNT_IN, extraMinAmountOut, true, lp.address);
          await expect(exitPool).to.be.revertedWith('Tokens and amounts length mismatch');
        });
      });

      describe('exiting & swapping', () => {
        let previousBPTBalance: BigNumber, previousTokenBalances: BigNumber[];

        beforeEach('join pool', async () => {
          // The LP joins and gets 10e18 BPT
          const BPT_OUT = bn(10e18);
          await pool.connect(lp).joinPool(BPT_OUT, Array(numberOfTokens).fill(bn(10e18)), true, lp.address);

          expect(await pool.totalSupply()).to.equal(bn(100e18));

          const expectedAmountsIn = poolInitialBalances.map((balance) => balance.mul(BPT_OUT).div(INITIAL_BPT));
          const expectedPoolBalances = poolInitialBalances.map((b, i) => b.add(expectedAmountsIn[i]));
          expect(await vault.getPoolTokenBalances(poolId, poolTokens)).to.deep.equal(expectedPoolBalances);
        });

        beforeEach('compute previous balances', async () => {
          previousBPTBalance = await pool.balanceOf(lp.address);
          previousTokenBalances = await Promise.all(tokens.map((token) => token.balanceOf(lp.address)));
        });

        it('takes exact BPT for tokens', async () => {
          const EXACT_BPT_IN = bn(10e18);
          const MIN_MKR_OUT = bn(0.5e18);

          await pool
            .connect(lp)
            .exitPoolExactBPTInForTokenOut(EXACT_BPT_IN, tokenList.MKR.address, MIN_MKR_OUT, true, lp.address);

          const newBPTBalance = await pool.balanceOf(lp.address);
          expect(newBPTBalance).to.equal(previousBPTBalance.sub(EXACT_BPT_IN));

          const expectedTokenIn = calcTokenOutGivenExactBptIn(
            1,
            poolInitialBalances,
            poolWeights,
            EXACT_BPT_IN,
            INITIAL_BPT,
            POOL_SWAP_FEE
          );

          const newMKRBalance = await tokenList.MKR.balanceOf(lp.address);
          const expectedNewMKRBalance = previousTokenBalances[1].add(expectedTokenIn);
          assertEqualWithError(newMKRBalance, expectedNewMKRBalance, 0.02);

          const currentDAIBalance = await tokenList.DAI.balanceOf(lp.address);
          expect(currentDAIBalance).to.be.equal(previousTokenBalances[0]);

          const currentSNXBalance = await tokenList.SNX.balanceOf(lp.address);
          expect(currentSNXBalance).to.be.equal(previousTokenBalances[2]);
        });

        it('takes BPT for exact tokens', async () => {
          const MAX_BPT_IN = bn(2e18);
          const EXACT_TOKENS_OUT = [bn(0), bn(0.1e18), bn(0)].slice(0, numberOfTokens);

          await pool.connect(lp).exitPoolBPTInForExactTokensOut(MAX_BPT_IN, EXACT_TOKENS_OUT, true, lp.address);

          const expectedBptIn = calcBptInGivenExactTokensOut(
            poolInitialBalances,
            poolWeights,
            EXACT_TOKENS_OUT,
            INITIAL_BPT,
            POOL_SWAP_FEE
          );

          const newBPTBalance = await pool.balanceOf(lp.address);
          const expectedNewBptBalance = previousBPTBalance.sub(expectedBptIn);
          assertEqualWithError(newBPTBalance, expectedNewBptBalance, 0.001);

          const newTokenBalance = await tokenList.MKR.balanceOf(lp.address);
          expect(newTokenBalance.sub(previousTokenBalances[1])).to.equal(EXACT_TOKENS_OUT[1]);

          const currentDAIBalance = await tokenList.DAI.balanceOf(lp.address);
          expect(currentDAIBalance).to.be.equal(previousTokenBalances[0]);

          const currentSNXBalance = await tokenList.SNX.balanceOf(lp.address);
          expect(currentSNXBalance).to.be.equal(previousTokenBalances[2]);
        });

        it('cannot exit with more tokens than joined', async () => {
          const previousBPT = await pool.balanceOf(lp.address);
          const previousTokenBalance = await tokenList.MKR.balanceOf(lp.address);

          const EXACT_TOKENS_IN = [0, bn(0.1e18), 0].slice(0, numberOfTokens);
          await pool.connect(lp).joinPoolExactTokensInForBPTOut(bn(1e18), EXACT_TOKENS_IN, true, lp.address);

          const newBPTBalance = await pool.balanceOf(lp.address);
          const obtainedBPT = newBPTBalance.sub(previousBPT);

          await pool.connect(lp).exitPoolExactBPTInForTokenOut(obtainedBPT, tokenList.MKR.address, 0, true, lp.address);

          const newTokenBalance = await tokenList.MKR.balanceOf(lp.address);
          expect(newTokenBalance.sub(previousTokenBalance)).to.be.at.most(0);
        });
      });

      describe('draining', () => {
        const ZEROED_MIN_AMOUNTS_OUT = Array(numberOfTokens).fill(0);

        it('pools can be fully exited', async () => {
          await pool.connect(creator).exitPool(INITIAL_BPT, ZEROED_MIN_AMOUNTS_OUT, true, creator.address);

          expect(await pool.totalSupply()).to.equal(0);

          // The tokens are not unregistered from the Pool
          expect(await vault.getPoolTokens(poolId)).to.not.be.empty;
          expect(await vault.getPoolTokens(poolId)).to.have.members(poolTokens);
        });

        it('drained pools cannot be rejoined', async () => {
          await pool.connect(creator).exitPool(INITIAL_BPT, ZEROED_MIN_AMOUNTS_OUT, true, creator.address);

          const join = pool.connect(lp).joinPool(bn(10e18), Array(numberOfTokens).fill(bn(1e18)), true, lp.address);
          await expect(join).to.be.revertedWith('ERR_ZERO_LIQUIDITY');
        });
      });

      describe('quotes', () => {
        let quoteData: any;

        beforeEach('set default quote data', () => {
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

        beforeEach('set protocol swap fee', async () => {
          await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_SWAP_FEE_ROLE(), feeSetter.address);
          await vault.connect(feeSetter).setProtocolSwapFee(PROTOCOL_SWAP_FEE);
        });

        beforeEach('deploy and join pool', async () => {
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
              withdrawFromUserBalance: false,
              depositToUserBalance: false,
            };

            await vault.connect(trader).batchSwapGivenIn(ZERO_ADDRESS, '0x', [swap], poolTokens, funds);
          });

          async function assertProtocolSwapFeeIsCharged(payFeesAction: ContractFunction) {
            const previousBlockHash = (await ethers.provider.getBlock('latest')).hash;
            const paidTokenIndex = BigNumber.from(previousBlockHash).mod(numberOfTokens).toNumber();
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

            const error = expectedPaidFees.div(1000);
            const paidTokenFees = await vault.getCollectedFeesByToken(poolTokens[paidTokenIndex]);
            expect(paidTokenFees).be.at.least(expectedPaidFees.sub(error));
            expect(paidTokenFees).be.at.most(expectedPaidFees.add(error));

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

          it('pays swap protocol fees on join exact BPT out', async () => {
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
    });
  }
});
