import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';
import { MAX_GAS_LIMIT, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { RelayerAuthorization } from '@balancer-labs/balancer-js';

describe('VaultAuthorization', function () {
  let authorizer: Contract, vault: Contract;
  let admin: SignerWithAddress, user: SignerWithAddress, other: SignerWithAddress;
  let relayer: SignerWithAddress;

  const WHERE = ZERO_ADDRESS;

  before('setup signers', async () => {
    [, admin, user, other, relayer] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy authorizer', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
  });

  async function deployVault(authorizer: string): Promise<Contract> {
    return deploy('Vault', { args: [authorizer, ZERO_ADDRESS, 0, 0] });
  }

  describe('authorizer', () => {
    it('has an initial authorizer', async () => {
      const vault = await deployVault(authorizer.address);

      expect(await vault.getAuthorizer()).to.equal(authorizer.address);
    });

    it('can be initialized to the zero address', async () => {
      const vault = await deployVault(ZERO_ADDRESS);

      expect(await vault.getAuthorizer()).to.equal(ZERO_ADDRESS);
    });
  });

  describe('change authorizer', () => {
    sharedBeforeEach('deploy vault', async () => {
      vault = await deployVault(authorizer.address);
    });

    context('when the sender is has the permission to do it', () => {
      let action: string;

      sharedBeforeEach('grant permission', async () => {
        action = await actionId(vault, 'setAuthorizer');
        await authorizer.connect(admin).grantRole(action, admin.address);
      });

      it('can change the authorizer to another address', async () => {
        await vault.connect(admin).setAuthorizer(other.address);

        expect(await vault.getAuthorizer()).to.equal(other.address);
      });

      it('emits an event when authorizer changed', async () => {
        const receipt = await (await vault.connect(admin).setAuthorizer(other.address)).wait();
        expectEvent.inReceipt(receipt, 'AuthorizerChanged', { newAuthorizer: other.address });
      });

      it('can change the authorizer to the zero address', async () => {
        await vault.connect(admin).setAuthorizer(ZERO_ADDRESS);

        expect(await vault.getAuthorizer()).to.equal(ZERO_ADDRESS);
      });

      it('can not change the authorizer if the permission was revoked', async () => {
        await authorizer.connect(admin).revokeRole(action, admin.address);

        expect(await authorizer.canPerform(action, admin.address, WHERE)).to.be.false;

        await expect(vault.connect(admin).setAuthorizer(other.address)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when the sender does not have the permission to do it', () => {
      it('reverts', async () => {
        await expect(vault.connect(other).setAuthorizer(other.address)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });

  describe('set relayer approval', () => {
    sharedBeforeEach('deploy vault', async () => {
      vault = await deployVault(authorizer.address);
    });

    let sender: SignerWithAddress;

    context('when the sender is the user', () => {
      beforeEach('set sender', () => {
        sender = user;
      });

      itApprovesAndDisapprovesRelayer();
    });

    context('when the sender is not the user', () => {
      beforeEach('set sender', () => {
        sender = other;
      });

      context('when the sender is allowed by the authorizer', () => {
        sharedBeforeEach('grant permission to sender', async () => {
          const action = await actionId(vault, 'setRelayerApproval');
          await authorizer.connect(admin).grantRole(action, sender.address);
        });

        context('when the sender is approved by the user', () => {
          sharedBeforeEach('approve sender', async () => {
            await vault.connect(user).setRelayerApproval(user.address, sender.address, true);
          });

          itApprovesAndDisapprovesRelayer();
        });

        context('when the sender is not approved by the user', () => {
          sharedBeforeEach('disapprove sender', async () => {
            await vault.connect(user).setRelayerApproval(user.address, sender.address, false);
          });

          context('when the sender is allowed by signature', () => {
            const signature = true;
            itApprovesAndDisapprovesRelayer(signature);
          });

          context('with no signature', () => {
            it('reverts', async () => {
              await expect(
                vault.connect(sender).setRelayerApproval(user.address, relayer.address, true)
              ).to.be.revertedWith('USER_DOESNT_ALLOW_RELAYER');
            });
          });
        });
      });

      context('when the sender is not allowed by the authorizer', () => {
        sharedBeforeEach('revoke permission for sender', async () => {
          const action = await actionId(vault, 'setRelayerApproval');
          await authorizer.connect(admin).revokeRole(action, sender.address);
        });

        context('when the sender is approved by the user', () => {
          sharedBeforeEach('approve sender', async () => {
            await vault.connect(user).setRelayerApproval(user.address, sender.address, true);
          });

          it('reverts', async () => {
            await expect(
              vault.connect(sender).setRelayerApproval(user.address, relayer.address, true)
            ).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });

        context('when the sender is not approved by the user', () => {
          sharedBeforeEach('disapprove sender', async () => {
            await vault.connect(user).setRelayerApproval(user.address, sender.address, false);
          });

          it('reverts', async () => {
            await expect(
              vault.connect(sender).setRelayerApproval(user.address, relayer.address, true)
            ).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });
      });
    });

    function itApprovesAndDisapprovesRelayer(withSignature?: boolean) {
      context('when the relayer was not approved', () => {
        sharedBeforeEach('disapprove relayer', async () => {
          await vault.connect(user).setRelayerApproval(user.address, relayer.address, false);
        });

        itSetsTheRelayerApproval(true, withSignature);
        itSetsTheRelayerApproval(false, withSignature);
      });

      context('when the relayer was approved', () => {
        sharedBeforeEach('approve relayer', async () => {
          await vault.connect(user).setRelayerApproval(user.address, relayer.address, true);
        });

        itSetsTheRelayerApproval(true, withSignature);
        itSetsTheRelayerApproval(false, withSignature);
      });

      function itSetsTheRelayerApproval(approved: boolean, withSignature?: boolean) {
        it(`${approved ? 'sets' : 'resets'} the approval`, async () => {
          await setApproval();
          expect(await vault.hasApprovedRelayer(user.address, relayer.address)).to.equal(approved);
        });

        it(`emits an event when ${approved ? 'setting' : 'resetting'} relayer approval`, async () => {
          const receipt = await (await setApproval()).wait();

          expectEvent.inIndirectReceipt(receipt, vault.interface, 'RelayerApprovalChanged', {
            relayer: relayer.address,
            sender: user.address,
            approved,
          });
        });

        async function setApproval(): Promise<ContractTransaction> {
          let calldata = vault.interface.encodeFunctionData('setRelayerApproval', [
            user.address,
            relayer.address,
            approved,
          ]);

          if (withSignature) {
            const signature = await RelayerAuthorization.signSetRelayerApprovalAuthorization(
              vault,
              user,
              sender.address,
              calldata
            );
            calldata = RelayerAuthorization.encodeCalldataAuthorization(calldata, MAX_UINT256, signature);
          }

          // Hardcoding a gas limit prevents (slow) gas estimation
          return sender.sendTransaction({
            to: vault.address,
            data: calldata,
            gasLimit: MAX_GAS_LIMIT,
          });
        }
      }
    }
  });

  describe('temporarily pausable', () => {
    const PAUSE_WINDOW_DURATION = MONTH * 3;
    const BUFFER_PERIOD_DURATION = MONTH;

    sharedBeforeEach(async () => {
      authorizer = await deploy('Authorizer', { args: [admin.address] });
      vault = await deploy('Vault', {
        args: [authorizer.address, ZERO_ADDRESS, PAUSE_WINDOW_DURATION, BUFFER_PERIOD_DURATION],
      });
    });

    context('when the sender has the permission to pause and unpause', () => {
      let action: string;

      sharedBeforeEach('grant permission', async () => {
        action = await actionId(vault, 'setPaused');
        await authorizer.connect(admin).grantRole(action, admin.address);
      });

      it('can pause', async () => {
        await vault.connect(admin).setPaused(true);

        const { paused } = await vault.getPausedState();
        expect(paused).to.be.true;
      });

      it('can unpause', async () => {
        await vault.connect(admin).setPaused(true);
        await vault.connect(admin).setPaused(false);

        const { paused } = await vault.getPausedState();
        expect(paused).to.be.false;
      });

      it('cannot pause if the permission is revoked', async () => {
        await authorizer.connect(admin).revokeRole(action, admin.address);
        expect(await authorizer.canPerform(action, admin.address, WHERE)).to.be.false;

        await expect(vault.connect(admin).setPaused(true)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when the sender does not have the permission to unpause', () => {
      it('reverts', async () => {
        await expect(vault.connect(other).setPaused(true)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });
});
