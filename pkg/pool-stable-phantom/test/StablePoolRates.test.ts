import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describe.only('StablePoolRates', () => {
  let admin: SignerWithAddress;
  let vault: Vault;

  sharedBeforeEach('setup signers', async () => {
    [, admin] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault', async () => {
    vault = await Vault.create({ admin });
  });

  context('for a 1 token pool', () => {
    it('reverts', async () => {
      const tokens = await TokenList.create(1);
      await expect(
        deploy('MockStablePoolRates', {
          args: [
            vault.address,
            tokens.addresses,
            tokens.map(() => ZERO_ADDRESS),
            tokens.map(() => 0),
            tokens.map(() => false),
          ],
        })
      ).to.be.revertedWith('MIN_TOKENS');
    });
  });

  context('for a 2 token pool', () => {
    itBehavesAsStablePoolRates(2);
  });

  context('for a 3 token pool', () => {
    itBehavesAsStablePoolRates(3);
  });

  context('for a 4 token pool', () => {
    itBehavesAsStablePoolRates(4);
  });

  context('for a 5 token pool', () => {
    itBehavesAsStablePoolRates(5);
  });

  context('for a 6 token pool', () => {
    it('reverts', async () => {
      const tokens = await TokenList.create(6, { sorted: true });
      await expect(
        deploy('MockStablePoolRates', {
          args: [
            vault.address,
            tokens.addresses,
            tokens.map(() => ZERO_ADDRESS),
            tokens.map(() => 0),
            tokens.map(() => false),
          ],
        })
      ).to.be.revertedWith('MAX_TOKENS');
    });
  });

  function itBehavesAsStablePoolRates(numberOfTokens: number): void {
    let pool: Contract, tokens: TokenList;
    let bptIndex: number;

    sharedBeforeEach('deploy tokens', async () => {
      tokens = await TokenList.create(numberOfTokens, { sorted: true, varyDecimals: true });
    });

    let rateProviders: string[] = [];
    let tokenRateCacheDurations: BigNumber[] = [];
    let exemptFromYieldProtocolFeeFlags: boolean[] = [];

    async function deployPool(
      tokens: TokenList,
      numRateProviders = tokens.length,
      numTokenCacheDurations = tokens.length,
      numExemptFlags = tokens.length
    ): Promise<void> {
      const newRateProviders = [];
      for (let i = 0; i < numRateProviders; i++) {
        // Give every even token a rate provider.
        const hasRateProvider = i % 2 == 0;
        newRateProviders[i] = hasRateProvider ? (await deploy('v2-pool-utils/MockRateProvider')).address : ZERO_ADDRESS;
      }

      const newExemptFromYieldProtocolFeeFlags = [];
      for (let i = 0; i < numExemptFlags; i++) {
        // Set every 4th token as yield exempt. This ensure we get a mix of exempt and non-exempt tokens.
        newExemptFromYieldProtocolFeeFlags[i] = newRateProviders[i] !== ZERO_ADDRESS && i % 4 == 0;
      }

      tokenRateCacheDurations = Array.from({ length: numTokenCacheDurations }, () => bn(0));

      pool = await deploy('MockStablePoolRates', {
        args: [
          vault.address,
          tokens.addresses,
          newRateProviders,
          tokenRateCacheDurations,
          newExemptFromYieldProtocolFeeFlags,
        ],
      });
      bptIndex = (await pool.getBptIndex()).toNumber();
      rateProviders = newRateProviders;
      exemptFromYieldProtocolFeeFlags = newExemptFromYieldProtocolFeeFlags;
    }

    sharedBeforeEach('deploy pool', async () => {
      await deployPool(tokens);
    });

    describe('constructor', () => {
      context('when the constructor succeeds', () => {
        it('emits TokenRateCacheUpdated events for each token with a rate provider', async () => {
          const deploymentTx = await pool.deployTransaction.wait();
          for (const [index, token] of tokens.tokens.entries()) {
            if (rateProviders[index] !== ZERO_ADDRESS) {
              expectEvent.inIndirectReceipt(deploymentTx, pool.interface, 'TokenRateCacheUpdated', {
                token: token.address,
                rate: fp(1),
              });
            }
          }
        });

        it('emits TokenRateProviderSet events for each token with a rate provider', async () => {
          const deploymentTx = await pool.deployTransaction.wait();
          for (const [index, token] of tokens.tokens.entries()) {
            if (rateProviders[index] !== ZERO_ADDRESS) {
              expectEvent.inIndirectReceipt(deploymentTx, pool.interface, 'TokenRateProviderSet', {
                token: token.address,
                provider: rateProviders[index],
                cacheDuration: tokenRateCacheDurations[index],
              });
            }
          }
        });
      });

      context('when the constructor fails', () => {
        it('reverts if the rate providers do not match the tokens length', async () => {
          await expect(deployPool(tokens, tokens.length + 1)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });

        it('reverts if the cache durations do not match the tokens length', async () => {
          await expect(deployPool(tokens, tokens.length, tokens.length + 1)).to.be.revertedWith(
            'INPUT_LENGTH_MISMATCH'
          );
        });
      });
    });

    describe('scaling factors', () => {
      describe('getScalingFactors', () => {
        it('returns the correct scaling factors', async () => {
          const expectedScalingFactors = tokens.map((token) => fp(1).mul(bn(10).pow(18 - token.decimals)));
          expectedScalingFactors.splice(bptIndex, 0, fp(1));

          const scalingFactors: BigNumber[] = await pool.getScalingFactors();

          // It also includes the BPT scaling factor
          expect(scalingFactors).to.have.lengthOf(numberOfTokens + 1);
          expect(scalingFactors).to.be.deep.equal(expectedScalingFactors);
        });
      });
    });
  }
});
