import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('PoolRegistrationLib', function () {
  let vault: Vault;
  let lib: Contract;
  let tokens: TokenList;

  const NUM_TOKENS = 2;

  sharedBeforeEach(async () => {
    vault = await Vault.create();
    lib = await deploy('MockPoolRegistrationLib');
  });

  sharedBeforeEach('deploy tokens', async () => {
    tokens = await TokenList.create(NUM_TOKENS, { sorted: true });
  });

  async function registerPool(specialization: PoolSpecialization, assetManagers?: string[]): Promise<string> {
    const tx =
      assetManagers !== undefined
        ? await lib.registerPoolWithAssetManagers(vault.address, specialization, tokens.addresses, assetManagers)
        : await lib.registerPool(vault.address, specialization, tokens.addresses);
    const event = expectEvent.inIndirectReceipt(await tx.wait(), vault.interface, 'PoolRegistered');
    return event.args.poolId;
  }

  it('registers the pool in the vault', async () => {
    const poolId = await registerPool(PoolSpecialization.GeneralPool);

    const { address: poolAddress } = await vault.getPool(poolId);
    expect(poolAddress).to.equal(lib.address);
  });

  it('registers the pool with the correct specialization', async () => {
    const specializations: (keyof typeof PoolSpecialization)[] = ['GeneralPool', 'MinimalSwapInfoPool', 'TwoTokenPool'];
    for (const specialization of specializations) {
      const poolId = await registerPool(PoolSpecialization[specialization]);
      const { specialization: poolSpecialization } = await vault.getPool(poolId);
      expect(poolSpecialization).to.equal(PoolSpecialization[specialization]);
    }
  });

  it('registers the tokens correctly', async () => {
    const poolId = await registerPool(PoolSpecialization.GeneralPool);
    const { tokens: poolTokens } = await vault.getPoolTokens(poolId);
    expect(poolTokens).to.deep.eq(tokens.addresses);
  });

  it('reverts if the tokens are not sorted', async () => {
    await expect(
      lib.registerPool(vault.address, PoolSpecialization.GeneralPool, tokens.addresses.reverse())
    ).to.be.revertedWith('UNSORTED_ARRAY');
  });

  context('when passing asset managers', () => {
    it('registers the asset managers correctly', async () => {
      const assetManagers = tokens.map(() => ethers.Wallet.createRandom().address);
      const poolId = await registerPool(PoolSpecialization.GeneralPool, assetManagers);

      await tokens.asyncEach(async (token: Token, i: number) => {
        const { assetManager } = await vault.getPoolTokenInfo(poolId, token);
        expect(assetManager).to.equal(assetManagers[i]);
      });
    });
  });

  context('when not passing asset managers', () => {
    it("doesn't register asset managers", async () => {
      const poolId = await registerPool(PoolSpecialization.GeneralPool);

      await tokens.asyncEach(async (token: Token) => {
        const { assetManager } = await vault.getPoolTokenInfo(poolId, token);
        expect(assetManager).to.equal(ZERO_ADDRESS);
      });
    });
  });
});
