import { expect } from 'chai';
import { Contract } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('YieldProtocolFees', () => {
  let vault: Vault;
  let pool: Contract;
  let rateProviders: string[];

  const NAME = 'Balancer Pool Token';
  const SYMBOL = 'BPT';
  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  before('deploy lib', async () => {
    vault = await Vault.create();
  });

  async function deployPool(numTokens: number) {
    const tokens = await TokenList.create(numTokens, { sorted: true });
    rateProviders = await tokens.asyncMap(async () => (await deploy('v2-pool-utils/MockRateProvider')).address);

    pool = await deploy('MockYieldProtocolFees', {
      args: [
        vault.address,
        NAME,
        SYMBOL,
        tokens.addresses,
        rateProviders,
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
          const providers = await pool.getRateProviders();
          expect(providers).to.deep.eq(rateProviders);
        });
      });
    });
  }
});
