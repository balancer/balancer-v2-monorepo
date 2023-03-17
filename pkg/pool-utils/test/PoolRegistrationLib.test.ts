import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { randomAddress, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

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

  async function registerComposablePool(specialization: PoolSpecialization, assetManagers: string[]): Promise<string> {
    const tx = await lib.registerComposablePool(vault.address, specialization, tokens.addresses, assetManagers);
    const event = expectEvent.inIndirectReceipt(await tx.wait(), vault.interface, 'PoolRegistered');
    return event.args.poolId;
  }

  describe('registerPool', () => {
    it('registers the pool in the vault', async () => {
      const poolId = await registerPool(PoolSpecialization.GeneralPool);

      const { address: poolAddress } = await vault.getPool(poolId);
      expect(poolAddress).to.equal(lib.address);
    });

    it('registers the pool with the correct specialization', async () => {
      const specializations: (keyof typeof PoolSpecialization)[] = [
        'GeneralPool',
        'MinimalSwapInfoPool',
        'TwoTokenPool',
      ];
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
      context("when the token and asset managers arrays' lengths are mismatched", () => {
        it('reverts', async () => {
          const tooManyAssetManagers = Array.from(
            { length: tokens.length + 1 },
            () => ethers.Wallet.createRandom().address
          );

          await expect(
            lib.registerPoolWithAssetManagers(
              vault.address,
              PoolSpecialization.GeneralPool,
              tokens.addresses,
              tooManyAssetManagers
            )
          ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });
      });

      context("when the token and asset managers arrays' lengths match", () => {
        it('registers the asset managers correctly', async () => {
          const assetManagers = tokens.map(() => ethers.Wallet.createRandom().address);
          const poolId = await registerPool(PoolSpecialization.GeneralPool, assetManagers);

          await tokens.asyncEach(async (token: Token, i: number) => {
            const { assetManager } = await vault.getPoolTokenInfo(poolId, token);
            expect(assetManager).to.equal(assetManagers[i]);
          });
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

  describe('registerComposablePool', () => {
    let assetManagers: string[];

    sharedBeforeEach(async () => {
      assetManagers = Array.from({ length: tokens.length }, () => ethers.Wallet.createRandom().address);
    });

    it('registers the pool in the vault', async () => {
      const poolId = await registerComposablePool(PoolSpecialization.GeneralPool, assetManagers);

      const { address: poolAddress } = await vault.getPool(poolId);
      expect(poolAddress).to.equal(lib.address);
    });

    it('registers the pool with the correct specialization', async () => {
      const specializations: (keyof typeof PoolSpecialization)[] = [
        'GeneralPool',
        'MinimalSwapInfoPool',
        'TwoTokenPool',
      ];
      for (const specialization of specializations) {
        const poolId = await registerPool(PoolSpecialization[specialization]);
        const { specialization: poolSpecialization } = await vault.getPool(poolId);
        expect(poolSpecialization).to.equal(PoolSpecialization[specialization]);
      }
    });

    it('registers the tokens correctly', async () => {
      const poolId = await registerComposablePool(PoolSpecialization.GeneralPool, assetManagers);
      const { tokens: poolTokens } = await vault.getPoolTokens(poolId);

      // The library mock is fulfilling the role of the Pool in this test.
      const composableTokens = [lib.address, ...tokens.addresses];

      expect(poolTokens).to.deep.eq(composableTokens);
    });

    it('reverts if the tokens are not sorted', async () => {
      await expect(
        lib.registerComposablePool(
          vault.address,
          PoolSpecialization.GeneralPool,
          tokens.addresses.reverse(),
          assetManagers
        )
      ).to.be.revertedWith('UNSORTED_ARRAY');
    });

    it("reverts if the pool's BPT is included as one of the tokens", async () => {
      const tokensWithBPT = [lib.address, ...tokens.addresses];
      tokensWithBPT.sort();
      const assetManagersWithBPT = [ZERO_ADDRESS, ...assetManagers];

      await expect(
        lib.registerComposablePool(vault.address, PoolSpecialization.GeneralPool, tokensWithBPT, assetManagersWithBPT)
      ).to.be.revertedWith('TOKEN_ALREADY_REGISTERED');
    });

    context("when the token and asset managers arrays' lengths are mismatched", () => {
      it('reverts', async () => {
        const tooManyAssetManagers = Array.from(
          { length: tokens.length + 1 },
          () => ethers.Wallet.createRandom().address
        );

        await expect(
          lib.registerComposablePool(
            vault.address,
            PoolSpecialization.GeneralPool,
            tokens.addresses,
            tooManyAssetManagers
          )
        ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
      });
    });

    context("when the token and asset managers arrays' lengths match", () => {
      it('registers the asset managers correctly', async () => {
        const poolId = await registerComposablePool(PoolSpecialization.GeneralPool, assetManagers);

        // Check the asset manager of the BPT token separately.`
        const { assetManager: bptAssetManager } = await vault.getPoolTokenInfo(poolId, lib.address);
        expect(bptAssetManager).to.equal(ZERO_ADDRESS);

        await tokens.asyncEach(async (token: Token, i: number) => {
          const { assetManager } = await vault.getPoolTokenInfo(poolId, token);
          expect(assetManager).to.equal(assetManagers[i]);
        });
      });
    });
  });

  describe('registerToken', () => {
    let poolId: string;

    sharedBeforeEach(async () => {
      poolId = await registerPool(PoolSpecialization.GeneralPool);
    });

    it('registers a new token', async () => {
      const token = randomAddress();
      const assetManager = randomAddress();
      await lib.registerToken(vault.address, poolId, token, assetManager);

      const { tokens: actualTokens } = await vault.getPoolTokens(poolId);
      expect(actualTokens).to.include(token);
    });

    it('registers the asset manager', async () => {
      const token = randomAddress();
      const assetManager = randomAddress();
      await lib.registerToken(vault.address, poolId, token, assetManager);

      const { assetManager: actualAssetManager } = await vault.getPoolTokenInfo(poolId, token);
      expect(actualAssetManager).to.equal(assetManager);
    });
  });

  describe('deregisterToken', () => {
    let poolId: string;

    sharedBeforeEach(async () => {
      poolId = await registerPool(PoolSpecialization.GeneralPool);
    });

    it('deregisters a token', async () => {
      const token = tokens.first.address;

      await lib.deregisterToken(vault.address, poolId, token);

      const { tokens: actualTokens } = await vault.getPoolTokens(poolId);
      expect(actualTokens).to.not.include(token);
    });
  });
});
