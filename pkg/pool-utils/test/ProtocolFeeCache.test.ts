import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

describe('ProtocolFeeCache', () => {
  const MAX_PROTOCOL_FEE = fp(0.5); // 50%
  const VAULT_PROTOCOL_FEE = fp(0.3); // 30%
  const NEW_VAULT_PROTOCOL_FEE = fp(0.2); // 20%
  const FIXED_PROTOCOL_FEE = fp(0.1); // 10%

  let protocolFeeCache: Contract;
  let admin: SignerWithAddress;
  let vault: Vault;

  before('setup signers', async () => {
    [, admin] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault', async () => {
    vault = await Vault.create({ admin });
  });

  context('with delegated fee', () => {
    sharedBeforeEach('deploy delegated fee cache', async () => {
      await vault.setSwapFeePercentage(VAULT_PROTOCOL_FEE, { from: admin });

      // The sentinel value used to designate delegated fees is MAX_UINT256
      protocolFeeCache = await deploy('MockProtocolFeeCache', { args: [vault.address, MAX_UINT256], from: admin });
    });

    context('with recovery mode disabled', () => {
      it('indicates delegated fees', async () => {
        expect(await protocolFeeCache.getProtocolFeeDelegation()).to.be.true;
      });

      it('gets the protocol fee from the vault', async () => {
        expect(await protocolFeeCache.getProtocolSwapFeePercentageCache()).to.equal(VAULT_PROTOCOL_FEE);
      });

      context('when the vault fee is updated', () => {
        sharedBeforeEach('update the main protocol fee', async () => {
          await vault.setSwapFeePercentage(NEW_VAULT_PROTOCOL_FEE, { from: admin });
        });

        it('retrieves the old value when not updated', async () => {
          expect(await protocolFeeCache.getProtocolSwapFeePercentageCache()).to.equal(VAULT_PROTOCOL_FEE);
        });

        it('updates the cached value', async () => {
          await protocolFeeCache.updateProtocolSwapFeePercentageCache();

          expect(await protocolFeeCache.getProtocolSwapFeePercentageCache()).to.equal(NEW_VAULT_PROTOCOL_FEE);
        });

        it('emits an event when updating', async () => {
          const receipt = await protocolFeeCache.updateProtocolSwapFeePercentageCache();

          expectEvent.inReceipt(await receipt.wait(), 'ProtocolSwapFeePercentageCacheUpdated', {
            protocolSwapFeePercentage: NEW_VAULT_PROTOCOL_FEE,
          });
        });
      });
    });

    context('with recovery mode enabled', () => {
      sharedBeforeEach('enable recovery mode', async () => {
        await protocolFeeCache.connect(admin).enableRecoveryMode();
        expect(await protocolFeeCache.inRecoveryMode()).to.equal(true);
      });

      it('returns a zero protocol fee', async () => {
        expect(await protocolFeeCache.getProtocolSwapFeePercentageCache()).to.equal(0);
      });
    });
  });

  context('with fixed fee', () => {
    sharedBeforeEach('deploy fixed fee cache', async () => {
      protocolFeeCache = await deploy('MockProtocolFeeCache', {
        args: [vault.address, FIXED_PROTOCOL_FEE],
        from: admin,
      });
    });

    context('with recovery mode disabled', () => {
      it('indicates fixed fees', async () => {
        expect(await protocolFeeCache.getProtocolFeeDelegation()).to.be.false;
      });

      it('sets the protocol fee', async () => {
        expect(await protocolFeeCache.getProtocolSwapFeePercentageCache()).to.equal(FIXED_PROTOCOL_FEE);
      });

      it('reverts if fee is too high', async () => {
        await expect(
          deploy('MockProtocolFeeCache', { args: [vault.address, MAX_PROTOCOL_FEE.add(1)] })
        ).to.be.revertedWith('SWAP_FEE_PERCENTAGE_TOO_HIGH');
      });

      it('reverts when trying to update fixed fee', async () => {
        await expect(protocolFeeCache.updateProtocolSwapFeePercentageCache()).to.be.revertedWith('INVALID_OPERATION');
      });
    });

    context('with recovery mode enabled', () => {
      sharedBeforeEach('enable recovery mode', async () => {
        await protocolFeeCache.connect(admin).enableRecoveryMode();
        expect(await protocolFeeCache.inRecoveryMode()).to.equal(true);
      });

      it('returns a zero protocol fee', async () => {
        expect(await protocolFeeCache.getProtocolSwapFeePercentageCache()).to.equal(0);
      });
    });
  });
});
