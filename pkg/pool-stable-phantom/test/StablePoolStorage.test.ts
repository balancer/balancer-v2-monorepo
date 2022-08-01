import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePhantomPool from '@balancer-labs/v2-helpers/src/models/pools/stable-phantom/StablePhantomPool';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';

describe('StablePoolStorage', () => {
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
      await expect(StablePhantomPool.create({ tokens })).to.be.revertedWith('MIN_TOKENS');
    });
  });

  context('for a 2 token pool', () => {
    itBehavesAsStablePoolStorage(2);
  });

  context('for a 3 token pool', () => {
    itBehavesAsStablePoolStorage(3);
  });

  context('for a 4 token pool', () => {
    itBehavesAsStablePoolStorage(4);
  });

  context('for a 5 token pool', () => {
    itBehavesAsStablePoolStorage(5);
  });

  context('for a 6 token pool', () => {
    it('reverts', async () => {
      const tokens = await TokenList.create(6, { sorted: true });
      await expect(StablePhantomPool.create({ tokens })).to.be.revertedWith('MAX_TOKENS');
    });
  });

  function itBehavesAsStablePoolStorage(numberOfTokens: number): void {
    let pool: Contract, tokens: TokenList;

    sharedBeforeEach('deploy tokens', async () => {
      tokens = await TokenList.create(numberOfTokens, { sorted: true, varyDecimals: true });
    });

    const rateProviders: string[] = [];
    const exemptFromYieldProtocolFeeFlags: boolean[] = [];

    async function deployPool(
      tokens: TokenList,
      numRateProviders = tokens.length,
      numExemptFlags = tokens.length
    ): Promise<void> {
      for (let i = 0; i < numRateProviders; i++) {
        rateProviders[i] = (await deploy('v2-pool-utils/MockRateProvider')).address;
      }

      for (let i = 0; i < numExemptFlags; i++) {
        exemptFromYieldProtocolFeeFlags[i] = i % 2 == 0; // set true for even tokens
      }

      pool = await deploy('MockStablePoolStorage', {
        args: [vault.address, tokens.addresses, rateProviders, exemptFromYieldProtocolFeeFlags],
      });
    }

    describe('constructor', () => {
      context('when the constructor succeeds', () => {
        sharedBeforeEach('deploy pool', async () => {
          await deployPool(tokens);
        });

        it('sets BPT index correctly', async () => {
          const bpt = await Token.deployedAt(pool);
          const allTokens = new TokenList([...tokens.tokens, bpt]).sort();
          const expectedIndex = allTokens.indexOf(bpt);
          expect(await pool.getBptIndex()).to.be.equal(expectedIndex);
        });

        it('sets the scaling factors', async () => {
          const bptIndex = await pool.getBptIndex();
          const expectedScalingFactors = tokens.map((token) => fp(1).mul(bn(10).pow(18 - token.decimals)));
          expectedScalingFactors.splice(bptIndex, 0, fp(1));

          const scalingFactors = await pool.getScalingFactors();

          // It also includes the BPT scaling factor
          expect(scalingFactors).to.have.lengthOf(numberOfTokens + 1);
          expect(scalingFactors).to.be.deep.equal(expectedScalingFactors);
        });

        it('sets the rate providers', async () => {
          const bptIndex = await pool.getBptIndex();
          const expectedRateProviders = rateProviders;
          expectedRateProviders.splice(bptIndex, 0, ZERO_ADDRESS);

          const providers = await pool.getRateProviders();

          // BPT does not have a rate provider
          expect(providers).to.have.lengthOf(numberOfTokens + 1);
          expect(providers).to.be.deep.equal(expectedRateProviders);
        });

        it('sets the fee exemption flags correctly', async () => {
          for (let i = 0; i < numberOfTokens; i++) {
            // Initialized to true for even tokens
            const expectedFlag = i % 2 == 0;
            const token = tokens.get(i);

            expect(await pool.isTokenExemptFromYieldProtocolFee(token.address)).to.equal(expectedFlag);
          }
        });
      });

      context('when the constructor fails', () => {
        it('reverts if there are repeated tokens', async () => {
          const badTokens = new TokenList(Array(numberOfTokens).fill(tokens.first));

          await expect(deployPool(badTokens)).to.be.revertedWith('UNSORTED_ARRAY');
        });

        it('reverts if the rate providers do not match the tokens length', async () => {
          await expect(deployPool(tokens, tokens.length + 1)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });

        it('reverts if the protocol fee flags do not match the tokens length', async () => {
          await expect(deployPool(tokens, tokens.length, 1)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
          await expect(deployPool(tokens, tokens.length, tokens.length + 1)).to.be.revertedWith(
            'INPUT_LENGTH_MISMATCH'
          );
        });
      });
    });
  }
});
