import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { encodeCalldataAuthorization, signSetRelayerApprovalAuthorization } from '@balancer-labs/balancer-js';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import Vault from '../../../pvt/helpers/src/models/vault/Vault';

describe('BaseRelayer', function () {
  let relayer: Contract, vault: Vault;
  let admin: SignerWithAddress, user: SignerWithAddress;

  let approvalAuthorisation: string;
  const EMPTY_AUTHORISATION = '0x';

  before('set up signers', async () => {
    [, admin, user] = await ethers.getSigners();
  });

  sharedBeforeEach('set up relayer', async () => {
    vault = await Vault.create({ admin });
    relayer = await deploy('BaseRelayer', { args: [vault.address] });

    const approval = vault.instance.interface.encodeFunctionData('setRelayerApproval', [
      user.address,
      relayer.address,
      true,
    ]);
    const signature = await signSetRelayerApprovalAuthorization(vault.instance, user, relayer, approval);
    approvalAuthorisation = encodeCalldataAuthorization('0x', MAX_UINT256, signature);
  });

  describe('setRelayerApproval', () => {
    context('when relayer is allowed to set approval', () => {
      sharedBeforeEach('authorise relayer', async () => {
        const authorizer = vault.authorizer as Contract;
        const setRelayerApproval = actionId(vault.instance, 'setRelayerApproval');
        await authorizer.connect(admin).grantRole(setRelayerApproval, relayer.address);
      });

      it('sets the desired approval for the relayer', async () => {
        const approveTx = await relayer.connect(user).setRelayerApproval(true, approvalAuthorisation);
        const approveReceipt = await approveTx.wait();

        expectEvent.inIndirectReceipt(approveReceipt, vault.instance.interface, 'RelayerApprovalChanged', {
          relayer: relayer.address,
          sender: user.address,
          approved: true,
        });

        const revokeTx = await relayer.connect(user).setRelayerApproval(false, '0x');
        const revokeReceipt = await revokeTx.wait();

        expectEvent.inIndirectReceipt(revokeReceipt, vault.instance.interface, 'RelayerApprovalChanged', {
          relayer: relayer.address,
          sender: user.address,
          approved: false,
        });
      });
    });

    context('when relayer is not allowed to set approval', () => {
      it('reverts', async () => {
        await expect(relayer.connect(user).setRelayerApproval(true, approvalAuthorisation)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });
  });

  describe('multicall', () => {
    function setRelayerApprovalTx(allowed: boolean, authorization: string) {
      return relayer.interface.encodeFunctionData('setRelayerApproval', [allowed, authorization]);
    }

    context('when sending ETH', () => {
      it('refunds the unused ETH', async () => {
        // Pass in 100 wei which will not be used
        const value = 100;
        const userBalanceBefore = await ethers.provider.getBalance(user.address);

        const tx = await relayer.connect(user).multicall([], { value });
        const receipt = await tx.wait();

        const txCost = tx.gasPrice.mul(receipt.gasUsed);
        const expectedBalanceAfter = userBalanceBefore.sub(txCost);
        const userBalanceAfter = await ethers.provider.getBalance(user.address);

        expect(userBalanceAfter).to.be.eq(expectedBalanceAfter);
        expect(await ethers.provider.getBalance(vault.address)).to.be.eq(0);
        expect(await ethers.provider.getBalance(relayer.address)).to.be.eq(0);
      });
    });

    context('when passed a call which will revert', () => {
      it('passes up the correct revert string', async () => {
        // Call should fail due to relayer not been approved by the Authorizer
        await expect(
          relayer.connect(user).multicall([setRelayerApprovalTx(true, approvalAuthorisation)])
        ).to.be.revertedWith('SENDER_NOT_ALLOWED');

        const authorizer = vault.authorizer as Contract;
        const setRelayerApproval = actionId(vault.instance, 'setRelayerApproval');
        await authorizer.connect(admin).grantRole(setRelayerApproval, relayer.address);

        // Call should fail due to bad authorization from user
        await expect(
          relayer.connect(user).multicall([setRelayerApprovalTx(true, EMPTY_AUTHORISATION)])
        ).to.be.revertedWith('USER_DOESNT_ALLOW_RELAYER');
      });
    });

    context('when relayer is allowed to set approval', () => {
      sharedBeforeEach('authorise relayer', async () => {
        const authorizer = vault.authorizer as Contract;
        const setRelayerApproval = actionId(vault.instance, 'setRelayerApproval');
        await authorizer.connect(admin).grantRole(setRelayerApproval, relayer.address);
      });

      context('when not approved by sender', () => {
        context('when the first call gives permanent approval', () => {
          it("doesn't require signatures on further calls", async () => {
            const setApproval = setRelayerApprovalTx(true, approvalAuthorisation);
            const revokeApproval = setRelayerApprovalTx(false, EMPTY_AUTHORISATION);

            const tx = await relayer.connect(user).multicall([setApproval, revokeApproval]);
            const receipt = await tx.wait();

            // Check that approval revocation was applied.
            expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'RelayerApprovalChanged', {
              relayer: relayer.address,
              sender: user.address,
              approved: false,
            });
          });
        });
      });
    });
  });
});
