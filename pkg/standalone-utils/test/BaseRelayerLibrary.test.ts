import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { RelayerAuthorization } from '@balancer-labs/balancer-js';

import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

import { ANY_ADDRESS, MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { BigNumberish, bn } from '@balancer-labs/v2-helpers/src/numbers';

describe('BaseRelayerLibrary', function () {
  let vault: Contract;
  let relayer: Contract, relayerLibrary: Contract;
  let otherRelayer: SignerWithAddress;

  let admin: SignerWithAddress, signer: SignerWithAddress;

  before('get signers', async () => {
    [, admin, signer, otherRelayer] = await ethers.getSigners();
  });

  sharedBeforeEach('set up relayer', async () => {
    // Deploy Balancer Vault
    const vaultHelper = await Vault.create({ admin });
    vault = vaultHelper.instance;

    // Deploy Relayer
    relayerLibrary = await deploy('MockBaseRelayerLibrary', { args: [vault.address] });
    relayer = await deployedAt('BalancerRelayer', await relayerLibrary.getEntrypoint());
  });

  describe('relayer getters', () => {
    it('returns the library address', async () => {
      expect(await relayer.getLibrary()).to.equal(relayerLibrary.address);
    });

    it('returns the vault address', async () => {
      expect(await relayer.getVault()).to.equal(vault.address);
    });
  });

  describe('chained references', () => {
    const CHAINED_REFERENCE_PREFIX = 'ba10';

    function toChainedReference(key: BigNumberish): BigNumber {
      // The full padded prefix is 66 characters long, with 64 hex characters and the 0x prefix.
      const paddedPrefix = `0x${CHAINED_REFERENCE_PREFIX}${'0'.repeat(64 - CHAINED_REFERENCE_PREFIX.length)}`;

      return BigNumber.from(paddedPrefix).add(key);
    }

    it('identifies immediate amounts', async () => {
      expect(await relayerLibrary.isChainedReference(5)).to.equal(false);
    });

    it('identifies chained references', async () => {
      expect(await relayerLibrary.isChainedReference(toChainedReference(5))).to.equal(true);
    });

    describe('read and write', () => {
      const key = 5;
      const reference = toChainedReference(key);

      async function expectChainedReferenceContents(key: BigNumberish, expectedValue: BigNumberish): Promise<void> {
        const receipt = await (await relayerLibrary.getChainedReferenceValue(key)).wait();
        expectEvent.inReceipt(receipt, 'ChainedReferenceValueRead', { value: bn(expectedValue) });
      }

      it('reads uninitialized references as zero', async () => {
        await expectChainedReferenceContents(reference, 0);
      });

      it('reads stored references', async () => {
        await relayerLibrary.setChainedReferenceValue(reference, 42);
        await expectChainedReferenceContents(reference, 42);
      });

      it('writes replace old data', async () => {
        await relayerLibrary.setChainedReferenceValue(reference, 42);
        await relayerLibrary.setChainedReferenceValue(reference, 17);
        await expectChainedReferenceContents(reference, 17);
      });

      it('stored data in independent slots', async () => {
        await relayerLibrary.setChainedReferenceValue(reference, 5);
        await expectChainedReferenceContents(reference.add(1), 0);
      });

      it('clears read data', async () => {
        await relayerLibrary.setChainedReferenceValue(reference, 5);
        await expectChainedReferenceContents(reference, 5);

        // The reference is now cleared
        await expectChainedReferenceContents(reference, 0);
      });
    });
  });

  describe('multicall', () => {
    context('when msg.value is nonzero', () => {
      it('refunds the unused ETH', async () => {
        const userBalanceBefore = await ethers.provider.getBalance(signer.address);

        const tx = await relayer.connect(signer).multicall([], { value: 20000 });
        const receipt = await tx.wait();

        const txCost = tx.gasPrice.mul(receipt.gasUsed);
        const expectedBalanceAfter = userBalanceBefore.sub(txCost);
        const userBalanceAfter = await ethers.provider.getBalance(signer.address);

        // The relayer and vault should have zero balances
        expect(userBalanceAfter).to.be.eq(expectedBalanceAfter);
        expect(await ethers.provider.getBalance(vault.address)).to.be.eq(0);
        expect(await ethers.provider.getBalance(relayer.address)).to.be.eq(0);
      });
    });

    describe('setRelayerApproval', () => {
      let approvalData: string;

      sharedBeforeEach('sign relayer approval', async () => {
        const approval = vault.interface.encodeFunctionData('setRelayerApproval', [
          signer.address,
          relayer.address,
          true,
        ]);
        const signature = await RelayerAuthorization.signSetRelayerApprovalAuthorization(
          vault,
          signer,
          relayer,
          approval
        );
        const callAuthorisation = RelayerAuthorization.encodeCalldataAuthorization('0x', MAX_UINT256, signature);

        approvalData = relayerLibrary.interface.encodeFunctionData('setRelayerApproval', [
          relayer.address,
          true,
          callAuthorisation,
        ]);
      });

      context('when relayer is authorised by governance', () => {
        sharedBeforeEach('authorise relayer', async () => {
          const setApprovalRole = await actionId(vault, 'setRelayerApproval');
          const authorizer = await deployedAt('v2-vault/Authorizer', await vault.getAuthorizer());
          await authorizer.connect(admin).grantPermissions([setApprovalRole], relayer.address, [ANY_ADDRESS]);
        });

        describe('when modifying its own approval', () => {
          it('sets the desired approval for the relayer to act for sender', async () => {
            const approveTx = await relayer.connect(signer).multicall([approvalData]);
            const approveReceipt = await approveTx.wait();

            expectEvent.inIndirectReceipt(approveReceipt, vault.interface, 'RelayerApprovalChanged', {
              relayer: relayer.address,
              sender: signer.address,
              approved: true,
            });

            const revokeData = relayerLibrary.interface.encodeFunctionData('setRelayerApproval', [
              relayer.address,
              false,
              '0x',
            ]);

            const revokeTx = await relayer.connect(signer).multicall([revokeData]);
            const revokeReceipt = await revokeTx.wait();

            expectEvent.inIndirectReceipt(revokeReceipt, vault.interface, 'RelayerApprovalChanged', {
              relayer: relayer.address,
              sender: signer.address,
              approved: false,
            });
          });

          it('approval applies to later calls within the same multicall', async () => {
            const noSigRelayerApproval = relayerLibrary.interface.encodeFunctionData('setRelayerApproval', [
              relayer.address,
              true,
              '0x',
            ]);
            await expect(relayer.connect(signer).multicall([approvalData, noSigRelayerApproval])).to.not.be.reverted;
          });
        });

        describe('when modifying the approval for another relayer', () => {
          sharedBeforeEach('approve relayer', async () => {
            await vault.connect(signer).setRelayerApproval(signer.address, relayer.address, true);
          });

          it('reverts when giving approval for another relayer', async () => {
            const approval = vault.interface.encodeFunctionData('setRelayerApproval', [
              signer.address,
              otherRelayer.address,
              true,
            ]);
            const signature = await RelayerAuthorization.signSetRelayerApprovalAuthorization(
              vault,
              signer,
              otherRelayer,
              approval
            );
            const callAuthorisation = RelayerAuthorization.encodeCalldataAuthorization('0x', MAX_UINT256, signature);

            const approvalData = relayerLibrary.interface.encodeFunctionData('setRelayerApproval', [
              otherRelayer.address,
              true,
              callAuthorisation,
            ]);

            await expect(relayer.connect(signer).multicall([approvalData])).to.be.revertedWith(
              'Relayer can only approve itself'
            );
          });

          it('correctly revokes approval for another relayer', async () => {
            await vault.connect(signer).setRelayerApproval(signer.address, otherRelayer.address, true);

            const revokeData = relayerLibrary.interface.encodeFunctionData('setRelayerApproval', [
              otherRelayer.address,
              false,
              '0x',
            ]);

            const revokeTx = await relayer.connect(signer).multicall([revokeData]);
            const revokeReceipt = await revokeTx.wait();

            expectEvent.inIndirectReceipt(revokeReceipt, vault.interface, 'RelayerApprovalChanged', {
              relayer: otherRelayer.address,
              sender: signer.address,
              approved: false,
            });
          });
        });
      });

      context('when relayer is not authorised by governance', () => {
        it('reverts', async () => {
          await expect(relayer.connect(signer).multicall([approvalData])).to.be.revertedWith('SENDER_NOT_ALLOWED');
        });
      });
    });
  });
});
