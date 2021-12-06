import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Decimal } from 'decimal.js';
import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, decimal, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { MAX_UINT112 } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import { RawLinearPoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/linear/types';
import { advanceTime, currentTimestamp, MINUTE } from '@balancer-labs/v2-helpers/src/time';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import LinearPool from '@balancer-labs/v2-helpers/src/models/pools/linear/LinearPool';

import * as math from './math';

describe('LinearPool', function () {
  let pool: LinearPool, tokens: TokenList, mainToken: Token, wrappedToken: Token;
  let trader: SignerWithAddress,
    lp: SignerWithAddress,
    admin: SignerWithAddress,
    owner: SignerWithAddress,
    other: SignerWithAddress;

  const TOTAL_TOKENS = 3;
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  const EXPECTED_RELATIVE_ERROR = 1e-14;

  before('setup', async () => {
    [, lp, trader, admin, owner, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy tokens', async () => {
    tokens = await TokenList.create(['DAI', 'CDAI'], { sorted: true });
    await tokens.mint({ to: [lp, trader], amount: fp(100) });

    mainToken = tokens.DAI;
    wrappedToken = tokens.CDAI;
  });

  async function deployPool(params: RawLinearPoolDeployment, mockedVault = true): Promise<void> {
    params = Object.assign({}, { swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE, owner, admin }, params);
    pool = await LinearPool.create(params, mockedVault);
  }

  describe('creation', () => {
    context('when the creation succeeds', () => {
      let lowerTarget: BigNumber;
      let upperTarget: BigNumber;

      sharedBeforeEach('deploy pool', async () => {
        lowerTarget = fp(1000);
        upperTarget = fp(2000);
        await deployPool({ mainToken, wrappedToken, lowerTarget, upperTarget }, false);
      });

      it('sets the vault', async () => {
        expect(await pool.getVault()).to.equal(pool.vault.address);
      });

      it('uses general specialization', async () => {
        const { address, specialization } = await pool.getRegisteredInfo();
        expect(address).to.equal(pool.address);
        expect(specialization).to.equal(PoolSpecialization.GeneralPool);
      });

      it('registers tokens and bpt in the vault', async () => {
        const { tokens, balances } = await pool.getTokens();

        expect(tokens).to.have.members(pool.tokens.addresses);
        expect(balances).to.be.zeros;
      });

      it('sets the asset managers', async () => {
        await tokens.asyncEach(async (token) => {
          const { assetManager } = await pool.getTokenInfo(token);
          expect(assetManager).to.be.zeroAddress;
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

      it('sets the targets', async () => {
        const targets = await pool.getTargets();
        expect(targets.lowerTarget).to.be.equal(lowerTarget);
        expect(targets.upperTarget).to.be.equal(upperTarget);
      });
    });

    context('when the creation fails', () => {
      it('reverts if there are repeated tokens', async () => {
        await expect(deployPool({ mainToken, wrappedToken: mainToken }, false)).to.be.revertedWith('UNSORTED_ARRAY');
      });

      it('reverts if lowerTarget is greater than upperTarget', async () => {
        await expect(
          deployPool({ mainToken, wrappedToken, lowerTarget: fp(3000), upperTarget: fp(2000) }, false)
        ).to.be.revertedWith('LOWER_GREATER_THAN_UPPER_TARGET');
      });

      it('reverts if upperTarget is greater than max token balance', async () => {
        await expect(
          deployPool({ mainToken, wrappedToken, lowerTarget: fp(3000), upperTarget: MAX_UINT112.add(1) }, false)
        ).to.be.revertedWith('UPPER_TARGET_TOO_HIGH');
      });
    });
  });

  describe('initialization', () => {
    sharedBeforeEach('deploy pool', async () => {
      await deployPool({ mainToken, wrappedToken }, false);
    });

    it('adds bpt to the vault', async () => {
      const previousBalances = await pool.getBalances();
      expect(previousBalances).to.be.zeros;

      await pool.initialize();

      const currentBalances = await pool.getBalances();
      expect(currentBalances[pool.bptIndex]).to.be.equal(MAX_UINT112);
      expect(currentBalances[pool.mainIndex]).to.be.equal(0);
      expect(currentBalances[pool.wrappedIndex]).to.be.equal(0);

      expect(await pool.totalSupply()).to.be.equal(MAX_UINT112);
    });

    it('cannot be initialized outside of the initialize function', async () => {
      await expect(
        pool.vault.joinPool({
          poolId: await pool.getPoolId(),
          tokens: pool.tokens.addresses,
        })
      ).to.be.revertedWith('INVALID_INITIALIZATION');
    });

    it('cannot be initialized twice', async () => {
      await pool.initialize();
      await expect(pool.initialize()).to.be.revertedWith('UNHANDLED_BY_LINEAR_POOL');
    });
  });

  describe('set targets', () => {
    const originalLowerTarget = fp(1000);
    const originalUpperTarget = fp(2000);

    sharedBeforeEach('deploy pool', async () => {
      await deployPool(
        { mainToken, wrappedToken, lowerTarget: originalLowerTarget, upperTarget: originalUpperTarget },
        true
      );
    });

    const setBalances = async (
      pool: LinearPool,
      balances: { mainBalance?: BigNumber; wrappedBalance?: BigNumber; bptBalance?: BigNumber }
    ) => {
      const poolId = await pool.getPoolId();

      const updateBalances = Array.from({ length: TOTAL_TOKENS }, (_, i) =>
        i == pool.mainIndex
          ? balances.mainBalance ?? bn(0)
          : i == pool.wrappedIndex
          ? balances.wrappedBalance ?? bn(0)
          : i == pool.bptIndex
          ? balances.bptBalance ?? bn(0)
          : bn(0)
      );

      await pool.vault.updateBalances(poolId, updateBalances);
    };

    context('when outside the current free zone', () => {
      const newLowerTarget = originalLowerTarget;
      const newUpperTarget = originalUpperTarget;

      it('reverts when main balance is below lower target', async () => {
        await setBalances(pool, { mainBalance: originalLowerTarget.sub(1) });
        await expect(pool.setTargets(newLowerTarget, newUpperTarget)).to.be.revertedWith('OUT_OF_TARGET_RANGE');
      });

      it('reverts when main balance is above upper target', async () => {
        await setBalances(pool, { mainBalance: originalUpperTarget.add(1) });
        await expect(pool.setTargets(newLowerTarget, newUpperTarget)).to.be.revertedWith('OUT_OF_TARGET_RANGE');
      });
    });

    context('when inside the current free zone', () => {
      const mainBalance = originalLowerTarget.add(originalUpperTarget).div(2);
      sharedBeforeEach(async () => {
        await setBalances(pool, { mainBalance });
      });

      context('when outside the new free zone', () => {
        it('reverts when main balance is below new lower target', async () => {
          const newLowerTarget = mainBalance.add(1);
          const newUpperTarget = originalUpperTarget;

          await expect(pool.setTargets(newLowerTarget, newUpperTarget)).to.be.revertedWith('OUT_OF_NEW_TARGET_RANGE');
        });

        it('reverts when main balance is above new upper target', async () => {
          const newLowerTarget = originalLowerTarget;
          const newUpperTarget = mainBalance.sub(1);

          await expect(pool.setTargets(newLowerTarget, newUpperTarget)).to.be.revertedWith('OUT_OF_NEW_TARGET_RANGE');
        });
      });

      context('when inside the new free zone', () => {
        it('can increase the upper target', async () => {
          const newLowerTarget = originalLowerTarget;
          const newUpperTarget = originalUpperTarget.mul(2);

          await pool.setTargets(newLowerTarget, newUpperTarget);
          const { lowerTarget, upperTarget } = await pool.getTargets();
          expect(lowerTarget).to.equal(newLowerTarget);
          expect(upperTarget).to.equal(newUpperTarget);
        });

        it('can decrease the upper target', async () => {
          const newLowerTarget = originalLowerTarget;
          const newUpperTarget = originalUpperTarget.mul(3).div(4);

          await pool.setTargets(newLowerTarget, newUpperTarget);
          const { lowerTarget, upperTarget } = await pool.getTargets();
          expect(lowerTarget).to.equal(newLowerTarget);
          expect(upperTarget).to.equal(newUpperTarget);
        });

        it('can increase the lower target', async () => {
          const newLowerTarget = originalLowerTarget.mul(4).div(3);
          const newUpperTarget = originalUpperTarget;

          await pool.setTargets(newLowerTarget, newUpperTarget);
          const { lowerTarget, upperTarget } = await pool.getTargets();
          expect(lowerTarget).to.equal(newLowerTarget);
          expect(upperTarget).to.equal(newUpperTarget);
        });

        it('can decrease the lower target', async () => {
          const newLowerTarget = originalLowerTarget.div(2);
          const newUpperTarget = originalUpperTarget;

          await pool.setTargets(newLowerTarget, newUpperTarget);
          const { lowerTarget, upperTarget } = await pool.getTargets();
          expect(lowerTarget).to.equal(newLowerTarget);
          expect(upperTarget).to.equal(newUpperTarget);
        });

        it('emits an event', async () => {
          const newLowerTarget = originalLowerTarget.div(2);
          const newUpperTarget = originalUpperTarget.mul(2);

          const receipt = await pool.setTargets(newLowerTarget, newUpperTarget);

          expectEvent.inReceipt(await receipt.wait(), 'TargetsSet', {
            token: mainToken.address,
            lowerTarget: newLowerTarget,
            upperTarget: newUpperTarget,
          });
        });

        it('reverts if the sender is not the owner', async () => {
          const newLowerTarget = originalLowerTarget.div(2);
          const newUpperTarget = originalUpperTarget.mul(2);

          await expect(pool.setTargets(newLowerTarget, newUpperTarget, { from: other })).to.be.revertedWith(
            'SENDER_NOT_ALLOWED'
          );
        });
      });
    });
  });

  describe('get rate', () => {
    let lowerTarget: BigNumber, upperTarget: BigNumber;
    let params: math.Params;
    let poolId: string;
    let balances: BigNumber[];

    sharedBeforeEach('deploy pool and initialize pool', async () => {
      lowerTarget = fp(40);
      upperTarget = fp(60);
      await deployPool({ mainToken, wrappedToken, lowerTarget, upperTarget, owner }, true);

      poolId = await pool.getPoolId();
      balances = Array.from({ length: TOTAL_TOKENS }, (_, i) => (i == pool.bptIndex ? MAX_UINT112 : bn(0)));

      await (await pool.vault).updateBalances(poolId, balances);
    });

    sharedBeforeEach('initialize params', async () => {
      const currentCache = await pool.getWrappedTokenRateCache();
      params = {
        fee: POOL_SWAP_FEE_PERCENTAGE,
        rate: currentCache.rate,
        target1: lowerTarget,
        target2: upperTarget,
      };
    });

    context('without balances', () => {
      it('rate is zero', async () => {
        await expect(pool.getRate()).to.be.revertedWith('ZERO_DIVISION');
      });
    });

    context('with balances', () => {
      let mainBalance: Decimal, wrappedBalance: Decimal, bptBalance: Decimal;
      let expectedRate: Decimal;

      sharedBeforeEach('update balances', async () => {
        mainBalance = decimal(50);
        wrappedBalance = decimal(50);
        bptBalance = decimal(100);

        balances[pool.mainIndex] = fp(mainBalance);
        balances[pool.wrappedIndex] = fp(wrappedBalance);
        balances[pool.bptIndex] = MAX_UINT112.sub(fp(bptBalance));

        await (await pool.vault).updateBalances(poolId, balances);
      });

      sharedBeforeEach('calculate expected rate', async () => {
        const nominalMainBalance = math.toNominal(mainBalance, params);
        const invariant = math.calcInvariant(nominalMainBalance, wrappedBalance, params);
        expectedRate = invariant.div(bptBalance);
      });

      it('equals expected rate', async () => {
        const currentRate = await pool.getRate();
        expect(currentRate).to.be.equalWithError(fp(expectedRate), 0.000000000001);
      });

      context('once wrapped swapped', () => {
        sharedBeforeEach('swap main per wrapped', async () => {
          const amount = fp(20);

          const result = await pool.swapGivenIn({
            in: pool.mainIndex,
            out: pool.wrappedIndex,
            amount: amount,
            balances,
          });

          balances[pool.mainIndex] = balances[pool.mainIndex].add(amount);
          balances[pool.wrappedIndex] = balances[pool.wrappedIndex].sub(result);
          await (await pool.vault).updateBalances(poolId, balances);
        });

        it('rate remains the same', async () => {
          const currentRate = await pool.getRate();
          expect(currentRate).to.be.equalWithError(fp(expectedRate), 0.000000000001);
        });
      });

      context('once bpt swapped', () => {
        sharedBeforeEach('swap main per bpt', async () => {
          const amount = fp(20);

          const result = await pool.swapGivenIn({
            in: pool.mainIndex,
            out: pool.bptIndex,
            amount: amount,
            balances,
          });

          balances[pool.mainIndex] = balances[pool.mainIndex].add(amount);
          balances[pool.bptIndex] = balances[pool.bptIndex].sub(result);
          await (await pool.vault).updateBalances(poolId, balances);
        });

        it('rate remains the same', async () => {
          const currentRate = await pool.getRate();
          expect(currentRate).to.be.equalWithError(fp(expectedRate), 0.000000000001);
        });
      });

      context.skip('once targets updated', () => {
        sharedBeforeEach('owner update targets', async () => {
          const newLowerTarget = fp(10);
          const newUpperTarget = fp(200);
          await pool.setTargets(newLowerTarget, newUpperTarget);
        });

        it('rate remains the same', async () => {
          const currentRate = await pool.getRate();
          expect(currentRate).to.be.equalWithError(fp(expectedRate), 0.000000000001);
        });
      });

      context.skip('once swap fee updated', () => {
        sharedBeforeEach('update swap fee', async () => {
          await pool.instance.connect(owner).setSwapFeePercentage(POOL_SWAP_FEE_PERCENTAGE.mul(2));
        });

        it('rate remains the same', async () => {
          const currentRate = await pool.getRate();
          expect(currentRate).to.be.equalWithError(fp(expectedRate), 0.000000000001);
        });
      });
    });
  });

  describe('swaps', () => {
    let currentBalances: BigNumber[];
    let lowerTarget: BigNumber, upperTarget: BigNumber;
    let params: math.Params;

    sharedBeforeEach('deploy and initialize pool', async () => {
      lowerTarget = fp(1000);
      upperTarget = fp(2000);
      await deployPool({ mainToken, wrappedToken, lowerTarget, upperTarget }, true);
      currentBalances = Array.from({ length: TOTAL_TOKENS }, (_, i) => (i == pool.bptIndex ? MAX_UINT112 : bn(0)));

      const currentCache = await pool.getWrappedTokenRateCache();
      params = {
        fee: POOL_SWAP_FEE_PERCENTAGE,
        rate: currentCache.rate,
        target1: lowerTarget,
        target2: upperTarget,
      };
    });

    context('below target 1', () => {
      context('given DAI in', () => {
        let amount: BigNumber;
        let bptSupply: BigNumber;

        sharedBeforeEach('initialize values ', async () => {
          amount = fp(100);
          bptSupply = MAX_UINT112.sub(currentBalances[pool.bptIndex]);
        });

        it('calculate bpt out', async () => {
          const result = await pool.swapGivenIn({
            in: pool.mainIndex,
            out: pool.bptIndex,
            amount: amount,
            balances: currentBalances,
          });

          const expected = math.calcBptOutPerMainIn(
            amount,
            currentBalances[pool.mainIndex],
            currentBalances[pool.wrappedIndex],
            bptSupply,
            params
          );

          expect(result).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);

          currentBalances[pool.mainIndex] = currentBalances[pool.mainIndex].add(amount);
          currentBalances[pool.bptIndex] = currentBalances[pool.bptIndex].sub(result);
        });

        context('when paused', () => {
          sharedBeforeEach('pause pool', async () => {
            await pool.pause();
          });

          it('reverts', async () => {
            await expect(
              pool.swapGivenIn({
                in: pool.mainIndex,
                out: pool.bptIndex,
                amount: amount,
                balances: currentBalances,
              })
            ).to.be.revertedWith('PAUSED');
          });
        });
      });

      context('given DAI out', () => {
        let amount: BigNumber;

        sharedBeforeEach('initialize values ', async () => {
          amount = fp(50);
        });

        it('calculate wrapped in', async () => {
          const result = await pool.swapGivenOut({
            in: pool.wrappedIndex,
            out: pool.mainIndex,
            amount: amount,
            balances: currentBalances,
          });

          const expected = math.calcWrappedInPerMainOut(amount, currentBalances[pool.mainIndex], params);

          expect(result).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);

          currentBalances[pool.wrappedIndex] = currentBalances[pool.wrappedIndex].add(amount);
          currentBalances[pool.mainIndex] = currentBalances[pool.mainIndex].sub(result);
        });

        context('when paused', () => {
          sharedBeforeEach('pause pool', async () => {
            await pool.pause();
          });

          it('reverts', async () => {
            await expect(
              pool.swapGivenOut({
                in: pool.wrappedIndex,
                out: pool.mainIndex,
                amount: amount,
                balances: currentBalances,
              })
            ).to.be.revertedWith('PAUSED');
          });
        });
      });

      context('given bpt in', () => {
        let amount: BigNumber;
        let bptSupply: BigNumber;

        sharedBeforeEach('initialize values ', async () => {
          amount = fp(10);
          bptSupply = MAX_UINT112.sub(currentBalances[pool.bptIndex]);
        });

        it('calculate wrapped out', async () => {
          const result = await pool.swapGivenIn({
            in: pool.bptIndex,
            out: pool.wrappedIndex,
            amount: amount,
            balances: currentBalances,
          });

          const expected = math.calcWrappedOutPerBptIn(
            amount,
            currentBalances[pool.mainIndex],
            currentBalances[pool.wrappedIndex],
            bptSupply,
            params
          );

          expect(result).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);

          currentBalances[pool.wrappedIndex] = currentBalances[pool.wrappedIndex].add(amount);
          currentBalances[pool.mainIndex] = currentBalances[pool.mainIndex].sub(result);
        });

        context('when paused', () => {
          sharedBeforeEach('pause pool', async () => {
            await pool.pause();
          });

          it('reverts', async () => {
            await expect(
              pool.swapGivenIn({
                in: pool.bptIndex,
                out: pool.wrappedIndex,
                amount: amount,
                balances: currentBalances,
              })
            ).to.be.revertedWith('PAUSED');
          });
        });
      });
    });
  });

  describe('virtual supply', () => {
    sharedBeforeEach('deploy and initialize pool', async () => {
      const lowerTarget = fp(1000);
      const upperTarget = fp(2000);
      await deployPool({ mainToken, wrappedToken, lowerTarget, upperTarget }, false);
      await pool.initialize();
    });

    it('reports no supply', async () => {
      const virtualSupply = await pool.getVirtualSupply();
      expect(virtualSupply).to.be.equalWithError(bn(0), 0.0001);
    });

    context('after bpt swapped', () => {
      sharedBeforeEach('swap bpt', async () => {
        await tokens.approve({ to: pool.vault.address, from: [lp], amount: fp(50) });

        const balances = await pool.getBalances();
        await pool.swapGivenIn({
          in: pool.mainIndex,
          out: pool.bptIndex,
          amount: fp(50),
          balances,
          from: lp,
          recipient: lp,
        });
      });

      it('reports correctly', async () => {
        const lpBptBalance = await pool.balanceOf(lp);
        const virtualSupply = await pool.getVirtualSupply();
        expect(virtualSupply).to.be.equalWithError(lpBptBalance, 0.0001);
      });
    });
  });

  describe('emergency proportional exit', () => {
    let lowerTarget: BigNumber, upperTarget: BigNumber;

    sharedBeforeEach('deploy and initialize pool', async () => {
      lowerTarget = fp(1000);
      upperTarget = fp(2000);
      await deployPool({ mainToken, wrappedToken, lowerTarget, upperTarget }, false);
      await pool.initialize();
    });

    sharedBeforeEach('swap to prepare for exit', async () => {
      await tokens.approve({ to: pool.vault.address, from: [lp], amount: fp(50) });

      let balances = await pool.getBalances();
      await pool.swapGivenIn({
        in: pool.mainIndex,
        out: pool.bptIndex,
        amount: fp(50),
        balances,
        from: lp,
        recipient: lp,
      });
      balances = await pool.getBalances();
      await pool.swapGivenIn({
        in: pool.wrappedIndex,
        out: pool.mainIndex,
        amount: fp(30),
        balances,
        from: lp,
        recipient: lp,
      });
    });

    context('when not paused', () => {
      it('cannot exit proportionally', async () => {
        const bptIn = fp(10);
        await expect(pool.emergencyProportionalExit({ from: lp, bptIn })).to.be.revertedWith('NOT_PAUSED');
      });
    });

    context('when paused', () => {
      context('one lp', () => {
        sharedBeforeEach('pause pool', async () => {
          await pool.pause();
        });

        it('can exit proportionally', async () => {
          const previousVirtualSupply = await pool.getVirtualSupply();
          const previousLpBptBalance = await pool.balanceOf(lp);
          const currentBalances = await pool.getBalances();

          //Exit with 25% of BPT balance
          const bptIn = MAX_UINT112.sub(currentBalances[pool.bptIndex]).div(4);

          const expectedAmountsOut = currentBalances.map((balance, i) =>
            i == pool.bptIndex ? bn(0) : bn(balance).div(4)
          );

          const result = await pool.emergencyProportionalExit({ from: lp, bptIn });

          // Protocol fees should be zero
          expect(result.dueProtocolFeeAmounts).to.be.zeros;
          // Balances are reduced by half because we are returning half of the BPT supply
          expect(result.amountsOut).to.be.equalWithError(expectedAmountsOut, 0.00001);

          const currentLpBptBalance = await pool.balanceOf(lp);
          expect(previousLpBptBalance.sub(currentLpBptBalance)).to.be.equalWithError(bptIn, 0.00001);

          // Current virtual supply
          const currentVirtualSupply = await pool.getVirtualSupply();
          expect(currentVirtualSupply).to.be.equalWithError(previousVirtualSupply.sub(bptIn), 0.00001);
        });
      });

      context('two lps', () => {
        const amount = fp(100);

        sharedBeforeEach('second lp swaps', async () => {
          await tokens.mint({ to: other, amount });
          await tokens.approve({ from: other, to: pool.vault });

          const balances = await pool.getBalances();
          await pool.swapGivenIn({
            in: pool.mainIndex,
            out: pool.bptIndex,
            amount: fp(50),
            balances,
            from: other,
            recipient: other,
          });
        });

        sharedBeforeEach('pause pool', async () => {
          await pool.pause();
        });

        sharedBeforeEach('first lp exits', async () => {
          const bptIn = await pool.balanceOf(lp);
          await pool.emergencyProportionalExit({ from: lp, bptIn });
        });

        it('can fully exit proportionally', async () => {
          const previousVirtualSupply = await pool.getVirtualSupply();
          const previousOtherBptBalance = await pool.balanceOf(other);

          const currentBalances = await pool.getBalances();
          const expectedAmountsOut = currentBalances.map((balance, i) =>
            i == pool.bptIndex ? bn(0) : bn(balance).mul(previousOtherBptBalance).div(previousVirtualSupply)
          );

          //Exit with all BPT balance
          const result = await pool.emergencyProportionalExit({ from: other, bptIn: previousOtherBptBalance });

          // Protocol fees should be zero
          expect(result.dueProtocolFeeAmounts).to.be.zeros;
          expect(result.amountsOut).to.be.equalWithError(expectedAmountsOut, 0.00001);

          const currentOtherBptBalance = await pool.balanceOf(other);
          expect(currentOtherBptBalance).to.be.equal(0);

          // Current virtual supply after full exit is cero
          const currentVirtualSupply = await pool.getVirtualSupply();
          expect(currentVirtualSupply).to.be.equalWithError(bn(0), 0.00001);
        });
      });
    });
  });

  describe('wrapped token rate cache', () => {
    let timestamp: BigNumber;
    let wrappedTokenRateProvider: Contract;
    const wrappedTokenRateCacheDuration = MINUTE * 20;

    const scaleRate = (rate: BigNumber) => rate.mul(bn(10).pow(18 - wrappedToken.decimals));

    sharedBeforeEach('deploy pool', async () => {
      wrappedTokenRateProvider = await deploy('v2-pool-utils/MockRateProvider');
      timestamp = await currentTimestamp();
      await deployPool({ mainToken, wrappedToken, wrappedTokenRateProvider, wrappedTokenRateCacheDuration });
    });

    it('initializes correctly', async () => {
      const provider = await pool.getWrappedTokenRateProvider();
      expect(provider).to.be.equal(wrappedTokenRateProvider.address);

      const { rate, duration, expires } = await pool.getWrappedTokenRateCache();
      expect(rate).to.be.equal(fp(1));
      expect(duration).to.be.equal(wrappedTokenRateCacheDuration);
      expect(expires).to.be.at.least(timestamp.add(wrappedTokenRateCacheDuration));
    });

    describe('scaling factors', () => {
      const itAdaptsTheScalingFactorsCorrectly = () => {
        const expectedBptScalingFactor = fp(1);
        const expectedMainTokenScalingFactor = fp(1);

        it('adapt the scaling factors with the price rate', async () => {
          const scalingFactors = await pool.getScalingFactors();

          const expectedWrappedTokenScalingFactor = scaleRate(await wrappedTokenRateProvider.getRate());
          expect(scalingFactors[pool.wrappedIndex]).to.be.equal(expectedWrappedTokenScalingFactor);
          expect(await pool.getScalingFactor(wrappedToken)).to.be.equal(expectedWrappedTokenScalingFactor);

          expect(scalingFactors[pool.mainIndex]).to.be.equal(expectedMainTokenScalingFactor);
          expect(await pool.getScalingFactor(mainToken)).to.be.equal(expectedMainTokenScalingFactor);

          expect(scalingFactors[pool.bptIndex]).to.be.equal(expectedBptScalingFactor);
          expect(await pool.getScalingFactor(pool.bptToken)).to.be.equal(expectedBptScalingFactor);
        });
      };

      context('with a price rate above 1', () => {
        sharedBeforeEach('mock rate', async () => {
          await wrappedTokenRateProvider.mockRate(fp(1.1));
          await pool.updateWrappedTokenRateCache();
        });

        itAdaptsTheScalingFactorsCorrectly();
      });

      context('with a price rate equal to 1', () => {
        sharedBeforeEach('mock rate', async () => {
          await wrappedTokenRateProvider.mockRate(fp(1));
          await pool.updateWrappedTokenRateCache();
        });

        itAdaptsTheScalingFactorsCorrectly();
      });

      context('with a price rate below 1', () => {
        sharedBeforeEach('mock rate', async () => {
          await wrappedTokenRateProvider.mockRate(fp(0.99));
          await pool.updateWrappedTokenRateCache();
        });

        itAdaptsTheScalingFactorsCorrectly();
      });
    });

    describe('update', () => {
      const itUpdatesTheRateCache = (action: () => Promise<ContractTransaction>) => {
        const newRate = fp(1.5);

        it('updates the cache', async () => {
          const previousCache = await pool.getWrappedTokenRateCache();

          await wrappedTokenRateProvider.mockRate(newRate);
          const updatedAt = await currentTimestamp();
          await action();

          const currentCache = await pool.getWrappedTokenRateCache();
          expect(currentCache.rate).to.be.equal(newRate);
          expect(previousCache.rate).not.to.be.equal(newRate);

          expect(currentCache.duration).to.be.equal(wrappedTokenRateCacheDuration);
          expect(currentCache.expires).to.be.at.least(updatedAt.add(wrappedTokenRateCacheDuration));
        });

        it('emits an event', async () => {
          await wrappedTokenRateProvider.mockRate(newRate);
          const receipt = await action();

          expectEvent.inReceipt(await receipt.wait(), 'PriceRateCacheUpdated', {
            token: wrappedToken.address,
            rate: newRate,
          });
        });
      };

      context('before the cache expires', () => {
        sharedBeforeEach('advance time', async () => {
          await advanceTime(wrappedTokenRateCacheDuration / 2);
        });

        context('when not forced', () => {
          const action = async () => pool.instance.mockCacheWrappedTokenRateIfNecessary();

          it('does not update the cache', async () => {
            const previousCache = await pool.getWrappedTokenRateCache();

            await action();

            const currentCache = await pool.getWrappedTokenRateCache();
            expect(currentCache.rate).to.be.equal(previousCache.rate);
            expect(currentCache.expires).to.be.equal(previousCache.expires);
            expect(currentCache.duration).to.be.equal(previousCache.duration);
          });
        });

        context('when forced', () => {
          const action = async () => pool.updateWrappedTokenRateCache();

          itUpdatesTheRateCache(action);
        });
      });

      context('after the cache expires', () => {
        sharedBeforeEach('advance time', async () => {
          await advanceTime(wrappedTokenRateCacheDuration + MINUTE);
        });

        context('when not forced', () => {
          const action = async () => pool.instance.mockCacheWrappedTokenRateIfNecessary();

          itUpdatesTheRateCache(action);
        });

        context('when forced', () => {
          const action = async () => pool.updateWrappedTokenRateCache();

          itUpdatesTheRateCache(action);
        });
      });
    });

    describe('set cache duration', () => {
      const newDuration = MINUTE * 10;

      sharedBeforeEach('grant role to admin', async () => {
        const action = await actionId(pool.instance, 'setWrappedTokenRateCacheDuration');
        await pool.vault.grantRoleGlobally(action, admin);
      });

      const itUpdatesTheCacheDuration = () => {
        it('updates the cache duration', async () => {
          const previousCache = await pool.getWrappedTokenRateCache();

          const newRate = fp(1.5);
          await wrappedTokenRateProvider.mockRate(newRate);
          const forceUpdateAt = await currentTimestamp();
          await pool.setWrappedTokenRateCacheDuration(newDuration, { from: owner });

          const currentCache = await pool.getWrappedTokenRateCache();
          expect(currentCache.rate).to.be.equal(newRate);
          expect(previousCache.rate).not.to.be.equal(newRate);
          expect(currentCache.duration).to.be.equal(newDuration);
          expect(currentCache.expires).to.be.at.least(forceUpdateAt.add(newDuration));
        });

        it('emits an event', async () => {
          const receipt = await pool.setWrappedTokenRateCacheDuration(newDuration, { from: owner });

          expectEvent.inReceipt(await receipt.wait(), 'PriceRateProviderSet', {
            token: wrappedToken.address,
            provider: wrappedTokenRateProvider.address,
            cacheDuration: newDuration,
          });
        });
      };

      context('when it is requested by the owner', () => {
        context('before the cache expires', () => {
          sharedBeforeEach('advance time', async () => {
            await advanceTime(wrappedTokenRateCacheDuration / 2);
          });

          itUpdatesTheCacheDuration();
        });

        context('after the cache has expired', () => {
          sharedBeforeEach('advance time', async () => {
            await advanceTime(wrappedTokenRateCacheDuration + MINUTE);
          });

          itUpdatesTheCacheDuration();
        });
      });

      context('when it is requested by the admin', () => {
        it('reverts', async () => {
          await expect(pool.setWrappedTokenRateCacheDuration(10, { from: admin })).to.be.revertedWith(
            'SENDER_NOT_ALLOWED'
          );
        });
      });

      context('when it is requested by another one', () => {
        it('reverts', async () => {
          await expect(pool.setWrappedTokenRateCacheDuration(10, { from: lp })).to.be.revertedWith(
            'SENDER_NOT_ALLOWED'
          );
        });
      });
    });
  });
});
