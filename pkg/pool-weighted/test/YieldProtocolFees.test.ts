import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { random } from 'lodash';
import { toNormalizedWeights } from '@balancer-labs/balancer-js';
import { calculateInvariant } from '@balancer-labs/v2-helpers/src/models/pools/weighted/math';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ProtocolFee } from '@balancer-labs/v2-helpers/src/models/vault/types';

describe('YieldProtocolFees', () => {
  let vault: Vault;
  let pool: Contract;
  let rateProviders: Contract[];

  const NAME = 'Balancer Pool Token';
  const SYMBOL = 'BPT';
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const PROTOCOL_YIELD_FEE_PERCENTAGE = fp(0.5);

  before('deploy lib', async () => {
    vault = await Vault.create();

    if (!vault.admin) throw new Error('Vault has no admin');
    const protocolFeesProvider = vault.protocolFeesProvider;
    const action = await actionId(protocolFeesProvider, 'setFeeTypePercentage');
    await vault.grantPermissionsGlobally([action], vault.admin);
    await protocolFeesProvider
      .connect(vault.admin)
      .setFeeTypePercentage(ProtocolFee.YIELD, PROTOCOL_YIELD_FEE_PERCENTAGE);
  });

  async function deployPool(numTokens: number) {
    const tokens = await TokenList.create(numTokens, { sorted: true });
    rateProviders = await tokens.asyncMap(async () => await deploy('v2-pool-utils/MockRateProvider'));
    const rateProviderAddresses = rateProviders.map((provider) => provider.address);

    pool = await deploy('MockYieldProtocolFees', {
      args: [
        vault.address,
        vault.protocolFeesProvider.address,
        NAME,
        SYMBOL,
        tokens.addresses,
        rateProviderAddresses,
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
          const rateProviderAddresses = rateProviders.map((provider) => provider.address);
          const providers = await pool.getRateProviders();

          expect(providers).to.deep.eq(rateProviderAddresses);
        });
      });

      describe('getRateProduct', () => {
        let rates: BigNumber[];

        sharedBeforeEach(async () => {
          rates = rateProviders.map(() => fp(random(1, 5)));

          for (const [index, provider] of rateProviders.entries()) {
            await provider.mockRate(rates[index]);
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

        context('when first called', () => {
          sharedBeforeEach('check athRateProduct is uninitialized', async () => {
            expect(await pool.getATHRateProduct()).to.be.eq(0);
          });

          it('initializes athRateProduct', async () => {
            await pool.getYieldProtocolFee(normalizedWeights, fp(1));

            // All rate providers return 1 by default so the product is 1.
            const expectedRateProduct = fp(1);
            expect(await pool.getATHRateProduct()).to.be.almostEqual(expectedRateProduct, 0.0001);
          });

          it('returns zero', async () => {
            const protocolFees = await pool.callStatic.getYieldProtocolFee(normalizedWeights, fp(1));

            expect(protocolFees).to.be.eq(0);
          });
        });

        context('on subsequent calls', () => {
          sharedBeforeEach('initialize athRateProduct', async () => {
            await pool.getYieldProtocolFee(normalizedWeights, fp(1));
          });

          context('when rate product has increased', () => {
            let rates: BigNumber[];
            sharedBeforeEach('set rates', async () => {
              rates = rateProviders.map(() => fp(random(1, 2)));

              for (const [index, provider] of rateProviders.entries()) {
                await provider.mockRate(rates[index]);
              }
            });

            it('it updates athRateProduct', async () => {
              await pool.getYieldProtocolFee(normalizedWeights, fp(1));

              const expectedRateProduct = calculateInvariant(rates, normalizedWeights);
              expect(await pool.getATHRateProduct()).to.be.almostEqual(expectedRateProduct, 0.0001);
            });

            it('it returns the expected amount of protocol fees', async () => {
              const athRateProduct = await pool.getATHRateProduct();

              const currentSupply = fp(random(0, 5));
              const protocolFees = await pool.callStatic.getYieldProtocolFee(normalizedWeights, currentSupply);

              const rateProductGrowth = calculateInvariant(rates, normalizedWeights).mul(fp(1)).div(athRateProduct);
              const yieldPercentage = fp(1).sub(fp(1).mul(fp(1)).div(rateProductGrowth));
              const protocolYieldFeesPercentage = yieldPercentage.mul(PROTOCOL_YIELD_FEE_PERCENTAGE).div(fp(1));

              const expectedProtocolFees = currentSupply
                .mul(protocolYieldFeesPercentage)
                .div(fp(1).sub(protocolYieldFeesPercentage));
              expect(protocolFees).to.be.almostEqual(expectedProtocolFees, 0.0001);
            });
          });

          context('when rate product has decreased', () => {
            let rates: BigNumber[];
            sharedBeforeEach('set rates', async () => {
              rates = rateProviders.map(() => fp(random(0.5, 1)));

              for (const [index, provider] of rateProviders.entries()) {
                await provider.mockRate(rates[index]);
              }
            });

            it("it doesn't change athRateProduct", async () => {
              const expectedATHRateProduct = await pool.getATHRateProduct();
              await pool.getYieldProtocolFee(normalizedWeights, fp(1));

              expect(await pool.getATHRateProduct()).to.be.eq(expectedATHRateProduct);
            });

            it('it returns zero', async () => {
              const protocolFees = await pool.callStatic.getYieldProtocolFee(normalizedWeights, fp(1));

              expect(protocolFees).to.be.eq(0);
            });
          });
        });
      });
    });
  }
});
