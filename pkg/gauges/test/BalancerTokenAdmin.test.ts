import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { expect } from 'chai';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

describe('BalancerTokenAdmin', () => {
  let vault: Vault;
  let authorizer: Contract;
  let token: Contract;
  let tokenAdmin: Contract;
  let admin: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy authorizer', async () => {
    vault = await Vault.create({ admin });
    if (!vault.authorizer) throw Error('Vault has no Authorizer');
    authorizer = vault.authorizer;
    token = await deploy('TestBalancerToken', { args: [admin.address, 'Balancer', 'BAL'] });
    tokenAdmin = await deploy('BalancerTokenAdmin', { args: [vault.address, token.address] });
  });

  describe('constructor', () => {
    it('sets the vault address', async () => {
      expect(await tokenAdmin.getVault()).to.be.eq(vault.address);
    });

    it('uses the authorizer of the vault', async () => {
      expect(await tokenAdmin.getAuthorizer()).to.equal(authorizer.address);
    });

    it('tracks authorizer changes in the vault', async () => {
      const action = await actionId(vault.instance, 'setAuthorizer');
      await authorizer.connect(admin).grantRoleGlobally(action, admin.address);

      await vault.instance.connect(admin).setAuthorizer(other.address);

      expect(await tokenAdmin.getAuthorizer()).to.equal(other.address);
    });

    it('sets the startEpochTime to the sentinel value', async () => {
      expect(await tokenAdmin.startEpochTime()).to.be.eq(MAX_UINT256);
    });
  });

  describe('activate', () => {
    context('when the caller is authorised to call this function', () => {
      sharedBeforeEach('authorize caller', async () => {
        const action = await actionId(tokenAdmin, 'activate');
        await authorizer.connect(admin).grantRoleGlobally(action, admin.address);
      });

      context('when BalancerTokenAdmin has been activated already', () => {
        sharedBeforeEach('activate', async () => {
          await token.connect(admin).grantRole(await token.DEFAULT_ADMIN_ROLE(), tokenAdmin.address);
          await tokenAdmin.connect(admin).activate();
        });

        it('reverts', async () => {
          await expect(tokenAdmin.connect(admin).activate()).to.be.revertedWith('Already activated');
        });
      });

      context('when BalancerTokenAdmin has not been activated yet', () => {
        context("when the BalancerTokenAdmin doesn't have admin powers over the BAL token", () => {
          it('reverts', async () => {
            await expect(tokenAdmin.connect(admin).activate()).to.be.revertedWith('BalancerTokenAdmin is not an admin');
          });
        });

        context('when the BalancerTokenAdmin has admin powers over the BAL token', () => {
          sharedBeforeEach('activate', async () => {
            await token.connect(admin).grantRole(await token.DEFAULT_ADMIN_ROLE(), tokenAdmin.address);
          });

          it('it revokes MINTER_ROLE from all addresses other than itself', async () => {
            expect(await token.getRoleMemberCount(await token.MINTER_ROLE())).to.be.gt(0);

            await tokenAdmin.connect(admin).activate();

            expect(await token.getRoleMemberCount(await token.MINTER_ROLE())).to.be.eq(1);
            expect(await token.hasRole(await token.MINTER_ROLE(), tokenAdmin.address)).to.be.true;
          });

          it('it revokes SNAPSHOT_ROLE from all addresses other than itself', async () => {
            expect(await token.getRoleMemberCount(await token.SNAPSHOT_ROLE())).to.be.gt(0);

            await tokenAdmin.connect(admin).activate();

            expect(await token.getRoleMemberCount(await token.SNAPSHOT_ROLE())).to.be.eq(1);
            expect(await token.hasRole(await token.SNAPSHOT_ROLE(), tokenAdmin.address)).to.be.true;
          });

          it('it revokes GLOBAL_ADMIN_ROLE from all addresses', async () => {
            expect(await token.getRoleMemberCount(await token.DEFAULT_ADMIN_ROLE())).to.be.gt(0);

            await tokenAdmin.connect(admin).activate();

            expect(await token.getRoleMemberCount(await token.DEFAULT_ADMIN_ROLE())).to.be.eq(0);
          });

          it('it sets the initial inflation parameters', async () => {
            const tx = await tokenAdmin.connect(admin).activate();
            const receipt = await tx.wait();
            const { timestamp } = await ethers.provider.getBlock(receipt.blockHash);

            expect(await tokenAdmin.startEpochTime()).to.be.eq(timestamp);
            expect(await tokenAdmin.startEpochSupply()).to.be.eq(await token.totalSupply());
            expect(await tokenAdmin.rate()).to.be.eq('32165468432186542');
          });

          it('it emits an UpdateMiningParameters event', async () => {
            const tx = await tokenAdmin.connect(admin).activate();
            const receipt = await tx.wait();
            const { timestamp } = await ethers.provider.getBlock(receipt.blockHash);

            expectEvent.inReceipt(await tx.wait(), 'UpdateMiningParameters', {
              time: timestamp,
              rate: '32165468432186542',
              supply: await token.totalSupply(),
            });
          });
        });
      });
    });
  });
});
