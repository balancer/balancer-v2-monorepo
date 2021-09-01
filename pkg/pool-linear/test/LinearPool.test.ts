import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { PoolSpecialization } from '@balancer-labs/balancer-js';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT112 } from '@balancer-labs/v2-helpers/src/constants';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import LinearPool from '@balancer-labs/v2-helpers/src/models/pools/linear/LinearPool';
import { RawLinearPoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/linear/types';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describe('LinearPool', function () {
  let pool: LinearPool, tokens: TokenList, mainToken: Token, wrappedToken: Token;

  let trader: SignerWithAddress, lp: SignerWithAddress, owner: SignerWithAddress;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const _TOTAL_TOKENS = 3;

  async function deployPool(params: RawLinearPoolDeployment, mockedVault: boolean): Promise<void> {
    params = Object.assign({}, { swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE }, params);
    pool = await LinearPool.create(params, mockedVault);
  }

  function sortThreeTokens(tokenX: string, tokenY: string, tokenZ: string) {
    if (tokenX < tokenY) {
      if (tokenY < tokenZ) {
        return [tokenX, tokenY, tokenZ];
      } else if (tokenX < tokenZ) {
        return [tokenX, tokenZ, tokenY];
      } else {
        return [tokenZ, tokenX, tokenY];
      }
    } else {
      //tokenY < tokenX
      if (tokenZ < tokenY) {
        return [tokenZ, tokenY, tokenX];
      } else if (tokenZ < tokenX) {
        return [tokenY, tokenZ, tokenX];
      } else {
        return [tokenY, tokenX, tokenZ];
      }
    }
  }

  before('setup', async () => {
    [, lp, trader, owner] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy tokens', async () => {
    tokens = await TokenList.create(['DAI', 'MKR'], { sorted: true });
    await tokens.mint({ to: [lp, trader], amount: fp(100) });

    mainToken = tokens.DAI;
    wrappedToken = tokens.MKR;
  });

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

        const sorted = sortThreeTokens(mainToken.address, wrappedToken.address, pool.address);

        expect(tokens).to.have.members(sorted);
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
      expect(currentBalances[await pool.getTokenIndex(pool.address)]).to.be.equal(MAX_UINT112);
      expect(currentBalances[await pool.getTokenIndex(mainToken.address)]).to.be.equal(0);
      expect(currentBalances[await pool.getTokenIndex(wrappedToken.address)]).to.be.equal(0);

      expect(await pool.totalSupply()).to.be.equal(MAX_UINT112);
    });
  });

  const setBalances = async (
    pool: LinearPool,
    balances: { mainBalance?: BigNumber; wrappedBalance?: BigNumber; bptBalance?: BigNumber }
  ) => {
    const poolId = await pool.getPoolId();
    const mainIndex = await pool.getTokenIndex(mainToken.address);
    const wrappedIndex = await pool.getTokenIndex(wrappedToken.address);
    const bptIndex = await pool.getTokenIndex(pool.address);

    const updateBalances = Array.from({ length: _TOTAL_TOKENS }, (_, i) =>
      i == mainIndex
        ? balances.mainBalance ?? bn(0)
        : i == wrappedIndex
        ? balances.wrappedBalance ?? bn(0)
        : i == bptIndex
        ? balances.bptBalance ?? bn(0)
        : bn(0)
    );
    await (await pool.getVaultObject()).updateBalances(poolId, updateBalances);
  };

  describe('set targets', () => {
    sharedBeforeEach('deploy pool', async () => {
      const lowerTarget = fp(1000);
      const upperTarget = fp(2000);
      await deployPool({ mainToken, wrappedToken, lowerTarget, upperTarget, owner }, true);
    });

    it('correctly if inside free zone ', async () => {
      const mainBalance = fp(1800);
      const lowerTarget = fp(1500);
      const upperTarget = fp(2500);

      await setBalances(pool, { mainBalance });

      await pool.setTargets(lowerTarget, upperTarget);

      const targets = await pool.getTargets();
      expect(targets.lowerTarget).to.be.equal(lowerTarget);
      expect(targets.upperTarget).to.be.equal(upperTarget);
    });

    it('reverts if under free zone', async () => {
      const mainBalance = fp(100);
      const lowerTarget = fp(1500);
      const upperTarget = fp(2500);

      await setBalances(pool, { mainBalance });

      await expect(pool.setTargets(lowerTarget, upperTarget)).to.be.revertedWith('OUT_OF_TARGET_RANGE');
    });

    it('reverts if over free zone', async () => {
      const mainBalance = fp(3000);
      const lowerTarget = fp(1500);
      const upperTarget = fp(2500);

      await setBalances(pool, { mainBalance });

      await expect(pool.setTargets(lowerTarget, upperTarget)).to.be.revertedWith('OUT_OF_TARGET_RANGE');
    });

    it('reverts not owner', async () => {
      const lowerTarget = fp(1500);
      const upperTarget = fp(2500);

      await expect(pool.setTargets(lowerTarget, upperTarget, { from: lp })).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });

    it('emits an event', async () => {
      const mainBalance = fp(1800);
      const lowerTarget = fp(1500);
      const upperTarget = fp(2500);

      await setBalances(pool, { mainBalance });
      const receipt = await pool.setTargets(lowerTarget, upperTarget);

      expectEvent.inReceipt(await receipt.wait(), 'TargetsSet', {
        lowerTarget,
        upperTarget,
      });
    });
  });

  describe('get rate', () => {
    let mainIndex: number, wrappedIndex: number, bptIndex: number;
    let poolId: string;
    let balances: BigNumber[];

    sharedBeforeEach('deploy pool and initialize pool', async () => {
      await deployPool({ mainToken, wrappedToken }, true);

      poolId = await pool.getPoolId();

      mainIndex = await pool.getTokenIndex(mainToken.address);
      wrappedIndex = await pool.getTokenIndex(wrappedToken.address);
      bptIndex = await pool.getTokenIndex(pool.address);

      balances = Array.from({ length: _TOTAL_TOKENS }, (_, i) => (i == bptIndex ? MAX_UINT112 : bn(0)));

      await (await pool.getVaultObject()).updateBalances(poolId, balances);
    });

    context('before swaps', () => {
      it('rate is zero', async () => {
        await expect(pool.getRate()).to.be.revertedWith('ZERO_DIVISION');
      });
    });

    context('once swapped', () => {
      it('rate lower than one', async () => {
        balances[mainIndex] = fp(50);
        balances[wrappedIndex] = fp(50.50505051);
        balances[bptIndex] = MAX_UINT112.sub(fp(101.010101));
        await (await pool.getVaultObject()).updateBalances(poolId, balances);

        const result = await pool.getRate();
        expect(result.lte(fp(1))).to.be.true;
      });

      it('rate higher than one', async () => {
        balances[mainIndex] = fp(6342.983516);
        balances[wrappedIndex] = fp(6309.88467);
        balances[bptIndex] = MAX_UINT112.sub(fp(6687.166002));
        await (await pool.getVaultObject()).updateBalances(poolId, balances);

        const result = await pool.getRate();
        expect(result.gte(fp(1))).to.be.true;
      });
    });
  });

  describe('swaps', () => {
    let currentBalances: BigNumber[];
    let mainIndex: number, wrappedIndex: number, bptIndex: number;

    sharedBeforeEach('deploy and initialize pool', async () => {
      await deployPool({ mainToken, wrappedToken, lowerTarget: fp(1000), upperTarget: fp(2000) }, true);
      mainIndex = await pool.getTokenIndex(mainToken.address);
      wrappedIndex = await pool.getTokenIndex(wrappedToken.address);
      bptIndex = await pool.getTokenIndex(pool.address);

      currentBalances = Array.from({ length: _TOTAL_TOKENS }, (_, i) => (i == bptIndex ? MAX_UINT112 : bn(0)));
    });

    context('below target 1', () => {
      context('given DAI in', () => {
        it('calculate bpt out', async () => {
          const amount = fp(100);

          const result = await pool.swapGivenIn({
            in: mainIndex,
            out: bptIndex,
            amount: amount,
            balances: currentBalances,
          });

          expect(result).to.be.equal('101010101010101010102');

          currentBalances[mainIndex] = currentBalances[mainIndex].add(amount);
          currentBalances[bptIndex] = currentBalances[bptIndex].sub(result);
        });
      });
      context('given DAI out', () => {
        it('calculate wrapped in', async () => {
          const amount = fp(50);

          const result = await pool.swapGivenOut({
            in: wrappedIndex,
            out: mainIndex,
            amount: amount,
            balances: currentBalances,
          });

          expect(result).to.be.equal('50505050505050505051');

          currentBalances[wrappedIndex] = currentBalances[wrappedIndex].add(amount);
          currentBalances[mainIndex] = currentBalances[mainIndex].sub(result);
        });
      });
    });
  });
});
