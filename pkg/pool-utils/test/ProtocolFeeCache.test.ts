import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { ProtocolFee } from '@balancer-labs/v2-helpers/src/models/vault/types';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { random } from 'lodash';

describe('ProtocolFeeCache', () => {
  const FIXED_SWAP_PROTOCOL_FEE = fp(0.1); // 10%

  let protocolFeeCache: Contract;
  let admin: SignerWithAddress;
  let vault: Vault;

  before('setup signers', async () => {
    [, admin] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault', async () => {
    vault = await Vault.create({ admin });
  });

  sharedBeforeEach('grant permissions to admin', async () => {
    const feesCollector = await vault.getFeesCollector();

    await vault.authorizer
      .connect(admin)
      .grantPermissions([actionId(vault.protocolFeesProvider, 'setFeeTypePercentage')], admin.address, [
        vault.protocolFeesProvider.address,
      ]);

    await vault.authorizer
      .connect(admin)
      .grantPermissions(
        [actionId(feesCollector, 'setSwapFeePercentage'), actionId(feesCollector, 'setFlashLoanFeePercentage')],
        vault.protocolFeesProvider.address,
        [feesCollector.address, feesCollector.address]
      );
  });

  sharedBeforeEach('set initial fee percentages', async () => {
    await Promise.all(
      Object.values(ProtocolFee)
        .filter((val) => typeof val != 'string')
        .map((fee) =>
          vault.protocolFeesProvider.connect(admin).setFeeTypePercentage(fee, fp((1 + (fee as number)) / 1000))
        )
    );
  });

  function itReturnsAndUpdatesProtocolFeePercentages(feeType: number) {
    describe(`protocol fee type ${ProtocolFee[feeType]}`, () => {
      let originalValue: BigNumber;

      sharedBeforeEach('get the original fee value', async () => {
        originalValue = await vault.protocolFeesProvider.getFeeTypePercentage(feeType);
      });

      it('returns the same value as in the provider', async () => {
        expect(await protocolFeeCache.getProtocolFeePercentageCache(feeType)).to.equal(
          await vault.protocolFeesProvider.getFeeTypePercentage(feeType)
        );
      });

      context('when the fee value is updated', () => {
        const NEW_VALUE = fp(0.017);

        sharedBeforeEach('update the provider protocol fee', async () => {
          await vault.protocolFeesProvider.connect(admin).setFeeTypePercentage(feeType, NEW_VALUE);
        });

        it('retrieves the old fee value when not updated', async () => {
          expect(await protocolFeeCache.getProtocolFeePercentageCache(feeType)).to.equal(originalValue);
        });

        it('updates the cached value', async () => {
          await protocolFeeCache.updateProtocolFeePercentageCache();

          expect(await protocolFeeCache.getProtocolFeePercentageCache(feeType)).to.equal(NEW_VALUE);
        });

        it('emits an event when updating the cache', async () => {
          const receipt = await protocolFeeCache.updateProtocolFeePercentageCache();

          expectEvent.inReceipt(await receipt.wait(), 'ProtocolFeePercentageCacheUpdated', {
            feeType,
            protocolSwapFeePercentage: NEW_VALUE,
          });
        });
      });
    });
  }

  context('with delegated swap fee', () => {
    sharedBeforeEach('deploy delegated swap fee cache', async () => {
      // The sentinel value used to designate delegated fees is MAX_UINT256
      protocolFeeCache = await deploy('MockProtocolFeeCache', {
        args: [vault.protocolFeesProvider.address, MAX_UINT256],
        from: admin,
      });
    });

    it('reverts when querying unknown protocol fees', async () => {
      await expect(protocolFeeCache.getProtocolFeePercentageCache(17)).to.be.revertedWith('UNHANDLED_FEE_TYPE');
    });

    it('indicates delegated swap fees', async () => {
      expect(await protocolFeeCache.getProtocolSwapFeeDelegation()).to.be.true;
    });

    context('with recovery mode disabled', () => {
      itReturnsAndUpdatesProtocolFeePercentages(ProtocolFee.YIELD);
      itReturnsAndUpdatesProtocolFeePercentages(ProtocolFee.AUM);
      itReturnsAndUpdatesProtocolFeePercentages(ProtocolFee.SWAP);
    });

    context('with recovery mode enabled', () => {
      sharedBeforeEach('enable recovery mode', async () => {
        await protocolFeeCache.connect(admin).enableRecoveryMode();
        expect(await protocolFeeCache.inRecoveryMode()).to.equal(true);
      });

      it('returns a zero protocol fee for all types', async () => {
        await Promise.all(
          Object.values(ProtocolFee)
            .filter((val) => typeof val != 'string')
            .map(async (fee) => {
              expect(await protocolFeeCache.getProtocolFeePercentageCache(fee)).to.equal(0);
            })
        );
      });
    });
  });

  context('with fixed swap fee', () => {
    sharedBeforeEach('deploy fixed swap fee cache', async () => {
      protocolFeeCache = await deploy('MockProtocolFeeCache', {
        args: [vault.protocolFeesProvider.address, FIXED_SWAP_PROTOCOL_FEE],
        from: admin,
      });
    });

    it('reverts when querying unknown protocol fees', async () => {
      await expect(protocolFeeCache.getProtocolFeePercentageCache(17)).to.be.revertedWith('UNHANDLED_FEE_TYPE');
    });

    it('indicates fixed swap fees', async () => {
      expect(await protocolFeeCache.getProtocolSwapFeeDelegation()).to.be.false;
    });

    context('with recovery mode disabled', () => {
      itReturnsAndUpdatesProtocolFeePercentages(ProtocolFee.YIELD);
      itReturnsAndUpdatesProtocolFeePercentages(ProtocolFee.AUM);

      describe('swap fees', () => {
        it('sets the fixed protocol swap fee', async () => {
          expect(await protocolFeeCache.getProtocolFeePercentageCache(ProtocolFee.SWAP)).to.equal(
            FIXED_SWAP_PROTOCOL_FEE
          );
        });

        it('reverts if swap fee is too high', async () => {
          const maxSwapFee = await vault.getFeesProvider().getFeeTypeMaximumPercentage(ProtocolFee.SWAP);

          await expect(
            deploy('MockProtocolFeeCache', { args: [vault.protocolFeesProvider.address, maxSwapFee.add(1)] })
          ).to.be.revertedWith('SWAP_FEE_PERCENTAGE_TOO_HIGH');
        });

        it('does not update the fixed fee', async () => {
          await protocolFeeCache.updateProtocolFeePercentageCache();
          expect(await protocolFeeCache.getProtocolFeePercentageCache(ProtocolFee.SWAP)).to.equal(
            FIXED_SWAP_PROTOCOL_FEE
          );
        });
      });
    });

    context('with recovery mode enabled', () => {
      sharedBeforeEach('enable recovery mode', async () => {
        await protocolFeeCache.connect(admin).enableRecoveryMode();
        expect(await protocolFeeCache.inRecoveryMode()).to.equal(true);
      });

      it('returns a zero protocol fee for all types', async () => {
        await Promise.all(
          Object.values(ProtocolFee)
            .filter((val) => typeof val != 'string')
            .map(async (fee) => {
              expect(await protocolFeeCache.getProtocolFeePercentageCache(fee)).to.equal(0);
            })
        );
      });
    });
  });

  describe('protocol fees on join/exit', () => {
    const FEE_RELATIVE_ERROR = 1e-3;

    // We want relatively large values to make the fees much larger than rounding error
    const SWAP_PROTOCOL_FEE_PERCENTAGE = fp(0.5);

    sharedBeforeEach('deploy swap fee cache', async () => {
      protocolFeeCache = await deploy('MockProtocolFeeCache', {
        args: [vault.protocolFeesProvider.address, MAX_UINT256],
        from: admin,
      });
    });

    describe('getJoinExitProtocolSwapFee', () => {
      context('when the protocol swap fee percentage is zero', () => {
        itPaysProtocolFeesOnJoinExitSwaps(bn(0));
      });

      context('when the protocol swap fee percentage is non-zero', () => {
        itPaysProtocolFeesOnJoinExitSwaps(SWAP_PROTOCOL_FEE_PERCENTAGE);
      });

      function itPaysProtocolFeesOnJoinExitSwaps(swapFee: BigNumber) {
        let preJoinExitInvariant: BigNumber;
        let postJoinExitInvariant: BigNumber;
        let preJoinExitSupply: BigNumber;
        let postJoinExitSupply: BigNumber;
        let expectedBpt: BigNumber;

        enum Operation {
          JOIN,
          EXIT,
        }

        context('on proportional join', () => {
          prepareProportionalJoinOrExit(Operation.JOIN);

          itDoesNotPayAnyProtocolFees();
        });

        context('on proportional exit', () => {
          prepareProportionalJoinOrExit(Operation.EXIT);

          itDoesNotPayAnyProtocolFees();
        });

        context('on multi-token non-proportional join', () => {
          prepareNonProportionalJoinOrExit(Operation.JOIN);

          if (swapFee.eq(0)) {
            itDoesNotPayAnyProtocolFees();
          } else {
            itPaysTheExpectedProtocolFees();
          }
        });

        context('on multi-token non-proportional exit', () => {
          prepareNonProportionalJoinOrExit(Operation.EXIT);

          if (swapFee.eq(0)) {
            itDoesNotPayAnyProtocolFees();
          } else {
            itPaysTheExpectedProtocolFees();
          }
        });

        function prepareProportionalJoinOrExit(op: Operation) {
          sharedBeforeEach(async () => {
            const ratio = fp(random(0.1, 0.9));

            preJoinExitInvariant = fp(random(10, 90));
            preJoinExitSupply = fp(random(1, 9));

            if (op == Operation.JOIN) {
              postJoinExitInvariant = preJoinExitInvariant.mul(fp(1).add(ratio)).div(fp(1));
              postJoinExitSupply = preJoinExitSupply.mul(fp(1).add(ratio)).div(fp(1));
            } else {
              postJoinExitInvariant = preJoinExitInvariant.mul(fp(1).sub(ratio)).div(fp(1));
              postJoinExitSupply = preJoinExitSupply.mul(fp(1).sub(ratio)).div(fp(1));
            }
          });
        }

        function prepareNonProportionalJoinOrExit(op: Operation) {
          sharedBeforeEach(async () => {
            const ratio = fp(random(0.1, 0.9));
            const invariantGrowthFactor = fp(random(0.01, 0.09));

            preJoinExitInvariant = fp(random(10, 90));
            preJoinExitSupply = fp(random(1, 9));

            const invariantGrowthFromFees = preJoinExitInvariant.mul(invariantGrowthFactor).div(fp(1));
            expectedBpt = invariantGrowthFromFees.mul(preJoinExitSupply).div(preJoinExitInvariant);

            if (op == Operation.JOIN) {
              postJoinExitSupply = preJoinExitSupply.mul(fp(1).add(ratio)).div(fp(1));
              postJoinExitInvariant = preJoinExitInvariant
                .mul(fp(1).add(ratio))
                .div(fp(1))
                .add(invariantGrowthFromFees);
            } else {
              postJoinExitSupply = preJoinExitSupply.mul(fp(1).sub(ratio)).div(fp(1));
              postJoinExitInvariant = preJoinExitInvariant
                .mul(fp(1).sub(ratio))
                .div(fp(1))
                .add(invariantGrowthFromFees);
            }

            // const feelessInvariant = preJoinExitInvariant.mul(postJoinExitSupply).div(preJoinExitSupply);
            // const invariantDeltaFromFees = postJoinExitInvariant.sub(feelessInvariant);

            // const poolFeePercentage = invariantDeltaFromFees.mul(fp(1)).div(preJoinExitInvariant);
            // expectedProtocolOwnershipPercentage = poolFeePercentage.mul(swapFee).div(fp(1));
          });
        }

        function itDoesNotPayAnyProtocolFees() {
          it('mints no (or negligible) BPT', async () => {
            const bptAmount = await protocolFeeCache.getJoinExitProtocolSwapFee(
              preJoinExitInvariant,
              postJoinExitInvariant,
              preJoinExitSupply,
              postJoinExitSupply,
              swapFee
            );

            // If the protocol swap fee percentage is non-zero, we can't quite guarantee that there'll be zero
            // protocol fees since there's some rounding error in the computation of the currentInvariant the Pool
            // will make, which might result in negligible fees.

            // The BPT amount to mint is computed as a percentage of the current supply. This is done with precision
            // of up to 18 decimal places, so any error below that is always considered negligible. We test for
            // precision of up to 17 decimal places to give some leeway and account for e.g. different rounding
            // directions, etc.
            expect(bptAmount).to.be.lte(preJoinExitSupply.div(bn(1e17)));
          });
        }

        function itPaysTheExpectedProtocolFees() {
          it('mints BPT to the protocol fee collector', async () => {
            const protocolFees = await protocolFeeCache.getJoinExitProtocolSwapFee(
              preJoinExitInvariant,
              postJoinExitInvariant,
              preJoinExitSupply,
              postJoinExitSupply,
              swapFee
            );

            expect(protocolFees).to.be.almostEqual(expectedBpt, FEE_RELATIVE_ERROR);
          });
        }
      }
    });
  });
});
