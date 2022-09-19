import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { bn, FP_ONE } from '@balancer-labs/v2-helpers/src/numbers';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { every, range } from 'lodash';

describe('ComposableStablePoolStorage', () => {
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
        deploy('MockComposableStablePoolStorage', {
          args: [vault.address, tokens.addresses, tokens.map(() => ZERO_ADDRESS), tokens.map(() => false)],
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
          args: [vault.address, tokens.addresses, tokens.map(() => ZERO_ADDRESS), tokens.map(() => false)],
        })
      ).to.be.revertedWith('MAX_TOKENS');
    });
  });

  function itBehavesAsStablePoolStorage(numberOfTokens: number): void {
    let pool: Contract, tokens: TokenList;
    let bptIndex: number;

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
        args: [vault.address, tokens.addresses, newRateProviders, newExemptFromYieldProtocolFeeFlags],
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
        it('sets BPT index correctly', async () => {
          const bpt = await Token.deployedAt(pool);
          const allTokens = new TokenList([...tokens.tokens, bpt]).sort();
          const expectedIndex = allTokens.indexOf(bpt);
          expect(await pool.getBptIndex()).to.be.equal(expectedIndex);
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
              args: [vault.address, tokenAddresses, rateProviderAddresses, exemptionFlags],
            })
          ).to.be.revertedWith('TOKEN_DOES_NOT_HAVE_RATE_PROVIDER');
        });
      });
    });

    describe('array helpers', () => {
      describe('skipBptIndex', () => {
        context('when passing index < bptIndex', () => {
          it('returns index', async () => {
            // Note that `bptIndex` could equal 0 which would invalidate this test.
            // Unfortunately we can't control the position of BPT index however we run the test with a
            // range of different pools so the probablity of it always sitting in the first position is slim.
            for (let index = 0; index < bptIndex; index++) {
              expect(await pool.skipBptIndex(index)).to.be.eq(index);
            }
          });
        });

        context('when passing index == bptIndex', () => {
          it('reverts', async () => {
            await expect(pool.skipBptIndex(bptIndex)).to.be.revertedWith('OUT_OF_BOUNDS');
          });
        });

        context('when passing index > bptIndex', () => {
          it('returns index - 1', async () => {
            // Note that `bptIndex` could equal tokens.length + 1 which would invalidate this test.
            // Unfortunately we can't control the position of BPT index however we run the test with a
            // range of different pools so the probablity of it always sitting in the last position is slim.
            for (let index = bptIndex + 1; index < tokens.length + 1; index++) {
              expect(await pool.skipBptIndex(index)).to.be.eq(index - 1);
            }
          });
        });
      });

      describe('dropBptItem', () => {
        it("drops the element at the BPT's index", async () => {
          const array = Array.from({ length: tokens.length + 1 }).map((_, i) => bn(i));

          const expectedArray = array.slice();
          expectedArray.splice(bptIndex, 1);
          expect(await pool.dropBptItem(array)).to.be.deep.eq(expectedArray);
        });
      });

      describe('addBptIndex', () => {
        context('when passing index < bptIndex', () => {
          it('returns index', async () => {
            // Note that `bptIndex` could equal 0 which would invalidate this test.
            // Unfortunately we can't control the position of BPT index however we run the test with a
            // range of different pools so the probablity of it always sitting in the first position is slim.
            for (let index = 0; index < bptIndex; index++) {
              expect(await pool.addBptIndex(index)).to.be.eq(index);
            }
          });
        });

        context('when passing index >= bptIndex', () => {
          it('returns index + 1', async () => {
            // Note that `bptIndex` could equal tokens.length + 1 which would invalidate this test.
            // Unfortunately we can't control the position of BPT index however we run the test with a
            // range of different pools so the probablity of it always sitting in the last position is slim.
            for (let index = bptIndex; index < tokens.length; index++) {
              expect(await pool.addBptIndex(index)).to.be.eq(index + 1);
            }
          });
        });

        context('when passing index >= tokens.length', () => {
          it('reverts', async () => {
            await expect(pool.addBptIndex(tokens.length)).to.be.revertedWith('OUT_OF_BOUNDS');
          });
        });
      });

      describe('addBptItem', () => {
        it("inserts expected element at the BPT's index", async () => {
          const array = Array.from({ length: tokens.length }).map((_, i) => bn(i));
          const insertedElement = bn(420);

          const expectedArray = array.slice();
          expectedArray.splice(bptIndex, 0, insertedElement);
          expect(await pool.addBptItem(array, insertedElement)).to.be.deep.eq(expectedArray);
        });
      });
    });

    describe('scaling factors', () => {
      describe('getScalingFactorX', () => {
        it('returns the correct scaling factor', async () => {
          const expectedScalingFactors = tokens.map((token) => FP_ONE.mul(bn(10).pow(18 - token.decimals)));
          expectedScalingFactors.splice(bptIndex, 0, FP_ONE);

          // There's always 6 getters however not all of them may be used. Unused getters return zero.
          const paddedScalingFactors = Array.from({ length: 6 }, (_, i) => expectedScalingFactors[i] ?? bn(0));
          await Promise.all(
            paddedScalingFactors.map(async (expectedScalingFactor, i) => {
              expect(await pool[`getScalingFactor${i}`]()).to.be.eq(expectedScalingFactor);
            })
          );
        });
      });
    });

    describe('rate providers', () => {
      describe('getRateProviderX', () => {
        it('returns the expected rate provider', async () => {
          const expectedRateProviders = rateProviders.slice();
          expectedRateProviders.splice(bptIndex, 0, ZERO_ADDRESS);
          // There's always 6 getters however not all of them may be used. Unused getters return the zero address.
          const paddedRateProviders = Array.from({ length: 6 }, (_, i) => expectedRateProviders[i] ?? ZERO_ADDRESS);

          await Promise.all(
            paddedRateProviders.map(async (expectedRateProvider, i) => {
              expect(await pool[`getRateProvider${i}`]()).to.be.eq(expectedRateProvider);
            })
          );
        });
      });

      describe('getRateProvider', () => {
        context('when called with a valid index', () => {
          it('returns the rate provider for the token at the provided index', async () => {
            const bpt = await Token.deployedAt(pool);

            const registeredTokens = new TokenList([...tokens.tokens, bpt]).sort();
            const expectedRateProviders = rateProviders.slice();
            expectedRateProviders.splice(bptIndex, 0, ZERO_ADDRESS);

            for (let index = 0; index < registeredTokens.length; index++) {
              expect(await pool.getRateProvider(index)).to.be.eq(expectedRateProviders[index]);
            }
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
          // BPT does not have a rate provider
          expectedRateProviders.splice(bptIndex, 0, ZERO_ADDRESS);

          const providers = await pool.getRateProviders();

          expect(providers).to.have.lengthOf(numberOfTokens + 1);
          expect(providers).to.be.deep.equal(expectedRateProviders);
        });
      });
    });

    describe('yield protocol fee exemption', () => {
      describe('isTokenExemptFromYieldProtocolFee(uint256)', () => {
        it('returns whether the token at a particular index is exempt', async () => {
          const expectedExemptFromYieldProtocolFeeFlags = exemptFromYieldProtocolFeeFlags.slice();
          expectedExemptFromYieldProtocolFeeFlags.splice(bptIndex, 0, false);

          for (let i = 0; i < expectedExemptFromYieldProtocolFeeFlags.length; i++) {
            const expectedFlag = expectedExemptFromYieldProtocolFeeFlags[i];
            expect(await pool.isTokenExemptFromYieldProtocolFeeByIndex(i)).to.equal(expectedFlag);
          }
        });
      });

      describe('isTokenExemptFromYieldProtocolFee(address)', () => {
        it('returns whether the token is exempt', async () => {
          const bpt = await Token.deployedAt(pool);
          const allTokens = new TokenList([...tokens.tokens, bpt]).sort();

          const expectedExemptFromYieldProtocolFeeFlags = exemptFromYieldProtocolFeeFlags.slice();
          expectedExemptFromYieldProtocolFeeFlags.splice(bptIndex, 0, false);

          for (let i = 0; i < allTokens.length; i++) {
            // Initialized to true for even tokens
            const expectedFlag = expectedExemptFromYieldProtocolFeeFlags[i];
            const token = allTokens.get(i);

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
              args: [vault.address, tokens.addresses, rateProviders, exemptionFlags],
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
