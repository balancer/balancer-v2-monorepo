import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { bn, fp, FP_ONE } from '@balancer-labs/v2-helpers/src/numbers';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { every, range } from 'lodash';

describe('ComposableStablePoolStorage', () => {
  let admin: SignerWithAddress;
  let vault: Vault;

  const SWAP_FEE_PERCENTAGE = fp(0.01);
  const BPT_INDEX = 0;

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
        deploy('MockComposableStablePoolStorage', {
          args: [
            vault.address,
            tokens.addresses,
            tokens.map(() => ZERO_ADDRESS),
            tokens.map(() => false),
            SWAP_FEE_PERCENTAGE,
          ],
        })
      ).to.be.revertedWith('MIN_TOKENS');
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
      await expect(
        deploy('MockComposableStablePoolStorage', {
          args: [
            vault.address,
            tokens.addresses,
            tokens.map(() => ZERO_ADDRESS),
            tokens.map(() => false),
            SWAP_FEE_PERCENTAGE,
          ],
        })
      ).to.be.revertedWith('MAX_TOKENS');
    });
  });

  function itBehavesAsStablePoolStorage(numberOfTokens: number): void {
    let pool: Contract, tokens: TokenList;

    sharedBeforeEach('deploy tokens', async () => {
      tokens = await TokenList.create(numberOfTokens, { sorted: true, varyDecimals: true });
    });

    let rateProviders: string[] = [];
    let exemptFromYieldProtocolFeeFlags: boolean[] = [];

    async function deployPool(
      tokens: TokenList,
      numRateProviders = tokens.length,
      numExemptFlags = tokens.length
    ): Promise<void> {
      const newRateProviders = [];
      for (let i = 0; i < numRateProviders; i++) {
        const hasRateProvider = Math.random() < 0.5;
        newRateProviders[i] = hasRateProvider ? (await deploy('v2-pool-utils/MockRateProvider')).address : ZERO_ADDRESS;
      }

      const newExemptFromYieldProtocolFeeFlags = [];
      for (let i = 0; i < numExemptFlags; i++) {
        const isExempt = Math.random() < 0.5;
        newExemptFromYieldProtocolFeeFlags[i] = newRateProviders[i] !== ZERO_ADDRESS && isExempt;
      }

      pool = await deploy('MockComposableStablePoolStorage', {
        args: [
          vault.address,
          tokens.addresses,
          newRateProviders,
          newExemptFromYieldProtocolFeeFlags,
          SWAP_FEE_PERCENTAGE,
        ],
      });
      rateProviders = newRateProviders;
      exemptFromYieldProtocolFeeFlags = newExemptFromYieldProtocolFeeFlags;
    }

    sharedBeforeEach('deploy pool', async () => {
      await deployPool(tokens);
    });

    describe('constructor', () => {
      context('when the constructor fails', () => {
        it('reverts if there are repeated tokens', async () => {
          const badTokens = new TokenList(Array(numberOfTokens).fill(tokens.first));

          await expect(deployPool(badTokens)).to.be.revertedWith('UNSORTED_ARRAY');
        });

        it('reverts if the rate providers do not match the tokens length', async () => {
          await expect(deployPool(tokens, tokens.length + 1)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });

        it('reverts if the protocol fee flags do not match the tokens length', async () => {
          await expect(deployPool(tokens, tokens.length, tokens.length + 1)).to.be.revertedWith(
            'INPUT_LENGTH_MISMATCH'
          );
        });

        it('reverts when setting an exempt flag with no rate provider', async () => {
          const tokenAddresses = tokens.addresses.slice(0, 2);
          const rateProviderAddresses = [ZERO_ADDRESS, ZERO_ADDRESS];
          const exemptionFlags = [true, true];

          await expect(
            deploy('MockComposableStablePoolStorage', {
              args: [vault.address, tokenAddresses, rateProviderAddresses, exemptionFlags, SWAP_FEE_PERCENTAGE],
            })
          ).to.be.revertedWith('TOKEN_DOES_NOT_HAVE_RATE_PROVIDER');
        });
      });
    });

    describe('array helpers', () => {
      describe('dropBptItem', () => {
        it("drops the element at the BPT's index", async () => {
          const array = Array.from({ length: tokens.length + 1 }).map((_, i) => bn(i));

          const expectedArray = array.slice();
          expectedArray.splice(BPT_INDEX, 1);
          expect(await pool.dropBptItem(array)).to.be.deep.eq(expectedArray);
        });
      });

      describe('dropBptItemFromBalances', () => {
        it("drops the element at the BPT's index, and returns virtual supply", async () => {
          const array = Array.from({ length: tokens.length + 1 }).map((_, i) => bn(i));

          const expectedArray = array.slice();
          expectedArray.splice(BPT_INDEX, 1);
          const [virtualSupply, actualArray] = await pool.dropBptItemFromBalances(array);

          expect(virtualSupply).to.equal(await pool.getVirtualSupply(array[BPT_INDEX]));
          expect(actualArray).to.be.deep.eq(expectedArray);
        });
      });

      describe('addBptItem', () => {
        it("inserts expected element at the BPT's index", async () => {
          const array = Array.from({ length: tokens.length }).map((_, i) => bn(i));
          const insertedElement = bn(420);

          const expectedArray = array.slice();
          expectedArray.splice(BPT_INDEX, 0, insertedElement);
          expect(await pool.addBptItem(array, insertedElement)).to.be.deep.eq(expectedArray);
        });
      });
    });

    describe('scaling factors', () => {
      describe('getScalingFactorX', () => {
        it('returns the correct scaling factor', async () => {
          await Promise.all(
            tokens.map(async (token, i) => {
              expect(await pool[`getScalingFactor${i}`]()).to.be.eq(FP_ONE.mul(bn(10).pow(18 - token.decimals)));
            })
          );
        });
      });
    });

    describe('rate providers', () => {
      describe('getRateProviderX', () => {
        it('returns the expected rate provider', async () => {
          await Promise.all(
            rateProviders.map(async (expectedRateProvider, i) => {
              expect(await pool[`getRateProvider${i}`]()).to.be.eq(expectedRateProvider);
            })
          );
        });
      });

      describe('getRateProvider', () => {
        context('when called with a valid index', () => {
          it('returns the rate provider for the token at the provided index', async () => {
            await Promise.all(
              rateProviders.map(async (expectedRateProvider, i) => {
                expect(await pool.getRateProvider(i)).to.be.eq(expectedRateProvider);
              })
            );
          });
        });

        context('when called with an invalid index', () => {
          it('reverts', async () => {
            const nonRegisteredToken = ANY_ADDRESS;
            await expect(pool.getRateProvider(nonRegisteredToken)).to.be.revertedWith('INVALID_TOKEN');
          });
        });
      });

      describe('getRateProviders', () => {
        it('returns the expected rate providers', async () => {
          const expectedRateProviders = rateProviders.slice();
          const providers = await pool.getRateProviders();

          expect(providers).to.have.lengthOf(numberOfTokens);
          expect(providers).to.be.deep.equal(expectedRateProviders);
        });
      });
    });

    describe('yield protocol fee exemption', () => {
      describe('isTokenExemptFromYieldProtocolFee(uint256)', () => {
        it('returns whether the token at a particular index is exempt', async () => {
          const expectedExemptFromYieldProtocolFeeFlags = exemptFromYieldProtocolFeeFlags.slice();

          for (let i = 0; i < expectedExemptFromYieldProtocolFeeFlags.length; i++) {
            const expectedFlag = expectedExemptFromYieldProtocolFeeFlags[i];
            expect(await pool.isTokenExemptFromYieldProtocolFeeByIndex(i)).to.equal(expectedFlag);
          }
        });
      });

      describe('isTokenExemptFromYieldProtocolFee(address)', () => {
        it('returns whether the token is exempt', async () => {
          const expectedExemptFromYieldProtocolFeeFlags = exemptFromYieldProtocolFeeFlags.slice();

          for (let i = 0; i < tokens.length; i++) {
            // Initialized to true for even tokens
            const expectedFlag = expectedExemptFromYieldProtocolFeeFlags[i];
            const token = tokens.get(i);

            expect(await pool.isTokenExemptFromYieldProtocolFee(token.address)).to.equal(expectedFlag);
          }
        });
      });

      describe('global exemption flags', () => {
        // These tests use a different Pool from the rest since they deploy it with non-random and controlled arguments.
        let exemptionPool: Contract;

        enum Exemption {
          NONE,
          SOME,
          ALL,
        }

        function deployExemptionPool(exemption: Exemption) {
          sharedBeforeEach(async () => {
            const rateProviders = await Promise.all(
              range(numberOfTokens).map(async () => (await deploy('v2-pool-utils/MockRateProvider')).address)
            );

            let exemptionFlags;
            if (exemption == Exemption.NONE) {
              exemptionFlags = Array(numberOfTokens).fill(false);
            } else if (exemption == Exemption.ALL) {
              exemptionFlags = Array(numberOfTokens).fill(true);
            } else {
              exemptionFlags = range(numberOfTokens).map(() => Math.random() < 0.5);

              if (every(exemptionFlags, (flag) => flag == false)) {
                exemptionFlags[0] = true;
              } else if (every(exemptionFlags, (flag) => flag == true)) {
                exemptionFlags[0] = false;
              }
            }

            exemptionPool = await deploy('MockComposableStablePoolStorage', {
              args: [vault.address, tokens.addresses, rateProviders, exemptionFlags, SWAP_FEE_PERCENTAGE],
            });
          });
        }

        context('when no token is exempt', () => {
          deployExemptionPool(Exemption.NONE);

          it('areAllTokensExempt returns false', async () => {
            expect(await exemptionPool.areAllTokensExempt()).to.equal(false);
          });

          it('areNoTokensExempt returns true', async () => {
            expect(await exemptionPool.areNoTokensExempt()).to.equal(true);
          });
        });

        context('when all tokens are exempt', () => {
          deployExemptionPool(Exemption.ALL);

          it('areAllTokensExempt returns true', async () => {
            expect(await exemptionPool.areAllTokensExempt()).to.equal(true);
          });

          it('areNoTokensExempt returns false', async () => {
            expect(await exemptionPool.areNoTokensExempt()).to.equal(false);
          });
        });

        context('when some (but not all) tokens are exempt', () => {
          deployExemptionPool(Exemption.SOME);

          it('areAllTokensExempt returns false', async () => {
            expect(await exemptionPool.areAllTokensExempt()).to.equal(false);
          });

          it('areNoTokensExempt returns false', async () => {
            expect(await exemptionPool.areNoTokensExempt()).to.equal(false);
          });
        });
      });
    });
  }
});
