import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_UINT112, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import { BigNumberish, bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { currentTimestamp, MONTH } from '@balancer-labs/v2-helpers/src/time';
import { RawStablePhantomPoolDeployment } from '@balancer-labs/v2-helpers/src/models/pools/stable-phantom/types';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePhantomPool from '@balancer-labs/v2-helpers/src/models/pools/stable-phantom/StablePhantomPool';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('StablePhantomPool', () => {
  let owner: SignerWithAddress, recipient: SignerWithAddress;

  sharedBeforeEach('setup signers', async () => {
    [, owner, recipient] = await ethers.getSigners();
  });

  context('for 2 tokens pool', () => {
    itBehavesAsStablePhantomPool(2);
  });

  context('for 4 tokens pool', () => {
    itBehavesAsStablePhantomPool(4);
  });

  context('for 1 token pool', () => {
    it('reverts', async () => {
      const tokens = await TokenList.create(1);
      await expect(StablePhantomPool.create({ tokens })).to.be.revertedWith('MIN_TOKENS');
    });
  });

  context('for 5 tokens pool', () => {
    it('reverts', async () => {
      const tokens = await TokenList.create(5, { sorted: true });
      await expect(StablePhantomPool.create({ tokens })).to.be.revertedWith('MAX_TOKENS');
    });
  });

  function itBehavesAsStablePhantomPool(numberOfTokens: number): void {
    let pool: StablePhantomPool, tokens: TokenList, deployedAt: BigNumber, bptIndex: number;

    const rateProviders: Contract[] = [];
    const tokenRates: BigNumberish[] = [];
    const priceRateCacheDurations: BigNumberish[] = [];

    async function deployPool(params: RawStablePhantomPoolDeployment = {}): Promise<void> {
      tokens = await TokenList.create(numberOfTokens, { sorted: true });

      for (let i = 0; i < numberOfTokens; i++) {
        tokenRates[i] = fp(1 + (i + 1) / 10);
        rateProviders[i] = await deploy('v2-pool-utils/MockRateProvider');
        await rateProviders[i].mockRate(tokenRates[i]);
        priceRateCacheDurations[i] = MONTH + i;
      }

      pool = await StablePhantomPool.create({ tokens, rateProviders, priceRateCacheDurations, ...params });
      bptIndex = await pool.getBptIndex();
      deployedAt = await currentTimestamp();
    }

    describe('creation', () => {
      context('when the creation succeeds', () => {
        const SWAP_FEE_PERCENTAGE = fp(0.1);
        const AMPLIFICATION_PARAMETER = bn(200);

        sharedBeforeEach('deploy pool', async () => {
          await deployPool({
            owner,
            swapFeePercentage: SWAP_FEE_PERCENTAGE,
            amplificationParameter: AMPLIFICATION_PARAMETER,
          });
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

        it('sets the owner ', async () => {
          expect(await pool.getOwner()).to.equal(owner.address);
        });

        it('sets the vault correctly', async () => {
          expect(await pool.getVault()).to.equal(pool.vault.address);
        });

        it('uses general specialization', async () => {
          const { address, specialization } = await pool.getRegisteredInfo();

          expect(address).to.equal(pool.address);
          expect(specialization).to.equal(PoolSpecialization.GeneralPool);
        });

        it('registers tokens in the vault', async () => {
          const { tokens: poolTokens, balances } = await pool.getTokens();

          expect(poolTokens).to.have.lengthOf(numberOfTokens + 1);
          expect(poolTokens).to.include.members(tokens.addresses);
          expect(poolTokens).to.include(pool.address);
          expect(balances).to.be.zeros;
        });

        it('starts with no BPT', async () => {
          expect(await pool.totalSupply()).to.be.equal(0);
        });

        it('sets amplification', async () => {
          const { value, isUpdating, precision } = await pool.getAmplificationParameter();

          expect(value).to.be.equal(AMPLIFICATION_PARAMETER.mul(precision));
          expect(isUpdating).to.be.false;
        });

        it('sets swap fee', async () => {
          expect(await pool.getSwapFeePercentage()).to.equal(SWAP_FEE_PERCENTAGE);
        });

        it('sets the rate providers', async () => {
          const providers = await pool.getRateProviders();

          // BPT does not have a rate provider
          expect(providers).to.have.lengthOf(numberOfTokens + 1);
          expect(providers).to.include.members(rateProviders.map((r) => r.address));
          expect(providers).to.include(ZERO_ADDRESS);
        });

        it('sets the rate cache durations', async () => {
          await tokens.asyncEach(async (token, i) => {
            const { duration, expires, rate } = await pool.getPriceRateCache(token);
            expect(rate).to.equal(tokenRates[i]);
            expect(duration).to.equal(priceRateCacheDurations[i]);
            expect(expires).to.be.at.least(deployedAt.add(priceRateCacheDurations[i]));
          });
        });

        it('sets no rate cache duration for BPT', async () => {
          const { duration, expires, rate } = await pool.getPriceRateCache(pool.address);

          expect(rate).to.be.zero;
          expect(duration).to.be.zero;
          expect(expires).to.be.zero;
        });

        it('sets the scaling factors', async () => {
          const scalingFactors = (await pool.getScalingFactors()).map((sf) => sf.toString());

          // It also includes the BPT scaling factor
          expect(scalingFactors).to.have.lengthOf(numberOfTokens + 1);
          expect(scalingFactors).to.include(fp(1).toString());
          for (const rate of tokenRates) expect(scalingFactors).to.include(rate.toString());
        });

        it('sets BPT index correctly', async () => {
          const bpt = new Token('BPT', 'BPT', 18, pool.instance);
          const allTokens = new TokenList([...tokens.tokens, bpt]).sort();
          const expectedIndex = allTokens.indexOf(bpt);
          expect(await pool.getBptIndex()).to.be.equal(expectedIndex);
        });
      });

      context('when the creation fails', () => {
        it('reverts if there are repeated tokens', async () => {
          const badTokens = new TokenList(Array(numberOfTokens).fill(tokens.first));

          await expect(deployPool({ tokens: badTokens })).to.be.revertedWith('UNSORTED_ARRAY');
        });

        it('reverts if the cache durations do not match the tokens length', async () => {
          const priceRateCacheDurations = [1];

          await expect(deployPool({ priceRateCacheDurations })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });

        it('reverts if the rate providers do not match the tokens length', async () => {
          const rateProviders = [ZERO_ADDRESS];

          await expect(deployPool({ rateProviders })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });

        it('reverts if the swap fee is too high', async () => {
          const swapFeePercentage = fp(0.1).add(1);

          await expect(deployPool({ swapFeePercentage })).to.be.revertedWith('MAX_SWAP_FEE_PERCENTAGE');
        });

        it('reverts if amplification coefficient is too high', async () => {
          const amplificationParameter = bn(5001);

          await expect(deployPool({ amplificationParameter })).to.be.revertedWith('MAX_AMP');
        });

        it('reverts if amplification coefficient is too low', async () => {
          const amplificationParameter = bn(0);

          await expect(deployPool({ amplificationParameter })).to.be.revertedWith('MIN_AMP');
        });
      });
    });

    describe('initialize', () => {
      let initialBalances: BigNumberish[] = [];

      sharedBeforeEach('deploy pool', async () => {
        await deployPool();
        initialBalances = Array.from({ length: numberOfTokens + 1 }, (_, i) => (i == bptIndex ? 0 : fp(1 - i / 10)));
        await tokens.mint({ to: owner, amount: fp(10) });
        await tokens.approve({ from: owner, to: pool.vault, amount: fp(10) });
      });

      context('when not initialized', () => {
        context('when not paused', () => {
          it('transfers the initial balances to the vault', async () => {
            const previousBalances = await tokens.balanceOf(pool.vault);

            await pool.init({ initialBalances, from: owner });

            const currentBalances = await tokens.balanceOf(pool.vault);
            currentBalances.forEach((currentBalance, i) => {
              const initialBalanceIndex = i < bptIndex ? i : i + 1;
              const expectedBalance = previousBalances[i].add(initialBalances[initialBalanceIndex]);
              expect(currentBalance).to.be.equal(expectedBalance);
            });
          });

          it('mints the max amount of BPT', async () => {
            await pool.init({ initialBalances, from: owner });

            expect(await pool.totalSupply()).to.be.equal(MAX_UINT112);
          });

          it('mints the minimum BPT to the address zero', async () => {
            const minimumBpt = await pool.instance.getMinimumBpt();

            await pool.init({ initialBalances, from: owner });

            expect(await pool.balanceOf(ZERO_ADDRESS)).to.be.equal(minimumBpt);
          });

          it('mints the invariant amount of BPT to the recipient', async () => {
            const invariant = await pool.estimateInvariant(initialBalances);

            await pool.init({ recipient, initialBalances, from: owner });

            expect(await pool.balanceOf(recipient)).to.be.equalWithError(invariant, 0.4);
          });

          it('mints the rest of the BPT to the vault', async () => {
            const invariant = await pool.estimateInvariant(initialBalances);
            const minimumBpt = await pool.instance.getMinimumBpt();

            const { amountsIn, dueProtocolFeeAmounts } = await pool.init({ recipient, initialBalances, from: owner });

            const expectedBPT = MAX_UINT112.sub(minimumBpt).sub(invariant);
            expect(await pool.balanceOf(pool.vault)).to.be.equalWithError(expectedBPT, 0.0001);

            expect(dueProtocolFeeAmounts).to.be.zeros;
            for (let i = 0; i < amountsIn.length; i++) {
              i === bptIndex
                ? expect(amountsIn[i]).to.be.equalWithError(MAX_UINT112.sub(invariant), 0.0001)
                : expect(amountsIn[i]).to.be.equal(initialBalances[i]);
            }
          });
        });

        context('when paused', () => {
          sharedBeforeEach('pause pool', async () => {
            await pool.pause();
          });

          it('reverts', async () => {
            await expect(pool.init({ initialBalances })).to.be.revertedWith('PAUSED');
          });
        });
      });

      context('when it was already initialized', () => {
        sharedBeforeEach('init pool', async () => {
          await pool.init({ initialBalances, from: owner });
        });

        it('reverts', async () => {
          await expect(pool.init({ initialBalances, from: owner })).to.be.revertedWith('UNHANDLED_BY_PHANTOM_POOL');
        });
      });
    });
  }
});
