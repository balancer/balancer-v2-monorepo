import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { advanceTime } from '@balancer-labs/v2-helpers/src/time';
import { ONES_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';

import Task, { TaskMode } from '../../../src/task';
import { impersonate } from '../../../src/signers';
import { getForkedNetwork } from '../../../src/test';
import { AuthorizerDeployment } from '../../20210418-authorizer/input';
import { TimelockAuthorizerDeployment } from '../input';

describe('TimelockAuthorizer', function () {
  let input: TimelockAuthorizerDeployment;
  let EVERYWHERE: string, DEFAULT_ADMIN_ROLE: string;
  let migrator: Contract, vault: Contract, newAuthorizer: Contract, oldAuthorizer: Contract;

  const task = new Task('2022xxxx-timelock-authorizer', TaskMode.TEST, getForkedNetwork(hre));

  before('run task', async () => {
    await task.run({ force: true });
    input = task.input() as TimelockAuthorizerDeployment;
    migrator = await task.deployedInstance('TimelockAuthorizerMigrator');
    newAuthorizer = await task.deployedInstance('TimelockAuthorizer');
  });

  before('load vault', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.instanceAt('Vault', await migrator.vault());
  });

  before('load old authorizer and impersonate multisig', async () => {
    const authorizerTask = new Task('20210418-authorizer', TaskMode.READ_ONLY, getForkedNetwork(hre));
    oldAuthorizer = await authorizerTask.instanceAt('Authorizer', await migrator.oldAuthorizer());

    const authorizerInput = authorizerTask.input() as AuthorizerDeployment;
    const multisig = await impersonate(authorizerInput.admin, fp(100));
    const setAuthorizerActionId = await actionId(vault, 'setAuthorizer');
    await oldAuthorizer.connect(multisig).grantRolesToMany([setAuthorizerActionId], [migrator.address]);
  });

  before('setup constants', async () => {
    EVERYWHERE = await newAuthorizer.EVERYWHERE();
    DEFAULT_ADMIN_ROLE = await oldAuthorizer.DEFAULT_ADMIN_ROLE();
  });

  before('migrate', async () => {
    await migrator.migrate(0);
  });

  it('runs the migration properly', async () => {
    expect(await migrator.migratedRoles()).to.be.equal(input.rolesData.length);
    expect(await migrator.isComplete()).to.be.true;
  });

  it('migrates all roles properly', async () => {
    for (const roleData of input.rolesData) {
      const membersCount = await oldAuthorizer.getRoleMemberCount(roleData.role);
      for (let i = 0; i < membersCount; i++) {
        const member = await oldAuthorizer.getRoleMember(roleData.role, i);
        expect(await newAuthorizer.hasPermission(roleData.role, member, roleData.target)).to.be.true;
      }
    }
  });

  it('migrates all admin roles properly', async () => {
    for (const roleData of input.rolesData) {
      const adminRole = await oldAuthorizer.getRoleAdmin(roleData.role);
      const adminsCount = await oldAuthorizer.getRoleMemberCount(adminRole);
      for (let i = 0; i < adminsCount; i++) {
        const admin = await oldAuthorizer.getRoleMember(adminRole, i);
        expect(await newAuthorizer.isGranter(ONES_BYTES32, admin, roleData.target)).to.be.true;
        expect(await newAuthorizer.isRevoker(ONES_BYTES32, admin, roleData.target)).to.be.true;
      }
    }
  });

  it('migrates all the default admins properly', async () => {
    const adminsCount = await oldAuthorizer.getRoleMemberCount(DEFAULT_ADMIN_ROLE);
    for (let i = 0; i < adminsCount; i++) {
      const admin = await oldAuthorizer.getRoleMember(DEFAULT_ADMIN_ROLE, i);
      expect(await newAuthorizer.isGranter(ONES_BYTES32, admin, EVERYWHERE)).to.be.true;
      expect(await newAuthorizer.isRevoker(ONES_BYTES32, admin, EVERYWHERE)).to.be.true;
    }
  });

  it('does not set the new authorizer immediately', async () => {
    expect(await newAuthorizer.isRoot(migrator.address)).to.be.true;
    expect(await vault.getAuthorizer()).to.be.equal(oldAuthorizer.address);
  });

  it('revokes the admin roles from the migrator', async () => {
    const EVERYWHERE = await newAuthorizer.EVERYWHERE();

    expect(await newAuthorizer.isGranter(ONES_BYTES32, migrator.address, EVERYWHERE)).to.be.false;
    expect(await newAuthorizer.isRevoker(ONES_BYTES32, migrator.address, EVERYWHERE)).to.be.false;
  });

  it('finalizes the migration after the set root delay', async () => {
    await expect(migrator.finalizeMigration()).to.be.revertedWith('CANNOT_TRIGGER_ROOT_CHANGE_YET');

    const CHANGE_ROOT_DELAY = await newAuthorizer.getRootTransferDelay();
    await advanceTime(CHANGE_ROOT_DELAY);

    await migrator.finalizeMigration();
    expect(await vault.getAuthorizer()).to.be.equal(newAuthorizer.address);
    expect(await newAuthorizer.isRoot(input.root)).to.be.true;
    expect(await newAuthorizer.isRoot(migrator.address)).to.be.false;
  });
});
