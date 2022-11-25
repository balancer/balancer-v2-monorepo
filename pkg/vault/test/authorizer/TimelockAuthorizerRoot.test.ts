import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TimelockAuthorizer from '@balancer-labs/v2-helpers/src/models/authorizer/TimelockAuthorizer';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('TimelockAuthorizer', () => {
  let authorizer: TimelockAuthorizer, vault: Contract;
  let root: SignerWithAddress, grantee: SignerWithAddress;

  before('setup signers', async () => {
    [, root, grantee] = await ethers.getSigners();
  });

  const WHERE_1 = ethers.Wallet.createRandom().address;
  const WHERE_2 = ethers.Wallet.createRandom().address;

  const GENERAL_PERMISSION_SPECIFIER = TimelockAuthorizer.GENERAL_PERMISSION_SPECIFIER;
  const EVERYWHERE = TimelockAuthorizer.EVERYWHERE;

  describe('root', () => {
    let GRANT_ACTION_ID: string, REVOKE_ACTION_ID: string;

    sharedBeforeEach('deploy authorizer', async () => {
      const oldAuthorizer = await TimelockAuthorizer.create({ root });

      vault = await deploy('Vault', { args: [oldAuthorizer.address, ZERO_ADDRESS, 0, 0] });
      authorizer = await TimelockAuthorizer.create({ root, vault });

      const setAuthorizerAction = await actionId(vault, 'setAuthorizer');
      await oldAuthorizer.grantPermissions(setAuthorizerAction, root, vault, { from: root });
      await vault.connect(root).setAuthorizer(authorizer.address);
    });

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
      expect(await authorizer.getPermissionId(GRANT_ACTION_ID, root, EVERYWHERE)).to.be.equal(expectedGrantId);

      const expectedRevokeId = ethers.utils.solidityKeccak256(
        ['bytes32', 'address', 'address'],
        [REVOKE_ACTION_ID, root.address, EVERYWHERE]
      );
      expect(await authorizer.getPermissionId(REVOKE_ACTION_ID, root, EVERYWHERE)).to.be.equal(expectedRevokeId);
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
});
