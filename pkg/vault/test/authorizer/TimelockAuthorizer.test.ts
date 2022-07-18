import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TimelockAuthorizer from '@balancer-labs/v2-helpers/src/models/authorizer/TimelockAuthorizer';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { advanceTime, currentTimestamp, DAY } from '@balancer-labs/v2-helpers/src/time';

describe('TimelockAuthorizer', () => {
  let authorizer: TimelockAuthorizer, vault: Contract, authenticatedContract: Contract;
  let root: SignerWithAddress, grantee: SignerWithAddress, other: SignerWithAddress, from: SignerWithAddress;

  before('setup signers', async () => {
    [, root, grantee, other] = await ethers.getSigners();
  });

  const ACTION_1 = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const ACTION_2 = '0x0000000000000000000000000000000000000000000000000000000000000002';
  const ACTIONS = [ACTION_1, ACTION_2];

  const WHERE_1 = ethers.Wallet.createRandom().address;
  const WHERE_2 = ethers.Wallet.createRandom().address;
  const WHERE = [WHERE_1, WHERE_2];

  const GENERAL_PERMISSION_SPECIFIER = TimelockAuthorizer.GENERAL_PERMISSION_SPECIFIER;
  const EVERYWHERE = TimelockAuthorizer.EVERYWHERE;
  const NOT_WHERE = ethers.Wallet.createRandom().address;

  const MIN_DELAY = 3 * DAY;

  sharedBeforeEach('deploy authorizer', async () => {
    const oldAuthorizer = await TimelockAuthorizer.create({ root });

    vault = await deploy('Vault', { args: [oldAuthorizer.address, ZERO_ADDRESS, 0, 0] });
    authorizer = await TimelockAuthorizer.create({ root, vault });
    authenticatedContract = await deploy('MockAuthenticatedContract', { args: [vault.address] });

    const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
    await oldAuthorizer.grantPermissions(setAuthorizerAction, root, vault, { from: root });
    await vault.connect(root).setAuthorizer(authorizer.address);
  });

  describe('root', () => {
    let GRANT_ACTION_ID: string, REVOKE_ACTION_ID: string;

    sharedBeforeEach('set constants', async () => {
      GRANT_ACTION_ID = await authorizer.GRANT_ACTION_ID();
      REVOKE_ACTION_ID = await authorizer.REVOKE_ACTION_ID();
    });

    it('is root', async () => {
      expect(await authorizer.isRoot(root)).to.be.true;
    });

    it('defines its permissions correctly', async () => {
      const expectedGrantId = ethers.utils.solidityKeccak256(
        ['bytes32', 'address', 'address'],
        [GRANT_ACTION_ID, root.address, EVERYWHERE]
      );
      expect(await authorizer.permissionId(GRANT_ACTION_ID, root, EVERYWHERE)).to.be.equal(expectedGrantId);

      const expectedRevokeId = ethers.utils.solidityKeccak256(
        ['bytes32', 'address', 'address'],
        [REVOKE_ACTION_ID, root.address, EVERYWHERE]
      );
      expect(await authorizer.permissionId(REVOKE_ACTION_ID, root, EVERYWHERE)).to.be.equal(expectedRevokeId);
    });

    it('can grant permissions everywhere', async () => {
      expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, root, WHERE_1)).to.be.true;
      expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, root, WHERE_2)).to.be.true;
      expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE)).to.be.true;
    });

    it('can revoke permissions everywhere', async () => {
      expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, root, WHERE_1)).to.be.true;
      expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, root, WHERE_2)).to.be.true;
      expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE)).to.be.true;
    });

    it('does not hold plain grant permissions', async () => {
      expect(await authorizer.canPerform(REVOKE_ACTION_ID, root, EVERYWHERE)).to.be.false;
      expect(await authorizer.canPerform(REVOKE_ACTION_ID, root, EVERYWHERE)).to.be.false;
    });

    it('does not hold plain revoke permissions', async () => {
      expect(await authorizer.canPerform(GRANT_ACTION_ID, root, EVERYWHERE)).to.be.false;
      expect(await authorizer.canPerform(GRANT_ACTION_ID, root, EVERYWHERE)).to.be.false;
    });

    it('can manage other addresses to grant permissions for a custom contract', async () => {
      await authorizer.addGranter(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1, { from: root });

      expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.true;
      expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

      await authorizer.removeGranter(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1, { from: root });

      expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
      expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
    });

    it('can manage other addresses to grant permissions everywhere', async () => {
      await authorizer.addGranter(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE, { from: root });

      expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.true;
      expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.true;

      await authorizer.removeGranter(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE, { from: root });

      expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
      expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
    });

    it('can manage other addresses to revoke permissions for a custom contract', async () => {
      await authorizer.addRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1, { from: root });

      expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.true;
      expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

      await authorizer.removeRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1, { from: root });

      expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
      expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
    });

    it('can manage other addresses to revoke permissions everywhere', async () => {
      await authorizer.addRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE, { from: root });

      expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.true;
      expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.true;

      await authorizer.removeRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE, { from: root });

      expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
      expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
    });

    it('can have their global grant permissions revoked by an authorized address for any contract', async () => {
      await authorizer.addGranter(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE, { from: root });

      await authorizer.removeGranter(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE, { from: grantee });
      expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, root, WHERE_1)).to.be.false;
      expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE)).to.be.false;

      await authorizer.addGranter(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE, { from: root });
      expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, root, WHERE_1)).to.be.true;
      expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE)).to.be.true;
    });

    it('cannot have their global grant permissions revoked by an authorized address for a specific contract', async () => {
      await authorizer.addGranter(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1, { from: root });

      await expect(
        authorizer.removeGranter(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE, { from: grantee })
      ).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });

    it('can have their global revoke permissions revoked by an authorized address for any contract', async () => {
      await authorizer.addRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE, { from: root });

      await authorizer.removeRevoker(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE, { from: grantee });
      expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, root, WHERE_1)).to.be.false;
      expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE)).to.be.false;

      await authorizer.addRevoker(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE, { from: root });
      expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, root, WHERE_1)).to.be.true;
      expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE)).to.be.true;
    });

    it('cannot have their global revoke permissions revoked by an authorized address for a specific contract', async () => {
      await authorizer.addRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1, { from: root });

      await expect(
        authorizer.removeRevoker(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE, { from: grantee })
      ).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });
  });

  describe('manageGranter', () => {
    context('when the sender is the root', () => {
      beforeEach('set sender', async () => {
        from = root;
      });

      sharedBeforeEach('remove root global grant permission', async () => {
        // The root address has global grant permissions for all action IDs.
        // This also allows the root to add and remove granters for all action IDs, however it's possible for root
        // to lose these global permissions under certain circumstances and root must be able to recover.
        // We perform these tests under the conditions that root has lost this permission to ensure that it can recover.
        await authorizer.removeGranter(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE, { from: root });
      });

      context('when granting permission', () => {
        context('for a specific action', () => {
          const actionId = ACTION_1;

          context('for a specific contract', () => {
            const where = WHERE_1;

            it('can grant permission for that action in that contract only', async () => {
              await authorizer.addGranter(actionId, grantee, where, { from });

              expect(await authorizer.canGrant(ACTION_1, grantee, WHERE_1)).to.be.true;
              expect(await authorizer.isGranter(ACTION_1, grantee, WHERE_1)).to.be.true;
            });

            it('cannot grant permission for any other action', async () => {
              await authorizer.addGranter(actionId, grantee, where, { from });

              expect(await authorizer.canGrant(ACTION_2, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canGrant(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

              expect(await authorizer.isGranter(ACTION_2, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isGranter(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
            });
          });

          context('for a any contract', () => {
            const where = EVERYWHERE;

            it('can grant permission for that action on any contract', async () => {
              await authorizer.addGranter(actionId, grantee, where, { from });

              expect(await authorizer.canGrant(ACTION_1, grantee, WHERE_1)).to.be.true;
              expect(await authorizer.canGrant(ACTION_1, grantee, EVERYWHERE)).to.be.true;

              expect(await authorizer.isGranter(ACTION_1, grantee, WHERE_1)).to.be.true;
              expect(await authorizer.isGranter(ACTION_1, grantee, EVERYWHERE)).to.be.true;
            });

            it('cannot grant permission for that any other action anywhere', async () => {
              await authorizer.addGranter(actionId, grantee, where, { from });

              expect(await authorizer.canGrant(ACTION_2, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canGrant(ACTION_2, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

              expect(await authorizer.isGranter(ACTION_2, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isGranter(ACTION_2, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
            });
          });
        });

        context('for a any action', () => {
          const actionId = GENERAL_PERMISSION_SPECIFIER;

          context('for a specific contract', () => {
            const where = WHERE_1;

            it('can grant permission for any action in that contract only', async () => {
              await authorizer.addGranter(actionId, grantee, where, { from });

              expect(await authorizer.canGrant(ACTION_1, grantee, WHERE_1)).to.be.true;
              expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.true;

              expect(await authorizer.isGranter(ACTION_1, grantee, WHERE_1)).to.be.true;
              expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.true;
            });

            it('cannot grant permissions in any other contract', async () => {
              await authorizer.addGranter(actionId, grantee, where, { from });

              expect(await authorizer.canGrant(ACTION_1, grantee, WHERE_2)).to.be.false;
              expect(await authorizer.canGrant(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

              expect(await authorizer.isGranter(ACTION_1, grantee, WHERE_2)).to.be.false;
              expect(await authorizer.isGranter(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
            });
          });

          context('for a any contract', () => {
            const where = EVERYWHERE;

            it('can grant permission for any action anywhere', async () => {
              await authorizer.addGranter(actionId, grantee, where, { from });

              expect(await authorizer.canGrant(ACTION_1, grantee, WHERE_1)).to.be.true;
              expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.true;
              expect(await authorizer.canGrant(ACTION_1, grantee, EVERYWHERE)).to.be.true;
              expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.true;

              expect(await authorizer.isGranter(ACTION_1, grantee, WHERE_1)).to.be.true;
              expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.true;
              expect(await authorizer.isGranter(ACTION_1, grantee, EVERYWHERE)).to.be.true;
              expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.true;
            });
          });
        });
      });

      context('when revoking permission', () => {
        context('for a specific action', () => {
          const actionId = ACTION_1;

          context('for a specific contract', () => {
            const where = WHERE_1;

            it('cannot grant permission for that action in that contract only', async () => {
              await authorizer.addGranter(actionId, grantee, where, { from });
              await authorizer.removeGranter(actionId, grantee, where, { from });

              expect(await authorizer.canGrant(ACTION_1, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isGranter(ACTION_1, grantee, WHERE_1)).to.be.false;
            });

            it('cannot grant permission for any other action', async () => {
              await authorizer.addGranter(actionId, grantee, where, { from });

              expect(await authorizer.canGrant(ACTION_2, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canGrant(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

              expect(await authorizer.isGranter(ACTION_2, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isGranter(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
            });
          });

          context('for a any contract', () => {
            const where = EVERYWHERE;

            it('cannot grant permission for that action on any contract', async () => {
              await authorizer.addGranter(actionId, grantee, where, { from });
              await authorizer.removeGranter(actionId, grantee, where, { from });

              expect(await authorizer.canGrant(ACTION_1, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canGrant(ACTION_1, grantee, EVERYWHERE)).to.be.false;

              expect(await authorizer.isGranter(ACTION_1, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isGranter(ACTION_1, grantee, EVERYWHERE)).to.be.false;
            });

            it('cannot grant permission for that any other action anywhere', async () => {
              await authorizer.addGranter(actionId, grantee, where, { from });

              expect(await authorizer.canGrant(ACTION_2, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canGrant(ACTION_2, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

              expect(await authorizer.isGranter(ACTION_2, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isGranter(ACTION_2, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
            });
          });
        });

        context('for a any action', () => {
          const actionId = GENERAL_PERMISSION_SPECIFIER;

          context('for a specific contract', () => {
            const where = WHERE_1;

            it('cannot grant permission for any action in that contract only', async () => {
              await authorizer.addGranter(actionId, grantee, where, { from });
              await authorizer.removeGranter(actionId, grantee, where, { from });

              expect(await authorizer.canGrant(ACTION_1, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;

              expect(await authorizer.isGranter(ACTION_1, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
            });

            it('cannot grant permissions in any other contract', async () => {
              await authorizer.addGranter(actionId, grantee, where, { from });
              await authorizer.removeGranter(actionId, grantee, where, { from });

              expect(await authorizer.canGrant(ACTION_1, grantee, WHERE_2)).to.be.false;
              expect(await authorizer.canGrant(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

              expect(await authorizer.isGranter(ACTION_1, grantee, WHERE_2)).to.be.false;
              expect(await authorizer.isGranter(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
            });
          });

          context('for a any contract', () => {
            const where = EVERYWHERE;

            it('cannot grant permission for any action anywhere', async () => {
              await authorizer.addGranter(actionId, grantee, where, { from });
              await authorizer.removeGranter(actionId, grantee, where, { from });

              expect(await authorizer.canGrant(ACTION_1, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canGrant(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

              expect(await authorizer.isGranter(ACTION_1, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isGranter(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
            });
          });
        });
      });
    });

    context('when the sender is not the root', () => {
      beforeEach('set sender', async () => {
        from = other;
      });

      context('when granting permission', () => {
        const itReverts = (actionId: string, where: string) => {
          it('reverts', async () => {
            await expect(authorizer.addGranter(actionId, grantee, where, { from })).to.be.revertedWith(
              'SENDER_NOT_ALLOWED'
            );
          });
        };

        context('for a specific action', () => {
          const actionId = ACTION_1;

          context('for a specific contract', () => {
            const where = WHERE_1;

            context('when the sender has permission', () => {
              beforeEach('grant permission', async () => {
                await authorizer.addGranter(actionId, from, where, { from: root });
              });

              itReverts(actionId, where);
            });

            context('when the sender does not have permission', () => {
              itReverts(actionId, where);
            });
          });

          context('for a any contract', () => {
            const where = EVERYWHERE;

            context('when the sender has permission', () => {
              beforeEach('grant permission', async () => {
                await authorizer.addGranter(actionId, from, where, { from: root });
              });

              itReverts(actionId, where);
            });

            context('when the sender does not have permission', () => {
              itReverts(actionId, where);
            });
          });
        });

        context('for a any action', () => {
          const actionId = GENERAL_PERMISSION_SPECIFIER;

          context('for a specific contract', () => {
            const where = WHERE_1;

            context('when the sender has permission', () => {
              beforeEach('grant permission', async () => {
                await authorizer.addGranter(actionId, from, where, { from: root });
              });

              itReverts(actionId, where);
            });

            context('when the sender does not have permission', () => {
              itReverts(actionId, where);
            });
          });

          context('for a any contract', () => {
            const where = EVERYWHERE;

            context('when the sender has permission', () => {
              beforeEach('grant permission', async () => {
                await authorizer.addGranter(actionId, from, where, { from: root });
              });

              itReverts(actionId, where);
            });

            context('when the sender does not have permission', () => {
              itReverts(actionId, where);
            });
          });
        });
      });

      context('when revoking permission', () => {
        const itReverts = (actionId: string, where: string) => {
          it('reverts', async () => {
            await expect(authorizer.removeGranter(actionId, grantee, where, { from })).to.be.revertedWith(
              'SENDER_NOT_ALLOWED'
            );
          });
        };

        context('for a specific action', () => {
          const actionId = ACTION_1;

          context('for a specific contract', () => {
            const where = WHERE_1;

            context('when the sender has permission', () => {
              beforeEach('grant permission', async () => {
                await authorizer.addGranter(actionId, from, where, { from: root });
              });

              it('can grant permission for that action in that contract only', async () => {
                await authorizer.removeGranter(actionId, grantee, where, { from });

                expect(await authorizer.canGrant(ACTION_1, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.isGranter(ACTION_1, grantee, WHERE_1)).to.be.false;
              });

              it('cannot grant permission for any other action', async () => {
                await authorizer.removeGranter(actionId, grantee, where, { from });

                expect(await authorizer.canGrant(ACTION_2, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.canGrant(ACTION_1, grantee, EVERYWHERE)).to.be.false;
                expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

                expect(await authorizer.isGranter(ACTION_2, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.isGranter(ACTION_1, grantee, EVERYWHERE)).to.be.false;
                expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
              });
            });

            context('when the sender does not have permission', () => {
              itReverts(actionId, where);
            });
          });

          context('for a any contract', () => {
            const where = EVERYWHERE;

            context('when the sender has permission', () => {
              beforeEach('grant permission', async () => {
                await authorizer.addGranter(actionId, from, where, { from: root });
              });

              it('can grant permission for that action on any contract', async () => {
                await authorizer.removeGranter(actionId, grantee, where, { from });

                expect(await authorizer.canGrant(ACTION_1, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.canGrant(ACTION_1, grantee, EVERYWHERE)).to.be.false;

                expect(await authorizer.isGranter(ACTION_1, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.isGranter(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              });

              it('cannot grant permission for that any other action anywhere', async () => {
                await authorizer.removeGranter(actionId, grantee, where, { from });

                expect(await authorizer.canGrant(ACTION_2, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.canGrant(ACTION_2, grantee, EVERYWHERE)).to.be.false;
                expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

                expect(await authorizer.isGranter(ACTION_2, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.isGranter(ACTION_2, grantee, EVERYWHERE)).to.be.false;
                expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
              });
            });

            context('when the sender does not have permission', () => {
              itReverts(actionId, where);
            });
          });
        });

        context('for a any action', () => {
          const actionId = GENERAL_PERMISSION_SPECIFIER;

          context('for a specific contract', () => {
            const where = WHERE_1;

            context('when the sender has permission', () => {
              beforeEach('grant permission', async () => {
                await authorizer.addGranter(actionId, from, where, { from: root });
              });

              it('can grant permission for any action in that contract only', async () => {
                await authorizer.removeGranter(actionId, grantee, where, { from });

                expect(await authorizer.canGrant(ACTION_1, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;

                expect(await authorizer.isGranter(ACTION_1, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
              });

              it('cannot grant permissions in any other contract', async () => {
                await authorizer.removeGranter(actionId, grantee, where, { from });

                expect(await authorizer.canGrant(ACTION_1, grantee, WHERE_2)).to.be.false;
                expect(await authorizer.canGrant(ACTION_1, grantee, EVERYWHERE)).to.be.false;
                expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

                expect(await authorizer.isGranter(ACTION_1, grantee, WHERE_2)).to.be.false;
                expect(await authorizer.isGranter(ACTION_1, grantee, EVERYWHERE)).to.be.false;
                expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
              });
            });

            context('when the sender does not have permission', () => {
              itReverts(actionId, where);
            });
          });

          context('for a any contract', () => {
            const where = EVERYWHERE;

            context('when the sender has permission', () => {
              beforeEach('grant permission', async () => {
                await authorizer.addGranter(actionId, from, where, { from: root });
              });

              it('can grant permission for any action anywhere', async () => {
                await authorizer.removeGranter(actionId, grantee, where, { from });

                expect(await authorizer.canGrant(ACTION_1, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.canGrant(ACTION_1, grantee, EVERYWHERE)).to.be.false;
                expect(await authorizer.canGrant(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

                expect(await authorizer.isGranter(ACTION_1, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.isGranter(ACTION_1, grantee, EVERYWHERE)).to.be.false;
                expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
              });
            });

            context('when the sender does not have permission', () => {
              itReverts(actionId, where);
            });
          });
        });
      });
    });
  });

  describe('manageRevoker', () => {
    context('when the sender is the root', () => {
      beforeEach('set sender', async () => {
        from = root;
      });

      sharedBeforeEach('remove root global revoke permission', async () => {
        // The root address has global revoke permissions for all action IDs.
        // This also allows the root to add and remove revokers for all action IDs, however it's possible for root
        // to lose these global permissions under certain circumstances and root must be able to recover.
        // We perform these tests under the conditions that root has lost this permission to ensure that it can recover.
        await authorizer.removeRevoker(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE, { from: root });
      });

      context('when granting permission', () => {
        context('for a specific action', () => {
          const actionId = ACTION_1;

          context('for a specific contract', () => {
            const where = WHERE_1;

            it('can grant permission for that action in that contract only', async () => {
              await authorizer.addRevoker(actionId, grantee, where, { from });

              expect(await authorizer.canRevoke(ACTION_1, grantee, WHERE_1)).to.be.true;
              expect(await authorizer.isRevoker(ACTION_1, grantee, WHERE_1)).to.be.true;
            });

            it('cannot grant permission for any other action', async () => {
              await authorizer.addRevoker(actionId, grantee, where, { from });

              expect(await authorizer.canRevoke(ACTION_2, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canRevoke(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

              expect(await authorizer.isRevoker(ACTION_2, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isRevoker(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
            });
          });

          context('for a any contract', () => {
            const where = EVERYWHERE;

            it('can grant permission for that action on any contract', async () => {
              await authorizer.addRevoker(actionId, grantee, where, { from });

              expect(await authorizer.canRevoke(ACTION_1, grantee, WHERE_1)).to.be.true;
              expect(await authorizer.canRevoke(ACTION_1, grantee, EVERYWHERE)).to.be.true;

              expect(await authorizer.isRevoker(ACTION_1, grantee, WHERE_1)).to.be.true;
              expect(await authorizer.isRevoker(ACTION_1, grantee, EVERYWHERE)).to.be.true;
            });

            it('cannot grant permission for that any other action anywhere', async () => {
              await authorizer.addRevoker(actionId, grantee, where, { from });

              expect(await authorizer.canRevoke(ACTION_2, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canRevoke(ACTION_2, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

              expect(await authorizer.isRevoker(ACTION_2, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isRevoker(ACTION_2, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
            });
          });
        });

        context('for a any action', () => {
          const actionId = GENERAL_PERMISSION_SPECIFIER;

          context('for a specific contract', () => {
            const where = WHERE_1;

            it('can grant permission for any action in that contract only', async () => {
              await authorizer.addRevoker(actionId, grantee, where, { from });

              expect(await authorizer.canRevoke(ACTION_1, grantee, WHERE_1)).to.be.true;
              expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.true;

              expect(await authorizer.isRevoker(ACTION_1, grantee, WHERE_1)).to.be.true;
              expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.true;
            });

            it('cannot grant permissions in any other contract', async () => {
              await authorizer.addRevoker(actionId, grantee, where, { from });

              expect(await authorizer.canRevoke(ACTION_1, grantee, WHERE_2)).to.be.false;
              expect(await authorizer.canRevoke(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

              expect(await authorizer.isRevoker(ACTION_1, grantee, WHERE_2)).to.be.false;
              expect(await authorizer.isRevoker(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
            });
          });

          context('for a any contract', () => {
            const where = EVERYWHERE;

            it('can grant permission for any action anywhere', async () => {
              await authorizer.addRevoker(actionId, grantee, where, { from });

              expect(await authorizer.canRevoke(ACTION_1, grantee, WHERE_1)).to.be.true;
              expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.true;
              expect(await authorizer.canRevoke(ACTION_1, grantee, EVERYWHERE)).to.be.true;
              expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.true;

              expect(await authorizer.isRevoker(ACTION_1, grantee, WHERE_1)).to.be.true;
              expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.true;
              expect(await authorizer.isRevoker(ACTION_1, grantee, EVERYWHERE)).to.be.true;
              expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.true;
            });
          });
        });
      });

      context('when revoking permission', () => {
        context('for a specific action', () => {
          const actionId = ACTION_1;

          context('for a specific contract', () => {
            const where = WHERE_1;

            it('cannot grant permission for that action in that contract only', async () => {
              await authorizer.addRevoker(actionId, grantee, where, { from });
              await authorizer.removeRevoker(actionId, grantee, where, { from });

              expect(await authorizer.canRevoke(ACTION_1, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isRevoker(ACTION_1, grantee, WHERE_1)).to.be.false;
            });

            it('cannot grant permission for any other action', async () => {
              await authorizer.addRevoker(actionId, grantee, where, { from });

              expect(await authorizer.canRevoke(ACTION_2, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canRevoke(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

              expect(await authorizer.isRevoker(ACTION_2, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isRevoker(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
            });
          });

          context('for a any contract', () => {
            const where = EVERYWHERE;

            it('cannot grant permission for that action on any contract', async () => {
              await authorizer.addRevoker(actionId, grantee, where, { from });
              await authorizer.removeRevoker(actionId, grantee, where, { from });

              expect(await authorizer.canRevoke(ACTION_1, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canRevoke(ACTION_1, grantee, EVERYWHERE)).to.be.false;

              expect(await authorizer.isRevoker(ACTION_1, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isRevoker(ACTION_1, grantee, EVERYWHERE)).to.be.false;
            });

            it('cannot grant permission for that any other action anywhere', async () => {
              await authorizer.addRevoker(actionId, grantee, where, { from });

              expect(await authorizer.canRevoke(ACTION_2, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canRevoke(ACTION_2, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

              expect(await authorizer.isRevoker(ACTION_2, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isRevoker(ACTION_2, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
            });
          });
        });

        context('for a any action', () => {
          const actionId = GENERAL_PERMISSION_SPECIFIER;

          context('for a specific contract', () => {
            const where = WHERE_1;

            it('cannot grant permission for any action in that contract only', async () => {
              await authorizer.addRevoker(actionId, grantee, where, { from });
              await authorizer.removeRevoker(actionId, grantee, where, { from });

              expect(await authorizer.canRevoke(ACTION_1, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;

              expect(await authorizer.isRevoker(ACTION_1, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
            });

            it('cannot grant permissions in any other contract', async () => {
              await authorizer.addRevoker(actionId, grantee, where, { from });
              await authorizer.removeRevoker(actionId, grantee, where, { from });

              expect(await authorizer.canRevoke(ACTION_1, grantee, WHERE_2)).to.be.false;
              expect(await authorizer.canRevoke(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

              expect(await authorizer.isRevoker(ACTION_1, grantee, WHERE_2)).to.be.false;
              expect(await authorizer.isRevoker(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
            });
          });

          context('for a any contract', () => {
            const where = EVERYWHERE;

            it('cannot grant permission for any action anywhere', async () => {
              await authorizer.addRevoker(actionId, grantee, where, { from });
              await authorizer.removeRevoker(actionId, grantee, where, { from });

              expect(await authorizer.canRevoke(ACTION_1, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canRevoke(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

              expect(await authorizer.isRevoker(ACTION_1, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.isRevoker(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
            });
          });
        });
      });
    });

    context('when the sender is not the root', () => {
      beforeEach('set sender', async () => {
        from = other;
      });

      context('when granting permission', () => {
        const itReverts = (actionId: string, where: string) => {
          it('reverts', async () => {
            await expect(authorizer.addRevoker(actionId, grantee, where, { from })).to.be.revertedWith(
              'SENDER_NOT_ALLOWED'
            );
          });
        };

        context('for a specific action', () => {
          const actionId = ACTION_1;

          context('for a specific contract', () => {
            const where = WHERE_1;

            context('when the sender has permission', () => {
              beforeEach('grant permission', async () => {
                await authorizer.addRevoker(actionId, from, where, { from: root });
              });

              itReverts(actionId, where);
            });

            context('when the sender does not have permission', () => {
              itReverts(actionId, where);
            });
          });

          context('for a any contract', () => {
            const where = EVERYWHERE;

            context('when the sender has permission', () => {
              beforeEach('grant permission', async () => {
                await authorizer.addRevoker(actionId, from, where, { from: root });
              });

              itReverts(actionId, where);
            });

            context('when the sender does not have permission', () => {
              itReverts(actionId, where);
            });
          });
        });

        context('for a any action', () => {
          const actionId = GENERAL_PERMISSION_SPECIFIER;

          context('for a specific contract', () => {
            const where = WHERE_1;

            context('when the sender has permission', () => {
              beforeEach('grant permission', async () => {
                await authorizer.addRevoker(actionId, from, where, { from: root });
              });

              itReverts(actionId, where);
            });

            context('when the sender does not have permission', () => {
              itReverts(actionId, where);
            });
          });

          context('for a any contract', () => {
            const where = EVERYWHERE;

            context('when the sender has permission', () => {
              beforeEach('grant permission', async () => {
                await authorizer.addRevoker(actionId, from, where, { from: root });
              });

              itReverts(actionId, where);
            });

            context('when the sender does not have permission', () => {
              itReverts(actionId, where);
            });
          });
        });
      });

      context('when revoking permission', () => {
        const itReverts = (actionId: string, where: string) => {
          it('reverts', async () => {
            await expect(authorizer.removeRevoker(actionId, grantee, where, { from })).to.be.revertedWith(
              'SENDER_NOT_ALLOWED'
            );
          });
        };

        context('for a specific action', () => {
          const actionId = ACTION_1;

          context('for a specific contract', () => {
            const where = WHERE_1;

            context('when the sender has permission', () => {
              beforeEach('grant permission', async () => {
                await authorizer.addRevoker(actionId, from, where, { from: root });
              });

              it('can grant permission for that action in that contract only', async () => {
                await authorizer.removeRevoker(actionId, grantee, where, { from });

                expect(await authorizer.canRevoke(ACTION_1, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.isRevoker(ACTION_1, grantee, WHERE_1)).to.be.false;
              });

              it('cannot grant permission for any other action', async () => {
                await authorizer.removeRevoker(actionId, grantee, where, { from });

                expect(await authorizer.canRevoke(ACTION_2, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.canRevoke(ACTION_1, grantee, EVERYWHERE)).to.be.false;
                expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

                expect(await authorizer.isRevoker(ACTION_2, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.isRevoker(ACTION_1, grantee, EVERYWHERE)).to.be.false;
                expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
              });
            });

            context('when the sender does not have permission', () => {
              itReverts(actionId, where);
            });
          });

          context('for a any contract', () => {
            const where = EVERYWHERE;

            context('when the sender has permission', () => {
              beforeEach('grant permission', async () => {
                await authorizer.addRevoker(actionId, from, where, { from: root });
              });

              it('can grant permission for that action on any contract', async () => {
                await authorizer.removeRevoker(actionId, grantee, where, { from });

                expect(await authorizer.canRevoke(ACTION_1, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.canRevoke(ACTION_1, grantee, EVERYWHERE)).to.be.false;

                expect(await authorizer.isRevoker(ACTION_1, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.isRevoker(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              });

              it('cannot grant permission for that any other action anywhere', async () => {
                await authorizer.removeRevoker(actionId, grantee, where, { from });

                expect(await authorizer.canRevoke(ACTION_2, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.canRevoke(ACTION_2, grantee, EVERYWHERE)).to.be.false;
                expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

                expect(await authorizer.isRevoker(ACTION_2, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.isRevoker(ACTION_2, grantee, EVERYWHERE)).to.be.false;
                expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
              });
            });

            context('when the sender does not have permission', () => {
              itReverts(actionId, where);
            });
          });
        });

        context('for a any action', () => {
          const actionId = GENERAL_PERMISSION_SPECIFIER;

          context('for a specific contract', () => {
            const where = WHERE_1;

            context('when the sender has permission', () => {
              beforeEach('grant permission', async () => {
                await authorizer.addRevoker(actionId, from, where, { from: root });
              });

              it('can grant permission for any action in that contract only', async () => {
                await authorizer.removeRevoker(actionId, grantee, where, { from });

                expect(await authorizer.canRevoke(ACTION_1, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;

                expect(await authorizer.isRevoker(ACTION_1, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
              });

              it('cannot grant permissions in any other contract', async () => {
                await authorizer.removeRevoker(actionId, grantee, where, { from });

                expect(await authorizer.canRevoke(ACTION_1, grantee, WHERE_2)).to.be.false;
                expect(await authorizer.canRevoke(ACTION_1, grantee, EVERYWHERE)).to.be.false;
                expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

                expect(await authorizer.isRevoker(ACTION_1, grantee, WHERE_2)).to.be.false;
                expect(await authorizer.isRevoker(ACTION_1, grantee, EVERYWHERE)).to.be.false;
                expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
              });
            });

            context('when the sender does not have permission', () => {
              itReverts(actionId, where);
            });
          });

          context('for a any contract', () => {
            const where = EVERYWHERE;

            context('when the sender has permission', () => {
              beforeEach('grant permission', async () => {
                await authorizer.addRevoker(actionId, from, where, { from: root });
              });

              it('can grant permission for any action anywhere', async () => {
                await authorizer.removeRevoker(actionId, grantee, where, { from });

                expect(await authorizer.canRevoke(ACTION_1, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.canRevoke(ACTION_1, grantee, EVERYWHERE)).to.be.false;
                expect(await authorizer.canRevoke(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;

                expect(await authorizer.isRevoker(ACTION_1, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, WHERE_1)).to.be.false;
                expect(await authorizer.isRevoker(ACTION_1, grantee, EVERYWHERE)).to.be.false;
                expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
              });
            });

            context('when the sender does not have permission', () => {
              itReverts(actionId, where);
            });
          });
        });
      });
    });
  });

  describe('grantPermissions', () => {
    context('when the sender is the root', () => {
      beforeEach('set sender', async () => {
        from = root;
      });

      context('when the target does not have the permission granted', () => {
        context('when there is no delay set to grant permissions', () => {
          it('grants permission to perform the requested actions for the requested contracts', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.true;
          });

          it('does not grant permission to perform the requested actions everywhere', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
          });

          it('does not grant permission to perform the requested actions for other contracts', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.false;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from })).wait();

            ACTIONS.forEach((action, i) => {
              expectEvent.inReceipt(receipt, 'PermissionGranted', {
                actionId: action,
                account: grantee.address,
                where: WHERE[i],
              });
            });
          });
        });

        context('when there is a delay set to grant permissions', () => {
          const delay = DAY;
          let grantActionId: string;

          sharedBeforeEach('set constants', async () => {
            grantActionId = await authorizer.getGrantPermissionActionId(ACTION_1);
          });

          sharedBeforeEach('set delay', async () => {
            const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
            await authorizer.setDelay(setAuthorizerAction, delay * 2, { from: root });
            await authorizer.setDelay(grantActionId, delay, { from: root });
          });

          it('reverts', async () => {
            await expect(authorizer.grantPermissions(ACTION_1, grantee, WHERE_1, { from })).to.be.revertedWith(
              'SENDER_NOT_ALLOWED'
            );
          });

          it('can schedule a grant permission', async () => {
            const id = await authorizer.scheduleGrantPermission(ACTION_1, grantee, WHERE_1, [], { from });

            await advanceTime(delay);
            await authorizer.execute(id, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.false;
          });
        });
      });

      context('when the target has the permission granted', () => {
        context('when the permission was granted for a set of contracts', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
          });

          it('ignores the request and can still perform those actions', async () => {
            await expect(authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from })).not.to.reverted;

            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.true;
          });

          it('does not grant permission to perform the requested actions everywhere', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
          });

          it('does not grant permission to perform the requested actions for other contracts', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.false;
          });

          it('does not emit an event', async () => {
            const tx = await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
            expectEvent.notEmitted(await tx.wait(), 'PermissionGranted');
          });
        });

        context('when the permission was granted globally', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });
          });

          it('grants permission to perform the requested actions for the requested contracts', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_2)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.true;
          });

          it('still can perform the requested actions everywhere', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.true;
          });

          it('still can perform the requested actions for other contracts', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.true;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from })).wait();

            ACTIONS.forEach((action, i) => {
              expectEvent.inReceipt(receipt, 'PermissionGranted', {
                actionId: action,
                account: grantee.address,
                where: WHERE[i],
              });
            });
          });
        });
      });
    });

    context('when the sender is not the root', () => {
      beforeEach('set sender', async () => {
        from = grantee;
      });

      it('reverts', async () => {
        await expect(authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from })).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });
  });

  describe('grantPermissionsGlobally', () => {
    context('when the sender is the root', () => {
      beforeEach('set sender', async () => {
        from = root;
      });

      context('when the target does not have the permission granted', () => {
        it('grants permission to perform the requested actions everywhere', async () => {
          await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.true;
          expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.true;
        });

        it('grants permission to perform the requested actions in any specific contract', async () => {
          await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.true;
          expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.true;
        });

        it('emits an event', async () => {
          const receipt = await (await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from })).wait();

          for (const action of ACTIONS) {
            expectEvent.inReceipt(receipt, 'PermissionGranted', {
              actionId: action,
              account: grantee.address,
              where: TimelockAuthorizer.EVERYWHERE,
            });
          }
        });
      });

      context('when the target has the permission granted', () => {
        context('when the permission was granted for a set of contracts', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
          });

          it('grants permission to perform the requested actions everywhere', async () => {
            await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.true;
          });

          it('still can perform the requested actions for the previously granted contracts', async () => {
            await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_2)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.true;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from })).wait();

            for (const action of ACTIONS) {
              expectEvent.inReceipt(receipt, 'PermissionGranted', {
                actionId: action,
                account: grantee.address,
                where: TimelockAuthorizer.EVERYWHERE,
              });
            }
          });
        });

        context('when the permission was granted globally', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });
          });

          it('ignores the request and can still perform the requested actions everywhere', async () => {
            await expect(authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from })).not.to.be.reverted;

            expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.true;
          });

          it('ignores the request and can still perform the requested actions in any specific contract', async () => {
            await expect(authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from })).not.to.be.reverted;

            expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.true;
          });

          it('does not emit an event', async () => {
            const tx = await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });
            expectEvent.notEmitted(await tx.wait(), 'PermissionGrantedGlobally');
          });
        });
      });
    });

    context('when the sender is not the root', () => {
      beforeEach('set sender', async () => {
        from = grantee;
      });

      it('reverts', async () => {
        await expect(authorizer.grantPermissionsGlobally(ACTIONS, grantee)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });

  describe('revokePermissions', () => {
    context('when the sender is the root', () => {
      beforeEach('set sender', async () => {
        from = root;
      });

      context('when the target does not have the permission granted', () => {
        it('ignores the request and cannot perform the requested actions everywhere', async () => {
          await expect(authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
        });

        it('ignores the request and cannot perform the requested actions in any specific contract', async () => {
          await expect(authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.false;
        });

        it('does not emit an event', async () => {
          const tx = await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
          expectEvent.notEmitted(await tx.wait(), 'PermissionRevoked');
        });
      });

      context('when the target has the permission granted', () => {
        context('when the permission was granted for a set of contracts', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
          });

          context('when there is no delay set to revoke permissions', () => {
            it('revokes the requested permission for the requested contracts', async () => {
              await authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from });

              expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_2)).to.be.false;
              expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.false;
            });

            it('still cannot perform the requested actions everywhere', async () => {
              await authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from });

              expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
              expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
            });

            it('emits an event', async () => {
              const receipt = await (await authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from })).wait();

              ACTIONS.forEach((action, i) => {
                expectEvent.inReceipt(receipt, 'PermissionRevoked', {
                  actionId: action,
                  account: grantee.address,
                  where: WHERE[i],
                });
              });
            });
          });

          context('when there is a delay set to revoke permissions', () => {
            const delay = DAY;
            let revokeActionId: string;

            sharedBeforeEach('set constants', async () => {
              revokeActionId = await authorizer.getRevokePermissionActionId(ACTION_1);
            });

            sharedBeforeEach('set delay', async () => {
              const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
              await authorizer.setDelay(setAuthorizerAction, delay * 2, { from: root });
              await authorizer.setDelay(revokeActionId, delay, { from: root });
            });

            it('reverts', async () => {
              await expect(authorizer.revokePermissions(ACTION_1, grantee, WHERE_1, { from })).to.be.revertedWith(
                'SENDER_NOT_ALLOWED'
              );
            });

            it('can schedule a revoke permission', async () => {
              const id = await authorizer.scheduleRevokePermission(ACTION_1, grantee, WHERE_1, [], { from });

              await advanceTime(delay);
              await authorizer.execute(id, { from });

              expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.false;
              expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.true;
            });
          });
        });

        context('when the permission was granted globally', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });
          });

          it('still can perform the requested actions for the requested contracts', async () => {
            await authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_2)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.true;
          });

          it('still can perform the requested actions everywhere', async () => {
            await authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.true;
          });

          it('does not emit an event', async () => {
            const tx = await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
            expectEvent.notEmitted(await tx.wait(), 'PermissionRevoked');
          });
        });
      });
    });

    context('when the sender is not the root', () => {
      beforeEach('set sender', async () => {
        from = grantee;
      });

      it('reverts', async () => {
        await expect(authorizer.revokePermissions(ACTIONS, grantee, WHERE, { from })).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });
  });

  describe('revokePermissionsGlobally', () => {
    context('when the sender is the root', () => {
      beforeEach('set sender', async () => {
        from = root;
      });

      context('when the sender does not have the permission granted', () => {
        it('ignores the request and cannot perform the requested actions everywhere', async () => {
          await expect(authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
        });

        it('ignores the request and cannot perform the requested actions in any specific contract', async () => {
          await expect(authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from })).not.to.be.reverted;

          expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.false;
        });

        it('does not emit an event', async () => {
          const tx = await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from });
          expectEvent.notEmitted(await tx.wait(), 'PermissionRevokedGlobally');
        });
      });

      context('when the grantee has the permission granted', () => {
        context('when the permission was granted for a set of contracts', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from });
          });

          it('still cannot perform the requested actions everywhere', async () => {
            await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
          });

          it('still can perform the requested actions for the previously granted permissions', async () => {
            await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.true;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.true;
          });

          it('does not emit an event', async () => {
            const tx = await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from });
            expectEvent.notEmitted(await tx.wait(), 'PermissionRevokedGlobally');
          });
        });

        context('when the permission was granted globally', () => {
          sharedBeforeEach('grant permissions', async () => {
            await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from });
          });

          it('revokes the requested global permission and cannot perform the requested actions everywhere', async () => {
            await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_1)).to.be.false;
            expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_2)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.false;
          });

          it('cannot perform the requested actions in any specific contract', async () => {
            await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from });

            expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.false;
            expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.false;
          });

          it('emits an event', async () => {
            const receipt = await (await authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from })).wait();

            for (const action of ACTIONS) {
              expectEvent.inReceipt(receipt, 'PermissionRevoked', {
                actionId: action,
                account: grantee.address,
                where: TimelockAuthorizer.EVERYWHERE,
              });
            }
          });
        });
      });
    });

    context('when the sender is not the root', () => {
      beforeEach('set sender', async () => {
        from = grantee;
      });

      it('reverts', async () => {
        await expect(authorizer.revokePermissionsGlobally(ACTIONS, grantee, { from })).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });
  });

  describe('renouncePermissions', () => {
    beforeEach('set sender', async () => {
      from = grantee;
    });

    context('when the sender does not have the permission granted', () => {
      it('ignores the request and still cannot perform the requested actions everywhere', async () => {
        await expect(authorizer.renouncePermissions(ACTIONS, WHERE, { from })).not.to.be.reverted;

        expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
        expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
      });

      it('ignores the request and still cannot perform the requested actions in any specific contract', async () => {
        await expect(authorizer.renouncePermissions(ACTIONS, WHERE, { from })).not.to.be.reverted;

        expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.false;
        expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.false;
      });
    });

    context('when the sender has the permission granted', () => {
      context('when the sender has the permission granted for a specific contract', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from: root });
        });

        it('revokes the requested permission for the requested contracts', async () => {
          await authorizer.renouncePermissions(ACTIONS, WHERE, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_1)).to.be.false;
          expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_2)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.false;
        });

        it('still cannot perform the requested actions everywhere', async () => {
          await authorizer.renouncePermissions(ACTIONS, WHERE, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
        });
      });

      context('when the sender has the permission granted globally', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from: root });
        });

        it('still can perform the requested actions for the requested contracts', async () => {
          await authorizer.renouncePermissions(ACTIONS, WHERE, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.true;
          expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_1)).to.be.true;
          expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_2)).to.be.true;
          expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.true;
        });

        it('still can perform the requested actions everywhere', async () => {
          await authorizer.renouncePermissions(ACTIONS, WHERE, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.true;
          expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.true;
        });
      });
    });
  });

  describe('renouncePermissionsGlobally', () => {
    beforeEach('set sender', async () => {
      from = grantee;
    });

    context('when the sender does not have the permission granted', () => {
      it('ignores the request and still cannot perform the requested actions everywhere', async () => {
        await expect(authorizer.renouncePermissionsGlobally(ACTIONS, { from })).not.to.be.reverted;

        expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
        expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
      });

      it('ignores the request and still cannot perform the requested actions in any specific contract', async () => {
        await expect(authorizer.renouncePermissionsGlobally(ACTIONS, { from })).not.to.be.reverted;

        expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.false;
        expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.false;
      });
    });

    context('when the sender has the permission granted', () => {
      context('when the sender has the permission granted for a specific contract', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantPermissions(ACTIONS, grantee, WHERE, { from: root });
        });

        it('still can perform the requested actions for the requested contracts', async () => {
          await authorizer.renouncePermissionsGlobally(ACTIONS, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, WHERE_1)).to.be.true;
          expect(await authorizer.canPerform(ACTION_2, grantee, WHERE_2)).to.be.true;
        });

        it('still cannot perform the requested actions everywhere', async () => {
          await authorizer.renouncePermissionsGlobally(ACTIONS, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
        });
      });

      context('when the sender has the permission granted globally', () => {
        sharedBeforeEach('grant permissions', async () => {
          await authorizer.grantPermissionsGlobally(ACTIONS, grantee, { from: root });
        });

        it('revokes the requested permissions everywhere', async () => {
          await authorizer.renouncePermissionsGlobally(ACTIONS, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, EVERYWHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, EVERYWHERE)).to.be.false;
        });

        it('still cannot perform the requested actions in any specific contract', async () => {
          await authorizer.renouncePermissionsGlobally(ACTIONS, { from });

          expect(await authorizer.canPerform(ACTION_1, grantee, NOT_WHERE)).to.be.false;
          expect(await authorizer.canPerform(ACTION_2, grantee, NOT_WHERE)).to.be.false;
        });
      });
    });
  });

  describe('setDelay', () => {
    const action = ACTION_1;

    context('when the sender is the root', () => {
      context('when the new delay is less than 2 years', () => {
        const delay = DAY;

        context('when the action is scheduled', () => {
          let expectedData: string;

          sharedBeforeEach('compute expected data', async () => {
            expectedData = authorizer.instance.interface.encodeFunctionData('setDelay', [action, delay]);
          });

          context('when the delay is less than or equal to the delay to set the authorizer in the vault', () => {
            sharedBeforeEach('set delay to set authorizer', async () => {
              const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
              await authorizer.setDelay(setAuthorizerAction, delay * 2, { from: root });
            });

            function itSchedulesTheDelayChangeCorrectly(expectedDelay: number) {
              it('schedules a delay change', async () => {
                const id = await authorizer.scheduleDelayChange(action, delay, [], { from: root });

                const scheduledExecution = await authorizer.getScheduledExecution(id);
                expect(scheduledExecution.executed).to.be.false;
                expect(scheduledExecution.data).to.be.equal(expectedData);
                expect(scheduledExecution.where).to.be.equal(authorizer.address);
                expect(scheduledExecution.protected).to.be.false;
                expect(scheduledExecution.executableAt).to.be.at.almostEqual(
                  (await currentTimestamp()).add(expectedDelay)
                );
              });

              it('can be executed after the expected delay', async () => {
                const id = await authorizer.scheduleDelayChange(action, delay, [], { from: root });

                await advanceTime(expectedDelay);
                await authorizer.execute(id);
                expect(await authorizer.delay(action)).to.be.equal(delay);
              });

              it('emits an event', async () => {
                const id = await authorizer.scheduleDelayChange(action, delay, [], { from: root });

                await advanceTime(expectedDelay);
                const receipt = await authorizer.execute(id);
                expectEvent.inReceipt(await receipt.wait(), 'ActionDelaySet', { actionId: action, delay });
              });
            }

            context('when the delay is being increased', () => {
              context('when there was no previous delay', () => {
                itSchedulesTheDelayChangeCorrectly(MIN_DELAY);
              });

              context('when there was a previous delay set', () => {
                const previousDelay = delay / 2;

                sharedBeforeEach('set previous delay', async () => {
                  await authorizer.setDelay(action, previousDelay, { from: root });
                });

                itSchedulesTheDelayChangeCorrectly(MIN_DELAY);
              });
            });

            context('when the delay is being decreased', () => {
              const previousDelay = delay * 2;
              const executionDelay = Math.max(previousDelay - delay, MIN_DELAY);

              sharedBeforeEach('set previous delay', async () => {
                await authorizer.setDelay(action, previousDelay, { from: root });
              });

              itSchedulesTheDelayChangeCorrectly(executionDelay);
            });
          });

          context('when the delay is greater than the delay to set the authorizer in the vault', () => {
            it('reverts on execution', async () => {
              const id = await authorizer.scheduleDelayChange(action, delay, [], { from: root });
              await advanceTime(MIN_DELAY);
              await expect(authorizer.execute(id)).to.be.revertedWith('DELAY_EXCEEDS_SET_AUTHORIZER');
            });
          });
        });

        context('when the action is performed directly', () => {
          it('reverts', async () => {
            await expect(authorizer.instance.setDelay(action, delay)).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });
      });

      context('when the new delay is more than 2 years', () => {
        const delay = DAY * 900;

        it('reverts', async () => {
          await expect(authorizer.scheduleDelayChange(action, delay, [])).to.be.revertedWith('DELAY_TOO_LARGE');
        });
      });
    });

    context('when the sender is not the root', () => {
      sharedBeforeEach('grant permission', async () => {
        // We never check that the caller has this permission but if we were to check a permission
        // it would be this one, we then grant it to the caller so we can be sure about why the call is reverting.
        const setDelayActionId = await authorizer.getScheduleDelayActionId(action);
        await authorizer.grantPermissions(setDelayActionId, grantee, authorizer, { from: root });
      });

      it('reverts', async () => {
        await expect(authorizer.scheduleDelayChange(action, DAY, [], { from: grantee })).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });
  });

  describe('schedule', () => {
    const delay = DAY * 5;
    const functionData = '0x0123456789abcdef';

    let where: Contract, action: string, data: string, executors: SignerWithAddress[];
    let anotherAuthenticatedContract: Contract;

    sharedBeforeEach('deploy sample instances', async () => {
      anotherAuthenticatedContract = await deploy('MockAuthenticatedContract', { args: [vault.address] });
    });

    sharedBeforeEach('set authorizer permission delay', async () => {
      // We must set a delay for the `setAuthorizer` function as well to be able to give one to `protectedFunction`
      const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
      await authorizer.setDelay(setAuthorizerAction, 2 * delay, { from: root });
    });

    const schedule = async (): Promise<number> => {
      data = authenticatedContract.interface.encodeFunctionData('protectedFunction', [functionData]);
      return authorizer.schedule(where, data, executors || [], { from: grantee });
    };

    context('when the target is not the authorizer', () => {
      sharedBeforeEach('set where', async () => {
        where = authenticatedContract;
      });

      context('when the sender has permission', () => {
        context('when the sender has permission for the requested action', () => {
          sharedBeforeEach('set action', async () => {
            action = await actionId(authenticatedContract, 'protectedFunction');
          });

          context('when the sender has permission for the requested contract', () => {
            sharedBeforeEach('grant permission', async () => {
              await authorizer.grantPermissions(action, grantee, authenticatedContract, { from: root });
            });

            context('when there is a delay set', () => {
              const delay = DAY * 5;

              sharedBeforeEach('set delay', async () => {
                await authorizer.setDelay(action, delay, { from: root });
              });

              context('when no executors are specified', () => {
                sharedBeforeEach('set executors', async () => {
                  executors = [];
                });

                it('schedules a non-protected execution', async () => {
                  const id = await schedule();

                  const scheduledExecution = await authorizer.getScheduledExecution(id);
                  expect(scheduledExecution.executed).to.be.false;
                  expect(scheduledExecution.data).to.be.equal(data);
                  expect(scheduledExecution.where).to.be.equal(where.address);
                  expect(scheduledExecution.protected).to.be.false;
                  expect(scheduledExecution.executableAt).to.be.at.almostEqual((await currentTimestamp()).add(delay));
                });

                it('cannot execute the action immediately', async () => {
                  const id = await schedule();
                  await expect(authorizer.execute(id)).to.be.revertedWith('ACTION_NOT_EXECUTABLE');
                });

                it('can be executed by anyone', async () => {
                  const id = await schedule();
                  await advanceTime(delay);

                  const receipt = await authorizer.execute(id);
                  expectEvent.inReceipt(await receipt.wait(), 'ExecutionExecuted', { scheduledExecutionId: id });

                  const scheduledExecution = await authorizer.getScheduledExecution(id);
                  expect(scheduledExecution.executed).to.be.true;

                  expectEvent.inIndirectReceipt(
                    await receipt.wait(),
                    authenticatedContract.interface,
                    'ProtectedFunctionCalled',
                    {
                      data: functionData,
                    }
                  );
                });

                it('cannot be executed twice', async () => {
                  const id = await schedule();
                  await advanceTime(delay);

                  await authorizer.execute(id);
                  await expect(authorizer.execute(id)).to.be.revertedWith('ACTION_ALREADY_EXECUTED');
                });
              });

              context('when an executor is specified', () => {
                sharedBeforeEach('set executors', async () => {
                  executors = [root];
                });

                it('schedules the requested execution', async () => {
                  const id = await schedule();

                  const scheduledExecution = await authorizer.getScheduledExecution(id);
                  expect(scheduledExecution.executed).to.be.false;
                  expect(scheduledExecution.data).to.be.equal(data);
                  expect(scheduledExecution.where).to.be.equal(where.address);
                  expect(scheduledExecution.protected).to.be.true;
                  expect(scheduledExecution.executableAt).to.be.at.almostEqual((await currentTimestamp()).add(delay));
                });

                it('cannot execute the action immediately', async () => {
                  const id = await schedule();
                  await expect(authorizer.execute(id, { from: executors[0] })).to.be.revertedWith(
                    'ACTION_NOT_EXECUTABLE'
                  );
                });

                it('can be executed by the executor only', async () => {
                  const id = await schedule();
                  await advanceTime(delay);

                  await expect(authorizer.execute(id, { from: grantee })).to.be.revertedWith('SENDER_NOT_ALLOWED');

                  const receipt = await authorizer.execute(id, { from: executors[0] });
                  expectEvent.inReceipt(await receipt.wait(), 'ExecutionExecuted', { scheduledExecutionId: id });

                  const scheduledExecution = await authorizer.getScheduledExecution(id);
                  expect(scheduledExecution.executed).to.be.true;

                  expectEvent.inIndirectReceipt(
                    await receipt.wait(),
                    authenticatedContract.interface,
                    'ProtectedFunctionCalled',
                    {
                      data: functionData,
                    }
                  );
                });

                it('cannot be executed twice', async () => {
                  const id = await schedule();
                  await advanceTime(delay);

                  await authorizer.execute(id, { from: executors[0] });
                  await expect(authorizer.execute(id, { from: executors[0] })).to.be.revertedWith(
                    'ACTION_ALREADY_EXECUTED'
                  );
                });
              });
            });

            context('when there is no delay set', () => {
              it('reverts', async () => {
                await expect(schedule()).to.be.revertedWith('CANNOT_SCHEDULE_ACTION');
              });
            });
          });

          context('when the sender has permissions for another contract', () => {
            sharedBeforeEach('grant permission', async () => {
              await authorizer.grantPermissions(action, grantee, anotherAuthenticatedContract, { from: root });
            });

            it('reverts', async () => {
              await expect(schedule()).to.be.revertedWith('SENDER_NOT_ALLOWED');
            });
          });
        });

        context('when the sender has permissions for another action', () => {
          sharedBeforeEach('grant permission', async () => {
            action = await actionId(authenticatedContract, 'secondProtectedFunction');
            await authorizer.grantPermissions(action, grantee, authenticatedContract, { from: root });
          });

          it('reverts', async () => {
            await expect(schedule()).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });
      });

      context('when the sender does not have permission', () => {
        it('reverts', async () => {
          await expect(schedule()).to.be.revertedWith('SENDER_NOT_ALLOWED');
        });
      });
    });

    context('when the target is the authorizer', () => {
      sharedBeforeEach('set where', async () => {
        where = authorizer.instance;
      });

      it('reverts', async () => {
        await expect(schedule()).to.be.revertedWith('CANNOT_SCHEDULE_AUTHORIZER_ACTIONS');
      });
    });
  });

  describe('execute', () => {
    const delay = DAY;
    const functionData = '0x0123456789abcdef';
    let executors: SignerWithAddress[];

    sharedBeforeEach('grant protected function permission with delay', async () => {
      // We must set a delay for the `setAuthorizer` function as well to be able to give one to `protectedFunction`
      const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
      await authorizer.setDelay(setAuthorizerAction, delay, { from: root });

      const protectedFunctionAction = await actionId(authenticatedContract, 'protectedFunction');
      await authorizer.setDelay(protectedFunctionAction, delay, { from: root });
      await authorizer.grantPermissions(protectedFunctionAction, grantee, authenticatedContract, { from: root });
    });

    const schedule = async (): Promise<number> => {
      const data = authenticatedContract.interface.encodeFunctionData('protectedFunction', [functionData]);
      return authorizer.schedule(authenticatedContract, data, executors || [], { from: grantee });
    };

    context('when the given id is valid', () => {
      let id: BigNumberish;

      context('when the action is protected', () => {
        sharedBeforeEach('set executors', async () => {
          executors = [root];
        });

        context('when the sender is an allowed executor', () => {
          sharedBeforeEach('set sender', async () => {
            from = executors[0];
          });

          context('when the action was not cancelled', () => {
            sharedBeforeEach('schedule execution', async () => {
              id = await schedule();
            });

            context('when the delay has passed', () => {
              sharedBeforeEach('advance time', async () => {
                await advanceTime(delay);
              });

              it('executes the action', async () => {
                const receipt = await authorizer.execute(id, { from });

                const scheduledExecution = await authorizer.getScheduledExecution(id);
                expect(scheduledExecution.executed).to.be.true;

                expectEvent.inIndirectReceipt(
                  await receipt.wait(),
                  authenticatedContract.interface,
                  'ProtectedFunctionCalled',
                  { data: functionData }
                );
              });

              it('emits an event', async () => {
                const receipt = await authorizer.execute(id, { from });

                expectEvent.inReceipt(await receipt.wait(), 'ExecutionExecuted', {
                  scheduledExecutionId: id,
                });
              });

              it('cannot be executed twice', async () => {
                await authorizer.execute(id, { from });

                await expect(authorizer.execute(id, { from })).to.be.revertedWith('ACTION_ALREADY_EXECUTED');
              });
            });

            context('when the delay has not passed', () => {
              it('reverts', async () => {
                await expect(authorizer.execute(id, { from })).to.be.revertedWith('ACTION_NOT_EXECUTABLE');
              });
            });
          });

          context('when the action was cancelled', () => {
            sharedBeforeEach('schedule and cancel action', async () => {
              id = await schedule();
              await authorizer.cancel(id, { from: grantee });
            });

            it('reverts', async () => {
              await expect(authorizer.execute(id, { from })).to.be.revertedWith('ACTION_ALREADY_CANCELLED');
            });
          });
        });

        context('when the sender is not an allowed executor', () => {
          sharedBeforeEach('set sender', async () => {
            from = grantee;
          });

          it('reverts', async () => {
            id = await schedule();
            await advanceTime(delay);

            await expect(authorizer.execute(id, { from })).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });
      });

      context('when the action is not protected', () => {
        sharedBeforeEach('set executors', async () => {
          executors = [];
        });

        it('can be executed by anyone', async () => {
          id = await schedule();
          await advanceTime(delay);

          const receipt = await authorizer.execute(id);

          const scheduledExecution = await authorizer.getScheduledExecution(id);
          expect(scheduledExecution.executed).to.be.true;

          expectEvent.inIndirectReceipt(
            await receipt.wait(),
            authenticatedContract.interface,
            'ProtectedFunctionCalled',
            {
              data: functionData,
            }
          );
        });
      });
    });

    context('when the given id is not valid', () => {
      it('reverts', async () => {
        await expect(authorizer.execute(100)).to.be.revertedWith('ACTION_DOES_NOT_EXIST');
      });
    });
  });

  describe('cancel', () => {
    const delay = DAY;
    let executors: SignerWithAddress[];

    sharedBeforeEach('grant protected function permission with delay', async () => {
      // We must set a delay for the `setAuthorizer` function as well to be able to give one to `protectedFunction`
      const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
      await authorizer.setDelay(setAuthorizerAction, delay, { from: root });

      const protectedFunctionAction = await actionId(authenticatedContract, 'protectedFunction');
      await authorizer.setDelay(protectedFunctionAction, delay, { from: root });
      await authorizer.grantPermissions(protectedFunctionAction, grantee, authenticatedContract, { from: root });
    });

    const schedule = async (): Promise<number> => {
      const data = authenticatedContract.interface.encodeFunctionData('protectedFunction', ['0x']);
      return authorizer.schedule(authenticatedContract, data, executors || [], { from: grantee });
    };

    context('when the given id is valid', () => {
      let id: BigNumberish;

      function itCancelsTheScheduledAction() {
        context('when the action was not executed', () => {
          sharedBeforeEach('schedule execution', async () => {
            id = await schedule();
          });

          it('cancels the action', async () => {
            await authorizer.cancel(id, { from });

            const scheduledExecution = await authorizer.getScheduledExecution(id);
            expect(scheduledExecution.cancelled).to.be.true;
          });

          it('emits an event', async () => {
            const receipt = await authorizer.cancel(id, { from });

            expectEvent.inReceipt(await receipt.wait(), 'ExecutionCancelled', { scheduledExecutionId: id });
          });

          it('cannot be cancelled twice', async () => {
            await authorizer.cancel(id, { from });

            await expect(authorizer.cancel(id, { from })).to.be.revertedWith('ACTION_ALREADY_CANCELLED');
          });
        });

        context('when the action was executed', () => {
          sharedBeforeEach('schedule and execute action', async () => {
            id = await schedule();
            await advanceTime(delay);
            await authorizer.execute(id);
          });

          it('reverts', async () => {
            await expect(authorizer.cancel(id, { from })).to.be.revertedWith('ACTION_ALREADY_EXECUTED');
          });
        });
      }

      context('when the sender has permission for the requested action', () => {
        sharedBeforeEach('set sender', async () => {
          from = grantee;
        });

        itCancelsTheScheduledAction();
      });

      context('when the sender is root', () => {
        sharedBeforeEach('set sender', async () => {
          from = root;
        });

        itCancelsTheScheduledAction();
      });

      context('when the sender does not have permission for the requested action', () => {
        sharedBeforeEach('set sender', async () => {
          from = other;
        });

        it('reverts', async () => {
          id = await schedule();

          await expect(authorizer.cancel(id, { from })).to.be.revertedWith('SENDER_NOT_ALLOWED');
        });
      });
    });

    context('when the given id is not valid', () => {
      it('reverts', async () => {
        await expect(authorizer.cancel(100)).to.be.revertedWith('ACTION_DOES_NOT_EXIST');
      });
    });
  });

  describe('setPendingRoot', () => {
    let ROOT_CHANGE_DELAY: BigNumberish;

    beforeEach('fetch root change delay', async () => {
      ROOT_CHANGE_DELAY = await authorizer.instance.getRootTransferDelay();
    });

    context('when the sender is the root', async () => {
      context('when trying to execute it directly', async () => {
        it('reverts', async () => {
          await expect(authorizer.instance.setPendingRoot(grantee.address)).to.be.revertedWith('SENDER_NOT_ALLOWED');
        });
      });

      context('when trying to schedule a call', async () => {
        let newPendingRoot: SignerWithAddress;

        function itSetsThePendingRootCorrectly() {
          it('schedules a root change', async () => {
            const expectedData = authorizer.instance.interface.encodeFunctionData('setPendingRoot', [
              newPendingRoot.address,
            ]);

            const id = await authorizer.scheduleRootChange(newPendingRoot, [], { from: root });

            const scheduledExecution = await authorizer.getScheduledExecution(id);
            expect(scheduledExecution.executed).to.be.false;
            expect(scheduledExecution.data).to.be.equal(expectedData);
            expect(scheduledExecution.where).to.be.equal(authorizer.address);
            expect(scheduledExecution.protected).to.be.false;
            expect(scheduledExecution.executableAt).to.be.at.almostEqual(
              (await currentTimestamp()).add(ROOT_CHANGE_DELAY)
            );
          });

          it('can be executed after the delay', async () => {
            const id = await authorizer.scheduleRootChange(newPendingRoot, [], { from: root });

            await expect(authorizer.execute(id)).to.be.revertedWith('ACTION_NOT_EXECUTABLE');

            await advanceTime(ROOT_CHANGE_DELAY);
            await authorizer.execute(id);

            expect(await authorizer.isRoot(root)).to.be.true;
            expect(await authorizer.isPendingRoot(newPendingRoot)).to.be.true;
          });

          it('emits an event', async () => {
            const id = await authorizer.scheduleRootChange(newPendingRoot, [], { from: root });

            await advanceTime(ROOT_CHANGE_DELAY);
            const receipt = await authorizer.execute(id);
            expectEvent.inReceipt(await receipt.wait(), 'PendingRootSet', { pendingRoot: newPendingRoot.address });
          });
        }

        before('set desired pending root', () => {
          newPendingRoot = grantee;
        });

        itSetsThePendingRootCorrectly();

        context('starting a new root transfer while pending root is set', () => {
          // We test this to ensure that executing an action which sets the pending root to an address which cannot
          // call `claimRoot` won't result in the Authorizer being unable to transfer root power to a different address.

          sharedBeforeEach('initiate a root transfer', async () => {
            const id = await authorizer.scheduleRootChange(grantee, [], { from: root });
            await advanceTime(ROOT_CHANGE_DELAY);
            await authorizer.execute(id);
          });

          before('set desired pending root', () => {
            newPendingRoot = other;
          });

          itSetsThePendingRootCorrectly();
        });
      });
    });

    context('when the sender is not the root', async () => {
      it('reverts', async () => {
        await expect(authorizer.scheduleRootChange(grantee, [], { from: grantee })).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });
  });

  describe('claimRoot', () => {
    let ROOT_CHANGE_DELAY: BigNumberish;

    beforeEach('fetch root change delay', async () => {
      ROOT_CHANGE_DELAY = await authorizer.instance.getRootTransferDelay();
    });

    sharedBeforeEach('initiate a root transfer', async () => {
      const id = await authorizer.scheduleRootChange(grantee, [], { from: root });
      await advanceTime(ROOT_CHANGE_DELAY);
      await authorizer.execute(id);
    });

    context('when the sender is the pending root', async () => {
      it('transfers root powers from the current to the pending root', async () => {
        await authorizer.claimRoot({ from: grantee });
        expect(await authorizer.isRoot(root)).to.be.false;
        expect(await authorizer.isRoot(grantee)).to.be.true;
      });

      it('revokes powers to grant and revoke GENERAL_PERMISSION_SPECIFIER on EVERYWHERE from current root', async () => {
        expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE)).to.be.true;
        expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE)).to.be.true;
        await authorizer.claimRoot({ from: grantee });
        expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE)).to.be.false;
        expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE)).to.be.false;
      });

      it('grants powers to grant and revoke GENERAL_PERMISSION_SPECIFIER on EVERYWHERE to the pending root', async () => {
        expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
        expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.false;
        await authorizer.claimRoot({ from: grantee });
        expect(await authorizer.isGranter(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.true;
        expect(await authorizer.isRevoker(GENERAL_PERMISSION_SPECIFIER, grantee, EVERYWHERE)).to.be.true;
      });

      it('resets the pending root address to the zero address', async () => {
        await authorizer.claimRoot({ from: grantee });
        expect(await authorizer.isPendingRoot(root)).to.be.false;
        expect(await authorizer.isPendingRoot(grantee)).to.be.false;
        expect(await authorizer.isPendingRoot(ZERO_ADDRESS)).to.be.true;
      });

      it('emits an event', async () => {
        const receipt = await authorizer.claimRoot({ from: grantee });
        expectEvent.inReceipt(await receipt.wait(), 'RootSet', { root: grantee.address });
        expectEvent.inReceipt(await receipt.wait(), 'PendingRootSet', { pendingRoot: ZERO_ADDRESS });
      });
    });

    context('when the sender is not the pending root', async () => {
      it('reverts', async () => {
        await expect(authorizer.claimRoot({ from: other })).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });

  describe('scenarios', () => {
    describe('authorizer migration', () => {
      let setAuthorizerActionId: string;

      sharedBeforeEach('remove root global granter/revoker permissions', async () => {
        // We start from a worst case scenario of a root which has lost all of it's permissions.
        // We must then show how the root can recover and still perform the desired action.
        await authorizer.removeGranter(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE, { from: root });
        await authorizer.removeRevoker(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE, { from: root });

        setAuthorizerActionId = await actionId(vault, 'setAuthorizer');
      });

      context('when there is no delay associated with setting the authorizer', () => {
        it('root can nominate an address to change the authorizer address set on the Vault', async () => {
          // Give root powers to grant permissions again
          await authorizer.addGranter(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE, { from: root });

          await authorizer.grantPermissions([setAuthorizerActionId], grantee, [vault.address], { from: root });

          const newAuthorizer = NOT_WHERE;
          await vault.connect(grantee).setAuthorizer(newAuthorizer);

          expect(await vault.getAuthorizer()).to.be.eq(newAuthorizer);
        });
      });

      context('when there is a delay associated with setting the authorizer', () => {
        const delay = DAY;

        sharedBeforeEach('set delay on setting the new authorizer', async () => {
          await authorizer.setDelay(setAuthorizerActionId, delay, { from: root });
        });

        it('root can nominate an address to change the authorizer address set on the Vault', async () => {
          // Give root powers to grant permissions again
          await authorizer.addGranter(GENERAL_PERMISSION_SPECIFIER, root, EVERYWHERE, { from: root });

          await authorizer.grantPermissions([setAuthorizerActionId], grantee, [vault.address], { from: root });

          const newAuthorizer = NOT_WHERE;
          const executionId = await authorizer.schedule(
            vault,
            vault.interface.encodeFunctionData('setAuthorizer', [newAuthorizer]),
            [other],
            { from: grantee }
          );
          await advanceTime(delay);
          await authorizer.execute(executionId, { from: other });
          expect(await vault.getAuthorizer()).to.be.eq(newAuthorizer);
        });
      });
    });
  });
});
