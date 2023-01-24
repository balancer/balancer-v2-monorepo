import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';

import { describeForkTest } from '../../../../src/forkTests';
import Task, { TaskMode } from '../../../../src/task';
import { impersonate } from '../../../../src/signers';
import { getForkedNetwork } from '../../../../src/test';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { TRANSITION_END_BLOCK, TimelockAuthorizerTransitionMigratorDeployment } from '../input';
import { RoleData } from '../input/types';

describeForkTest('TimelockAuthorizerTransitionMigrator', 'mainnet', TRANSITION_END_BLOCK, function () {
  let input: TimelockAuthorizerTransitionMigratorDeployment;
  let migrator: Contract, newAuthorizer: Contract;
  let root: SignerWithAddress;

  let task: Task;
  let roles: RoleData[];

  before('run task', async () => {
    task = new Task('20230130-ta-transition-migrator', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    migrator = await task.deployedInstance('TimelockAuthorizerTransitionMigrator');

    input = task.input() as TimelockAuthorizerTransitionMigratorDeployment;
    roles = input.Roles;
  });

  before('load old authorizer and impersonate multisig', async () => {
    const TimelockAuthorizerTask = new Task('20221202-timelock-authorizer', TaskMode.READ_ONLY, getForkedNetwork(hre));
    newAuthorizer = await TimelockAuthorizerTask.deployedInstance('TimelockAuthorizer');

    root = await impersonate(await newAuthorizer.getRoot(), fp(100));
  });

  before('check that permissions were not present in the new authorizer', async () => {
    for (const roleData of roles) {
      expect(await newAuthorizer.hasPermission(roleData.role, roleData.grantee, roleData.target)).to.be.false;
    }
  });

  before('make the migrator a granter by governance', async () => {
    await newAuthorizer
      .connect(root)
      .manageGranter(newAuthorizer.GENERAL_PERMISSION_SPECIFIER(), migrator.address, newAuthorizer.EVERYWHERE(), true);

    expect(
      await newAuthorizer.canGrant(
        newAuthorizer.GENERAL_PERMISSION_SPECIFIER(),
        migrator.address,
        newAuthorizer.EVERYWHERE()
      )
    ).to.be.true;
  });

  it('migrates all roles properly', async () => {
    await migrator.migratePermissions();
    for (const roleData of roles) {
      expect(await newAuthorizer.hasPermission(roleData.role, roleData.grantee, roleData.target)).to.be.true;
    }
  });

  it('reverts after migrating the first time', async () => {
    await expect(migrator.migratePermissions()).to.be.revertedWith('ALREADY_MIGRATED');
  });

  it('renounces its granter role after migrating permissions', async () => {
    expect(
      await newAuthorizer.canGrant(
        newAuthorizer.GENERAL_PERMISSION_SPECIFIER(),
        migrator.address,
        newAuthorizer.EVERYWHERE()
      )
    ).to.be.false;
  });
});
