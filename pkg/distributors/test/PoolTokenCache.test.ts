import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { PoolSpecialization } from '@balancer-labs/balancer-js';

describe('PoolTokenCache', () => {
  let other: SignerWithAddress;

  let vault: Contract;
  let pool: Contract;
  let poolId: string;
  let tokens: TokenList;

  let cache: Contract;

  before('get signers', async () => {
    [, other] = await ethers.getSigners();
  });

  sharedBeforeEach('set up vault and pool', async () => {
    tokens = await TokenList.create(['DAI', 'MKR', 'SNX', 'BAT']);

    vault = await deploy('v2-vault/Vault', { args: [ZERO_ADDRESS, ZERO_ADDRESS, 0, 0] });

    pool = await deploy('v2-vault/MockPool', { args: [vault.address, PoolSpecialization.GeneralPool] });
    poolId = await pool.getPoolId();

    cache = await deploy('PoolTokenCache', { args: [vault.address] });
  });

  context('with registered tokens', () => {
    sharedBeforeEach('register tokens', async () => {
      await pool.registerTokens([tokens.DAI.address, tokens.MKR.address], [ZERO_ADDRESS, ZERO_ADDRESS]);
    });

    context('with outdated cache', () => {
      it('does not report registered tokens', async () => {
        expect(await cache.poolHasToken(poolId, tokens.DAI.address)).to.equal(false);
        expect(await cache.poolHasToken(poolId, tokens.MKR.address)).to.equal(false);

        expect(await cache.poolTokensLength(poolId)).to.equal(0);
      });
    });

    context('with updated cache', () => {
      sharedBeforeEach('update cache', async () => {
        await cache.connect(other).savePoolTokenSet(poolId);
      });

      it('reports registered tokens', async () => {
        expect(await cache.poolHasToken(poolId, tokens.DAI.address)).to.equal(true);
        expect(await cache.poolHasToken(poolId, tokens.MKR.address)).to.equal(true);

        expect(await cache.poolTokensLength(poolId)).to.equal(2);
        expect(await cache.poolTokenAtIndex(poolId, 0)).to.equal(tokens.DAI.address);
        expect(await cache.poolTokenAtIndex(poolId, 1)).to.equal(tokens.MKR.address);
      });

      context('with updated pool tokens', () => {
        sharedBeforeEach('update pool tokens', async () => {
          await pool.deregisterTokens([tokens.DAI.address, tokens.MKR.address]);

          await pool.registerTokens(
            [tokens.BAT.address, tokens.SNX.address, tokens.MKR.address],
            [ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS]
          );
        });

        it('reports previous tokens', async () => {
          expect(await cache.poolHasToken(poolId, tokens.DAI.address)).to.equal(true);
          expect(await cache.poolHasToken(poolId, tokens.MKR.address)).to.equal(true);

          expect(await cache.poolHasToken(poolId, tokens.BAT.address)).to.equal(false);
          expect(await cache.poolHasToken(poolId, tokens.SNX.address)).to.equal(false);

          expect(await cache.poolTokensLength(poolId)).to.equal(2);
          expect(await cache.poolTokenAtIndex(poolId, 0)).to.equal(tokens.DAI.address);
          expect(await cache.poolTokenAtIndex(poolId, 1)).to.equal(tokens.MKR.address);
        });

        context('with re-updated cache', () => {
          sharedBeforeEach('update cache', async () => {
            await cache.connect(other).savePoolTokenSet(poolId);
          });

          it('reports new tokens', async () => {
            expect(await cache.poolHasToken(poolId, tokens.DAI.address)).to.equal(false);

            expect(await cache.poolHasToken(poolId, tokens.BAT.address)).to.equal(true);
            expect(await cache.poolHasToken(poolId, tokens.SNX.address)).to.equal(true);
            expect(await cache.poolHasToken(poolId, tokens.MKR.address)).to.equal(true);

            expect(await cache.poolTokensLength(poolId)).to.equal(3);
            expect(await cache.poolTokenAtIndex(poolId, 0)).to.equal(tokens.BAT.address);
            expect(await cache.poolTokenAtIndex(poolId, 1)).to.equal(tokens.SNX.address);
            expect(await cache.poolTokenAtIndex(poolId, 2)).to.equal(tokens.MKR.address);
          });
        });
      });
    });
  });
});
