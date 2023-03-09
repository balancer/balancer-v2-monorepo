import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { random, range } from 'lodash';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { fp, fpDiv, fpMul, FP_100_PCT, FP_ONE } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { toNormalizedWeights } from '@balancer-labs/balancer-js';
import { calculateInvariant } from '@balancer-labs/v2-helpers/src/models/pools/weighted/math';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ProtocolFee } from '@balancer-labs/v2-helpers/src/models/vault/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

const randomFloat = (min: number, max: number) => random(min, max, true);

describe('WeightedPoolProtocolFees (Yield)', () => {
  let vault: Vault;
  let pool: Contract;
  let rateProviders: (Contract | string)[];

  const NAME = 'Balancer Pool Token';
  const SYMBOL = 'BPT';
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const PROTOCOL_YIELD_FEE_PERCENTAGE = fp(0.5);

  before('deploy lib', async () => {
    vault = await Vault.create();

    if (!vault.admin) throw new Error('Vault has no admin');
    const protocolFeesProvider = vault.protocolFeesProvider;
    const action = await actionId(protocolFeesProvider, 'setFeeTypePercentage');
    await vault.grantPermissionGlobally(action, vault.admin);
    await protocolFeesProvider
      .connect(vault.admin)
      .setFeeTypePercentage(ProtocolFee.YIELD, PROTOCOL_YIELD_FEE_PERCENTAGE);
  });

  async function deployPool(numTokens: number, { payYieldFees } = { payYieldFees: true }) {
    const tokens = await TokenList.create(numTokens, { sorted: true });
    if (payYieldFees) {
      rateProviders = await tokens.asyncMap(() => deploy('v2-pool-utils/MockRateProvider'));
    } else {
      rateProviders = tokens.map(() => ZERO_ADDRESS);
    }

    pool = await deploy('MockWeightedPoolProtocolFees', {
      args: [
        vault.address,
        vault.protocolFeesProvider.address,
        NAME,
        SYMBOL,
        tokens.addresses,
        TypesConverter.toAddresses(rateProviders),
        tokens.map(() => ZERO_ADDRESS),
        POOL_SWAP_FEE_PERCENTAGE,
        0,
        0,
        ZERO_ADDRESS,
      ],
    });
  }

  for (let numTokens = 2; numTokens <= 8; numTokens++) {
    describe(`for a ${numTokens} token pool`, () => {
      sharedBeforeEach('deploy pool', async () => {
        await deployPool(numTokens);
      });

      describe('constructor', () => {
        it('sets the rate providers', async () => {
          const rateProviderAddresses = TypesConverter.toAddresses(rateProviders);
          const providers = await pool.getRateProviders();

          expect(providers).to.deep.eq(rateProviderAddresses);
        });
      });

      describe('getYieldFeeExemption', () => {
        it('returns the expected value', async () => {
          // We force a check of this case as it would otherwise only occur once in every 2**numTokens attempts.
          const zeroRateProviders = Array.from({ length: numTokens }, () => ZERO_ADDRESS);
          expect(await pool.getYieldFeeExemption(zeroRateProviders)).to.be.true;

          for (let i = 0; i < 10; i++) {
            // Randomly create a set of rate providers which are a mix of real or zero addresses.
            const rateProviders = Array.from({ length: numTokens }, () =>
              random(0, 1.0) < 0.5 ? ANY_ADDRESS : ZERO_ADDRESS
            );

            // We expect the pool to be exempt if every rate provider is the zero address
            const isExempt = rateProviders.every((rateProvider) => rateProvider === ZERO_ADDRESS);

            expect(await pool.getYieldFeeExemption(rateProviders)).to.be.eq(isExempt);
          }
        });
      });

      describe('getRateProduct', () => {
        let rates: BigNumber[];

        sharedBeforeEach(async () => {
          rates = rateProviders.map(() => fp(randomFloat(1, 5)));

          for (const [index, provider] of rateProviders.entries()) {
            if (typeof provider !== 'string') await provider.mockRate(rates[index]);
          }
        });

        it("returns the weighted product of the tokens' rates", async () => {
          const normalizedWeights = toNormalizedWeights(range(numTokens).map(() => fp(random(1, 5))));
          const expectedRateProduct = calculateInvariant(rates, normalizedWeights);

          const rateProduct = await pool.getRateProduct(normalizedWeights);
          expect(rateProduct).to.be.almostEqual(expectedRateProduct, 0.0001);
        });
      });

      describe('getYieldProtocolFee', () => {
        let normalizedWeights: BigNumber[];
        sharedBeforeEach('choose weights', async () => {
          normalizedWeights = toNormalizedWeights(rateProviders.map(() => fp(random(1, 5))));
        });

        context('when pool pays fees on yield', () => {
          sharedBeforeEach('initialize athRateProduct', async () => {
            const initialRateProduct = await pool.getRateProduct(toNormalizedWeights(rateProviders.map(() => FP_ONE)));
            await pool.updateATHRateProduct(initialRateProduct);
          });

          context('when rate product has increased', () => {
            let rates: BigNumber[];
            sharedBeforeEach('set rates', async () => {
              rates = rateProviders.map(() => fp(randomFloat(1, 2)));

              for (const [index, provider] of rateProviders.entries()) {
                if (typeof provider !== 'string') await provider.mockRate(rates[index]);
              }
            });

            it('it returns the updated athRateProduct', async () => {
              const { athRateProduct } = await pool.getYieldProtocolFee(normalizedWeights, fp(1));

              const expectedRateProduct = calculateInvariant(rates, normalizedWeights);
              expect(athRateProduct).to.be.almostEqual(expectedRateProduct, 0.0001);
            });

            it('it returns the expected amount of protocol fees', async () => {
              const athRateProduct = await pool.getATHRateProduct();

              const currentSupply = fp(randomFloat(1, 5));
              const { yieldProtocolFees } = await pool.getYieldProtocolFee(normalizedWeights, currentSupply);

              const rateProductGrowth = fpDiv(calculateInvariant(rates, normalizedWeights), athRateProduct);
              const yieldPercentage = FP_100_PCT.sub(fpDiv(FP_ONE, rateProductGrowth));
              const protocolYieldFeesPercentage = fpMul(yieldPercentage, PROTOCOL_YIELD_FEE_PERCENTAGE);

              const expectedProtocolFees = currentSupply
                .mul(protocolYieldFeesPercentage)
                .div(FP_100_PCT.sub(protocolYieldFeesPercentage));
              expect(yieldProtocolFees).to.be.almostEqual(expectedProtocolFees, 0.0001);
            });
          });

          context('when rate product has decreased', () => {
            let rates: BigNumber[];
            sharedBeforeEach('set rates', async () => {
              rates = rateProviders.map(() => fp(random(0.5, 1)));

              for (const [index, provider] of rateProviders.entries()) {
                if (typeof provider !== 'string') await provider.mockRate(rates[index]);
              }
            });

            it('it returns zero value for athRateProduct', async () => {
              const { athRateProduct } = await pool.getYieldProtocolFee(normalizedWeights, fp(1));

              expect(athRateProduct).to.be.eq(0);
            });

            it('it returns zero', async () => {
              const { yieldProtocolFees } = await pool.getYieldProtocolFee(normalizedWeights, fp(1));

              expect(yieldProtocolFees).to.be.eq(0);
            });
          });
        });

        context('when pool does not pay fees on yield', () => {
          sharedBeforeEach('deploy fee-exempt pool', async () => {
            await deployPool(numTokens, { payYieldFees: false });
          });

          sharedBeforeEach('check athRateProduct is uninitialized', async () => {
            expect(await pool.getATHRateProduct()).to.be.eq(0);
          });

          it('returns zero protocol fees', async () => {
            const { yieldProtocolFees } = await pool.getYieldProtocolFee(normalizedWeights, fp(1));

            expect(yieldProtocolFees).to.be.eq(0);
          });

          it('returns zero value for athRateProduct', async () => {
            const { athRateProduct } = await pool.getYieldProtocolFee(normalizedWeights, fp(1));

            expect(athRateProduct).to.be.eq(0);
          });
        });
      });
    });
  }
});
