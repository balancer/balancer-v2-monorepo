import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp, fromFp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT112, MAX_UINT96 } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import { RawLinearPoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/linear/types';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import LinearPool from '@balancer-labs/v2-helpers/src/models/pools/linear/LinearPool';

import * as math from './math';
import Decimal from 'decimal.js';

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
      let upperTarget: BigNumber;

      sharedBeforeEach('deploy pool', async () => {
        upperTarget = fp(2000);
        await deployPool({ mainToken, wrappedToken, upperTarget }, false);
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
        expect(targets.lowerTarget).to.be.equal(0);
        expect(targets.upperTarget).to.be.equal(upperTarget);
      });
    });

    context('when the creation fails', () => {
      it('reverts if there are repeated tokens', async () => {
        await expect(deployPool({ mainToken, wrappedToken: mainToken }, false)).to.be.revertedWith('UNSORTED_ARRAY');
      });

      it('reverts if upperTarget is greater than the maximum', async () => {
        await expect(deployPool({ mainToken, wrappedToken, upperTarget: MAX_UINT96.add(1) }, false)).to.be.revertedWith(
          'UPPER_TARGET_TOO_HIGH'
        );
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

    sharedBeforeEach('deploy pool and set initial targets', async () => {
      await deployPool({ mainToken, wrappedToken, upperTarget: originalUpperTarget }, true);
      await setBalances(pool, { mainBalance: originalLowerTarget.add(originalUpperTarget).div(2) });
      await pool.setTargets(originalLowerTarget, originalUpperTarget);
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

        it('can set an extreme upper target', async () => {
          const newLowerTarget = originalLowerTarget.div(2);
          const newUpperTarget = MAX_UINT96;

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

  describe('set swap fee percentage', () => {
    const lowerTarget = fp(1000);
    const upperTarget = fp(2000);

    const swapFeePercentage = fp(0.1);

    sharedBeforeEach('deploy pool and set initial targets', async () => {
      await deployPool({ mainToken, wrappedToken, upperTarget: upperTarget }, true);
      await setBalances(pool, { mainBalance: lowerTarget.add(upperTarget).div(2) });
      await pool.setTargets(lowerTarget, upperTarget);
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

    context('when outside the targets', () => {
      it('reverts when main balance is below lower target', async () => {
        await setBalances(pool, { mainBalance: lowerTarget.sub(1) });
        await expect(pool.setSwapFeePercentage(swapFeePercentage)).to.be.revertedWith('OUT_OF_TARGET_RANGE');
      });

      it('reverts when main balance is above upper target', async () => {
        await setBalances(pool, { mainBalance: upperTarget.add(1) });
        await expect(pool.setSwapFeePercentage(swapFeePercentage)).to.be.revertedWith('OUT_OF_TARGET_RANGE');
      });
    });

    context('when inside the targets', () => {
      it('sets the swap fee when main balance equals the lower target', async () => {
        await setBalances(pool, { mainBalance: lowerTarget });
        const receipt = await (await pool.setSwapFeePercentage(swapFeePercentage)).wait();
        expectEvent.inReceipt(receipt, 'SwapFeePercentageChanged', { swapFeePercentage });
      });

      it('sets the swap fee when main balance equals the upper target', async () => {
        await setBalances(pool, { mainBalance: upperTarget });
        const receipt = await (await pool.setSwapFeePercentage(swapFeePercentage)).wait();
        expectEvent.inReceipt(receipt, 'SwapFeePercentageChanged', { swapFeePercentage });
      });

      it('sets the swap fee when main balance is between the targets', async () => {
        await setBalances(pool, { mainBalance: upperTarget.add(lowerTarget).div(2) });
        const receipt = await (await pool.setSwapFeePercentage(swapFeePercentage)).wait();
        expectEvent.inReceipt(receipt, 'SwapFeePercentageChanged', { swapFeePercentage });
      });
    });
  });

  describe('get rate', () => {
    const lowerTarget = fp(30);
    const upperTarget = fp(60);
    const balances: BigNumber[] = new Array<BigNumber>(3);

    let params: math.Params;
    let poolId: string;

    sharedBeforeEach('deploy pool and initialize pool', async () => {
      await deployPool({ mainToken, wrappedToken, upperTarget, owner }, true);

      poolId = await pool.getPoolId();
      await pool.vault.updateBalances(
        poolId,
        Array.from({ length: TOTAL_TOKENS }, (_, i) => (i == pool.bptIndex ? MAX_UINT112 : bn(0)))
      );
    });

    context('without balances', () => {
      it('reverts', async () => {
        await expect(pool.getRate()).to.be.revertedWith('ZERO_DIVISION');
      });
    });

    before('initialize params', () => {
      params = {
        fee: POOL_SWAP_FEE_PERCENTAGE,
        lowerTarget,
        upperTarget,
      };
    });

    context('with balances', async () => {
      await pool.setTargets(lowerTarget, upperTarget);
      const mainBalance = fromFp(lowerTarget.add(upperTarget).div(2));
      const wrappedBalance = fromFp(upperTarget.mul(3));
      const bptBalance = mainBalance.add(wrappedBalance);

      let expectedRate: Decimal;

      beforeEach('set initial balances', async () => {
        balances[pool.mainIndex] = fp(mainBalance);
        balances[pool.wrappedIndex] = fp(wrappedBalance);
        balances[pool.bptIndex] = MAX_UINT112.sub(fp(bptBalance));
      });

      before('calculate expected rate', async () => {
        const nominalMainBalance = math.toNominal(mainBalance, params);
        const invariant = math.calcInvariant(nominalMainBalance, wrappedBalance);
        expectedRate = invariant.div(bptBalance);
      });

      sharedBeforeEach('update balances and rate', async () => {
        await pool.vault.updateBalances(poolId, balances);
        await pool.setTargets(lowerTarget, upperTarget);
      });

      it('equals expected rate', async () => {
        const currentRate = await pool.getRate();
        expect(currentRate).to.be.equalWithError(fp(expectedRate), 0.000000000001);
      });

      context('with main above upper', () => {
        context('with main to wrapped swap', () => {
          sharedBeforeEach('do swap', async () => {
            const amountMainIn = upperTarget;

            const result = await pool.swapGivenIn({
              in: pool.mainIndex,
              out: pool.wrappedIndex,
              amount: amountMainIn,
              balances,
            });

            balances[pool.mainIndex] = balances[pool.mainIndex].add(amountMainIn);
            balances[pool.wrappedIndex] = balances[pool.wrappedIndex].sub(result);
          });

          it('rate remains the same', async () => {
            await pool.vault.updateBalances(poolId, balances);

            const currentRate = await pool.getRate();
            expect(currentRate).to.be.equalWithError(fp(expectedRate), 0.000000000001);
          });
        });

        context('with main to bpt swap', () => {
          sharedBeforeEach('do swap', async () => {
            const amountInMain = upperTarget;

            const result = await pool.swapGivenIn({
              in: pool.mainIndex,
              out: pool.bptIndex,
              amount: amountInMain,
              balances,
            });

            balances[pool.mainIndex] = balances[pool.mainIndex].add(amountInMain);
            balances[pool.bptIndex] = balances[pool.bptIndex].sub(result);
          });

          it('rate remains the same', async () => {
            await pool.vault.updateBalances(poolId, balances);

            const currentRate = await pool.getRate();
            expect(currentRate).to.be.equalWithError(fp(expectedRate), 0.000000000001);
          });
        });
      });

      context('with main below upper', () => {
        context('with wrapped to main swap', () => {
          sharedBeforeEach('do swap', async () => {
            const amountMainOut = balances[pool.mainIndex].sub(upperTarget.div(2));

            const result = await pool.swapGivenOut({
              in: pool.wrappedIndex,
              out: pool.mainIndex,
              amount: amountMainOut,
              balances,
            });

            balances[pool.mainIndex] = balances[pool.mainIndex].sub(amountMainOut);
            balances[pool.wrappedIndex] = balances[pool.wrappedIndex].add(result);
          });

          it('rate remains the same', async () => {
            await pool.vault.updateBalances(poolId, balances);

            const currentRate = await pool.getRate();
            expect(currentRate).to.be.equalWithError(fp(expectedRate), 0.000000000001);
          });
        });

        context('with bpt to main swap', () => {
          sharedBeforeEach('do swap', async () => {
            const amountMainOut = balances[pool.mainIndex].sub(upperTarget.div(2));

            const result = await pool.swapGivenOut({
              in: pool.bptIndex,
              out: pool.mainIndex,
              amount: amountMainOut,
              balances,
            });

            balances[pool.mainIndex] = balances[pool.mainIndex].sub(amountMainOut);
            balances[pool.bptIndex] = balances[pool.bptIndex].add(result);
          });

          it('rate remains the same', async () => {
            await pool.vault.updateBalances(poolId, balances);

            const currentRate = await pool.getRate();
            expect(currentRate).to.be.equalWithError(fp(expectedRate), 0.000000000001);
          });
        });
      });

      context('with targets updated', () => {
        sharedBeforeEach('owner update targets', async () => {
          const newLowerTarget = lowerTarget.div(2);
          const newUpperTarget = upperTarget.mul(2);

          await pool.vault.updateBalances(poolId, balances);
          await pool.setTargets(newLowerTarget, newUpperTarget);
        });

        it('rate remains the same', async () => {
          await pool.vault.updateBalances(poolId, balances);
          const currentRate = await pool.getRate();
          expect(currentRate).to.be.equalWithError(fp(expectedRate), 0.000000000001);
        });
      });

      context('with swap fee updated', () => {
        sharedBeforeEach('update swap fee', async () => {
          await pool.vault.updateBalances(poolId, balances);
          await pool.instance.connect(owner).setSwapFeePercentage(POOL_SWAP_FEE_PERCENTAGE.mul(2));
        });

        it('rate remains the same', async () => {
          await pool.vault.updateBalances(poolId, balances);
          const currentRate = await pool.getRate();
          expect(currentRate).to.be.equalWithError(fp(expectedRate), 0.000000000001);
        });
      });
    });
  });

  describe('scaling factors', () => {
    const scaleRate = (rate: BigNumber) => rate.mul(bn(10).pow(18 - wrappedToken.decimals));

    sharedBeforeEach('deploy pool', async () => {
      await deployPool({ mainToken, wrappedToken });
    });

    const itAdaptsTheScalingFactorsCorrectly = () => {
      const expectedBptScalingFactor = fp(1);
      const expectedMainTokenScalingFactor = fp(1);

      it('adapt the scaling factors with the price rate', async () => {
        const scalingFactors = await pool.getScalingFactors();

        const expectedWrappedTokenScalingFactor = scaleRate(await pool.getWrappedTokenRate());
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
        await pool.instance.setWrappedTokenRate(fp(1.1));
      });

      itAdaptsTheScalingFactorsCorrectly();
    });

    context('with a price rate equal to 1', () => {
      sharedBeforeEach('mock rate', async () => {
        await pool.instance.setWrappedTokenRate(fp(1));
      });

      itAdaptsTheScalingFactorsCorrectly();
    });

    context('with a price rate below 1', () => {
      sharedBeforeEach('mock rate', async () => {
        await pool.instance.setWrappedTokenRate(fp(0.99));
      });

      itAdaptsTheScalingFactorsCorrectly();
    });
  });

  describe('swaps', () => {
    let currentBalances: BigNumber[];
    let lowerTarget: BigNumber, upperTarget: BigNumber;
    let params: math.Params;

    sharedBeforeEach('deploy and initialize pool', async () => {
      lowerTarget = fp(0);
      upperTarget = fp(2000);
      await deployPool({ mainToken, wrappedToken, upperTarget }, true);
      currentBalances = Array.from({ length: TOTAL_TOKENS }, (_, i) => (i == pool.bptIndex ? MAX_UINT112 : bn(0)));

      params = {
        fee: POOL_SWAP_FEE_PERCENTAGE,
        lowerTarget,
        upperTarget,
      };
    });

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

  describe('virtual supply', () => {
    sharedBeforeEach('deploy and initialize pool', async () => {
      const upperTarget = fp(2000);
      await deployPool({ mainToken, wrappedToken, upperTarget }, false);
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
    let upperTarget: BigNumber;

    sharedBeforeEach('deploy and initialize pool', async () => {
      upperTarget = fp(2000);
      await deployPool({ mainToken, wrappedToken, upperTarget }, false);
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

    // Skipping until recovery mode implemented
    context.skip('when paused', () => {
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
});
