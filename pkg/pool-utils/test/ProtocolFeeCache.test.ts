import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ProtocolFee } from '@balancer-labs/v2-helpers/src/models/vault/types';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

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

  sharedBeforeEach('deploy fee cache', async () => {
    protocolFeeCache = await deploy('MockProtocolFeeCache', {
      args: [vault.protocolFeesProvider.address],
      from: admin,
    });
  });

  it('reverts when querying unknown protocol fees', async () => {
    await expect(protocolFeeCache.getProtocolFeePercentageCache(17)).to.be.revertedWith('UNHANDLED_FEE_TYPE');
  });

  context('with recovery mode disabled', () => {
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

          it('calls the hook before the cache is updated', async () => {
            const preSwapFee = await protocolFeeCache.getProtocolFeePercentageCache(ProtocolFee.SWAP);
            const preYieldFee = await protocolFeeCache.getProtocolFeePercentageCache(ProtocolFee.YIELD);
            const preAumFee = await protocolFeeCache.getProtocolFeePercentageCache(ProtocolFee.AUM);

            const receipt = await protocolFeeCache.updateProtocolFeePercentageCache();

            expectEvent.inReceipt(await receipt.wait(), 'FeesInBeforeHook', {
              swap: preSwapFee,
              yield: preYieldFee,
              aum: preAumFee,
            });
          });

          it('emits an event when updating the cache', async () => {
            const receipt = await protocolFeeCache.updateProtocolFeePercentageCache();

            expectEvent.inReceipt(await receipt.wait(), 'ProtocolFeePercentageCacheUpdated', {
              feeType,
              protocolFeePercentage: NEW_VALUE,
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
});
