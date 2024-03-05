import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { RelayerAuthorization } from '@balancer-labs/balancer-js';

import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

import { ANY_ADDRESS, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { BigNumberish, bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { toChainedReference } from './helpers/chainedReferences';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('BaseRelayerLibrary', function () {
  let vault: Contract;
  let relayer: Contract, relayerLibrary: Contract;
  let token: Contract;
  let otherRelayer: SignerWithAddress;

  let admin: SignerWithAddress, signer: SignerWithAddress;
  const version = JSON.stringify({
    name: 'BatchRelayer',
    version: '1',
    deployment: 'test-deployment',
  });

  before('get signers', async () => {
    [, admin, signer, otherRelayer] = await ethers.getSigners();
  });

  sharedBeforeEach('set up relayer', async () => {
    // Deploy Balancer Vault
    const vaultHelper = await Vault.create({ admin });
    vault = vaultHelper.instance;

    // Deploy Relayer
    relayerLibrary = await deploy('MockBaseRelayerLibrary', { args: [vault.address, version] });
    relayer = await deployedAt('BalancerRelayer', await relayerLibrary.getEntrypoint());
    token = await deploy('TestWETH'); // Any ERC-20 will do.
  });

  describe('relayer getters', () => {
    it('returns the library address', async () => {
      expect(await relayer.getLibrary()).to.equal(relayerLibrary.address);
    });

    it('returns the query library address', async () => {
      expect(await relayer.getQueryLibrary()).not.to.equal(ZERO_ADDRESS);
    });

    it('returns the vault address', async () => {
      expect(await relayer.getVault()).to.equal(vault.address);
    });

    it('returns the relayer version', async () => {
      expect(await relayer.version()).to.equal(version);
    });
  });

  describe('chained references', () => {
    it('identifies immediate amounts', async () => {
      expect(await relayerLibrary.isChainedReference(5)).to.equal(false);
    });

    it('identifies chained references', async () => {
      expect(await relayerLibrary.isChainedReference(toChainedReference(5))).to.equal(true);
    });

    describe('read and write', () => {
      const key = 5;

      context('when the reference is temporary', () => {
        const reference = toChainedReference(key, true);

        itReadsAndWritesData(reference);

        it('clears data after reading', async () => {
          await relayerLibrary.setChainedReferenceValue(reference, 5);
          await expectChainedReferenceContents(reference, 5);

          // The reference is now cleared
          await expectChainedReferenceContents(reference, 0);
        });
      });

      context('when the reference is not temporary', () => {
        const reference = toChainedReference(key, false);

        itReadsAndWritesData(reference);

        it('preserves data after reading', async () => {
          await relayerLibrary.setChainedReferenceValue(reference, 5);
          await expectChainedReferenceContents(reference, 5);

          // The reference is preserved
          await expectChainedReferenceContents(reference, 5);
        });
      });

      context('when mixing temporary and read-only references', () => {
        const reference = toChainedReference(key, true);
        const readOnlyReference = toChainedReference(key, false);

        it('writes the same slot (temporary write)', async () => {
          await relayerLibrary.setChainedReferenceValue(reference, 17);
          await expectChainedReferenceContents(readOnlyReference, 17);
        });

        it('writes the same slot (read-only write)', async () => {
          await relayerLibrary.setChainedReferenceValue(readOnlyReference, 11);
          await expectChainedReferenceContents(reference, 11);
        });

        it('reads the same written slot', async () => {
          await relayerLibrary.setChainedReferenceValue(reference, 37);

          await expectChainedReferenceContents(readOnlyReference, 37);
          await expectChainedReferenceContents(reference, 37);
        });

        it('reads the same cleared slot', async () => {
          await relayerLibrary.setChainedReferenceValue(reference, 39);

          await expectChainedReferenceContents(reference, 39);
          await expectChainedReferenceContents(readOnlyReference, 0);
        });
      });

      async function expectChainedReferenceContents(key: BigNumberish, expectedValue: BigNumberish): Promise<void> {
        const receipt = await (await relayerLibrary.getChainedReferenceValue(key)).wait();
        expectEvent.inReceipt(receipt, 'ChainedReferenceValueRead', { value: bn(expectedValue) });
      }

      function itReadsAndWritesData(reference: BigNumber) {
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

        // `peekChainedReferenceValue` is not a `view` function because it has to be flagged as `payable`, but
        // it does not alter the contract's state.
        // Therefore, we use `callStatic` to read the state from an off-chain call.
        it('peeks uninitialized references as zero', async () => {
          expect(await relayerLibrary.callStatic.peekChainedReferenceValue(reference)).to.be.eq(0);
        });

        it('peeks stored references', async () => {
          await relayerLibrary.setChainedReferenceValue(reference, 23);
          expect(await relayerLibrary.callStatic.peekChainedReferenceValue(reference)).to.be.eq(23);
        });

        it('peeks overwritten data', async () => {
          await relayerLibrary.setChainedReferenceValue(reference, 42);
          await relayerLibrary.setChainedReferenceValue(reference, 17);
          expect(await relayerLibrary.callStatic.peekChainedReferenceValue(reference)).to.be.eq(17);
        });

        it('peeks stored data in independent slots', async () => {
          await relayerLibrary.setChainedReferenceValue(reference, 5);
          expect(await relayerLibrary.callStatic.peekChainedReferenceValue(reference.add(1))).to.be.eq(0);
        });

        it('peeks same slot multiple times', async () => {
          await relayerLibrary.setChainedReferenceValue(reference, 19);
          expect(await relayerLibrary.callStatic.peekChainedReferenceValue(reference)).to.be.eq(19);
          expect(await relayerLibrary.callStatic.peekChainedReferenceValue(reference)).to.be.eq(19);
          expect(await relayerLibrary.callStatic.peekChainedReferenceValue(reference)).to.be.eq(19);
        });

        it('peeks and reads same slot', async () => {
          await relayerLibrary.setChainedReferenceValue(reference, 31);

          expect(await relayerLibrary.callStatic.peekChainedReferenceValue(reference)).to.be.eq(31);
          await expectChainedReferenceContents(reference, 31);
        });
      }
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
          const authorizer = await deployedAt('v2-vault/TimelockAuthorizer', await vault.getAuthorizer());
          await authorizer.connect(admin).grantPermission(setApprovalRole, relayer.address, ANY_ADDRESS);
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

        it('is payable', async () => {
          await expect(relayer.connect(signer).multicall([approvalData], { value: fp(1) })).to.not.be.reverted;
        });
      });

      context('when relayer is not authorised by governance', () => {
        it('reverts', async () => {
          await expect(relayer.connect(signer).multicall([approvalData])).to.be.revertedWith('SENDER_NOT_ALLOWED');
        });
      });
    });

    describe('peekChainedReferenceValue', () => {
      it('peeks chained reference', async () => {
        const reference = toChainedReference(174);
        const value = fp(340);

        const result = await relayer.callStatic.multicall([
          relayerLibrary.interface.encodeFunctionData('setChainedReferenceValue', [reference, value]),
          relayerLibrary.interface.encodeFunctionData('peekChainedReferenceValue', [reference]),
        ]);
        expect(result).to.be.deep.eq(['0x', ethers.utils.hexZeroPad(value.toHexString(), 32)]);
      });

      it('is payable', async () => {
        const reference = toChainedReference(174);
        await expect(relayerLibrary.peekChainedReferenceValue(reference, { value: fp(1) })).to.not.be.reverted;
      });
    });
  });

  describe('approve vault', () => {
    function itApprovesVault(approveAmount: BigNumberish, allowance: BigNumberish) {
      it('approves vault to use tokens', async () => {
        const tx = await relayerLibrary.approveVault(token.address, approveAmount);

        expectEvent.inIndirectReceipt(await tx.wait(), token.interface, 'Approval', {
          owner: relayerLibrary.address,
          spender: vault.address,
          value: allowance,
        });
        expect(await token.allowance(relayerLibrary.address, vault.address)).to.equal(allowance);
      });

      it('is payable', async () => {
        await expect(relayerLibrary.approveVault(token.address, approveAmount, { value: fp(1) })).to.not.be.reverted;
      });
    }

    context('when using values as argument', () => {
      // Argument sent to approveVault is equal to allowance.
      itApprovesVault(145, 145);
    });

    context('when using chained references as argument', () => {
      const key = 135;
      const reference = toChainedReference(key);
      const allowance = 7;

      sharedBeforeEach('set reference', async () => {
        await relayerLibrary.setChainedReferenceValue(reference, allowance);
      });

      // approveVault reads value from chained reference.
      itApprovesVault(reference, allowance);
    });
  });
});
