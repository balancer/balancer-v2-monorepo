import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { RelayerAuthorization } from '@balancer-labs/balancer-js';

import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';

describe('BaseRelayerImplementation', function () {
  let vault: Contract;
  let relayer: Contract, relayerImpl: Contract;

  let admin: SignerWithAddress, signer: SignerWithAddress;

  before('get signers', async () => {
    [, admin, signer] = await ethers.getSigners();
  });

  sharedBeforeEach('set up relayer', async () => {
    // Deploy Balancer Vault
    const vaultHelper = await Vault.create({ admin });
    vault = vaultHelper.instance;

    // Deploy Relayer
    relayerImpl = await deploy('BaseRelayerImplementation', { args: [vault.address] });
    relayer = await deployedAt('RelayerEntrypoint', await relayerImpl.getEntrypoint());
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

        approvalData = relayerImpl.interface.encodeFunctionData('setRelayerApproval', [true, callAuthorisation]);
      });

      context('when relayer is authorised by governance', () => {
        sharedBeforeEach('authorise relayer', async () => {
          const setApprovalRole = await actionId(vault, 'setRelayerApproval');
          const authorizer = await deployedAt('v2-vault/Authorizer', await vault.getAuthorizer());
          await authorizer.connect(admin).grantRoles([setApprovalRole], relayer.address);
        });

        it('sets the desired approval for the relayer to act for sender', async () => {
          const approveTx = await relayer.connect(signer).multicall([approvalData]);
          const approveReceipt = await approveTx.wait();

          expectEvent.inIndirectReceipt(approveReceipt, vault.interface, 'RelayerApprovalChanged', {
            relayer: relayer.address,
            sender: signer.address,
            approved: true,
          });

          const revokeData = relayerImpl.interface.encodeFunctionData('setRelayerApproval', [false, '0x']);

          const revokeTx = await relayer.connect(signer).multicall([revokeData]);
          const revokeReceipt = await revokeTx.wait();

          expectEvent.inIndirectReceipt(revokeReceipt, vault.interface, 'RelayerApprovalChanged', {
            relayer: relayer.address,
            sender: signer.address,
            approved: false,
          });
        });

        it('approval applies to later calls within the same multicall', async () => {
          const noSigRelayerApproval = relayerImpl.interface.encodeFunctionData('setRelayerApproval', [true, '0x']);
          await expect(relayer.connect(signer).multicall([approvalData, noSigRelayerApproval])).to.not.be.reverted;
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
