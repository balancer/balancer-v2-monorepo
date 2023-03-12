import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, BigNumberish, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ProtocolFee } from '@balancer-labs/v2-helpers/src/models/vault/types';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

type ProviderFeeIDs = {
  swap: BigNumberish;
  yield: BigNumberish;
  aum: BigNumberish;
};

describe('ProtocolFeeCache', () => {
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
      .grantPermission(
        actionId(vault.protocolFeesProvider, 'setFeeTypePercentage'),
        admin.address,
        vault.protocolFeesProvider.address
      );

    await vault.authorizer
      .connect(admin)
      .grantPermission(
        actionId(feesCollector, 'setFlashLoanFeePercentage'),
        vault.protocolFeesProvider.address,
        feesCollector.address
      );
    await vault.authorizer
      .connect(admin)
      .grantPermission(
        actionId(feesCollector, 'setSwapFeePercentage'),
        vault.protocolFeesProvider.address,
        feesCollector.address
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

  context('with valid fee type ids', () => {
    context('using default fee ids', () => {
      itTestsProtocolFeePercentages({ swap: ProtocolFee.SWAP, yield: ProtocolFee.YIELD, aum: ProtocolFee.AUM });
    });

    context('using the same fee for all types', () => {
      itTestsProtocolFeePercentages({ swap: ProtocolFee.SWAP, yield: ProtocolFee.SWAP, aum: ProtocolFee.SWAP });
    });

    context('using custom fee types', () => {
      itTestsProtocolFeePercentages({ swap: ProtocolFee.FLASH_LOAN, yield: ProtocolFee.SWAP, aum: ProtocolFee.YIELD });
    });
  });

  context('with invalid fee type ids', () => {
    it('reverts during deployment', async () => {
      await expect(
        deploy('MockProtocolFeeCache', {
          args: [
            vault.address,
            vault.protocolFeesProvider.address,
            { swap: 137, yield: ProtocolFee.SWAP, aum: ProtocolFee.YIELD },
          ],
          from: admin,
        })
      ).to.be.revertedWith('Non-existent fee type');
    });
  });

  describe('vault access', () => {
    sharedBeforeEach('deploy fee cache', async () => {
      protocolFeeCache = await deploy('MockProtocolFeeCache', {
        args: [
          vault.address,
          vault.protocolFeesProvider.address,
          { swap: ProtocolFee.SWAP, yield: ProtocolFee.YIELD, aum: ProtocolFee.AUM },
        ],
        from: admin,
      });
    });

    it('stores the Vault', async () => {
      expect(await protocolFeeCache.vault()).to.eq(vault.address);
    });
  });

  function itTestsProtocolFeePercentages(providerFeeIds: ProviderFeeIDs): void {
    sharedBeforeEach('deploy fee cache', async () => {
      protocolFeeCache = await deploy('MockProtocolFeeCache', {
        args: [vault.address, vault.protocolFeesProvider.address, providerFeeIds],
        from: admin,
      });
    });

    it('reverts when querying unknown protocol fees', async () => {
      await expect(protocolFeeCache.getProtocolFeePercentageCache(17)).to.be.revertedWith('UNHANDLED_FEE_TYPE');
    });

    it('stores fee type ids correctly', async () => {
      expect(await protocolFeeCache.getProviderFeeId(ProtocolFee.SWAP)).to.be.eq(providerFeeIds.swap);
      expect(await protocolFeeCache.getProviderFeeId(ProtocolFee.YIELD)).to.be.eq(providerFeeIds.yield);
      expect(await protocolFeeCache.getProviderFeeId(ProtocolFee.AUM)).to.be.eq(providerFeeIds.aum);
    });

    context('with recovery mode disabled', () => {
      function itReturnsAndUpdatesProtocolFeePercentages(cacheFeeType: number) {
        describe(`protocol fee type ${ProtocolFee[cacheFeeType]}`, () => {
          let originalValue: BigNumber;
          let providerFeeId: BigNumber;

          sharedBeforeEach('get the original fee value', async () => {
            providerFeeId = await protocolFeeCache.getProviderFeeId(cacheFeeType);
            originalValue = await vault.protocolFeesProvider.getFeeTypePercentage(providerFeeId);
          });

          it('returns the same value as in the provider', async () => {
            expect(await protocolFeeCache.getProtocolFeePercentageCache(cacheFeeType)).to.equal(
              await vault.protocolFeesProvider.getFeeTypePercentage(providerFeeId)
            );
          });

          context('when the fee value is updated', () => {
            const NEW_VALUE = fp(0.007);
            let preSwapFee: BigNumber, preYieldFee: BigNumber, preAumFee: BigNumber;

            sharedBeforeEach('update the provider protocol fee', async () => {
              await vault.protocolFeesProvider.connect(admin).setFeeTypePercentage(providerFeeId, NEW_VALUE);

              preSwapFee = await protocolFeeCache.getProtocolFeePercentageCache(ProtocolFee.SWAP);
              preYieldFee = await protocolFeeCache.getProtocolFeePercentageCache(ProtocolFee.YIELD);
              preAumFee = await protocolFeeCache.getProtocolFeePercentageCache(ProtocolFee.AUM);
            });

            it('retrieves the old fee value when not updated', async () => {
              expect(await protocolFeeCache.getProtocolFeePercentageCache(cacheFeeType)).to.equal(originalValue);
            });

            it('updates the cached value', async () => {
              await protocolFeeCache.updateProtocolFeePercentageCache();

              expect(await protocolFeeCache.getProtocolFeePercentageCache(cacheFeeType)).to.equal(NEW_VALUE);
            });

            it('calls the hook before the cache is updated', async () => {
              const receipt = await protocolFeeCache.updateProtocolFeePercentageCache();

              expectEvent.inReceipt(await receipt.wait(), 'FeesInBeforeHook', {
                swap: preSwapFee,
                yield: preYieldFee,
                aum: preAumFee,
              });
            });

            it('emits an event when updating the cache', async () => {
              const receipt = await protocolFeeCache.updateProtocolFeePercentageCache();
              const feeCache = {
                swap: providerFeeId.eq(providerFeeIds.swap) ? NEW_VALUE : preSwapFee,
                yield: providerFeeId.eq(providerFeeIds.yield) ? NEW_VALUE : preYieldFee,
                aum: providerFeeId.eq(providerFeeIds.aum) ? NEW_VALUE : preAumFee,
              };

              // Swap, yield and AUM fees are 64-bit values encoded with 0, 64 and 128 bit offsets respectively.
              const feeCacheEncoded = feeCache.swap.shl(0).or(feeCache.yield.shl(64)).or(feeCache.aum.shl(128));

              expectEvent.inReceipt(await receipt.wait(), 'ProtocolFeePercentageCacheUpdated', {
                feeCache: feeCacheEncoded,
              });
            });
          });
        });
      }

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
  }
});
