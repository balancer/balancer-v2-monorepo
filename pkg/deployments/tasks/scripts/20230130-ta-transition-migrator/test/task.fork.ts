import hre from 'hardhat';
import { expect } from 'chai';
import { Contract, ContractReceipt } from 'ethers';

import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import { describeForkTest } from '../../../../src/forkTests';
import Task, { TaskMode } from '../../../../src/task';
import { impersonate } from '../../../../src/signers';
import { getForkedNetwork } from '../../../../src/test';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { TRANSITION_END_BLOCK, TimelockAuthorizerTransitionMigratorDeployment } from '../input';
import { RoleData } from '../input/types';
import { DAY, advanceTime } from '@balancer-labs/v2-helpers/src/time';

describeForkTest('TimelockAuthorizerTransitionMigrator', 'mainnet', TRANSITION_END_BLOCK, function () {
  let input: TimelockAuthorizerTransitionMigratorDeployment;
  let migrator: Contract, newAuthorizer: Contract;
  let root: SignerWithAddress;

  let task: Task;
  let roles: RoleData[], delayedRoles: RoleData[];
  let migrationReceipt: ContractReceipt;

  before('run task', async () => {
    task = new Task('20230130-ta-transition-migrator', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    migrator = await task.deployedInstance('TimelockAuthorizerTransitionMigrator');

    input = task.input() as TimelockAuthorizerTransitionMigratorDeployment;
    roles = input.Roles;
    delayedRoles = input.DelayedRoles;
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

  sharedBeforeEach(async () => {
    migrationReceipt = await (await migrator.migratePermissions()).wait();
  });

  it('migrates all non-delayed roles properly', async () => {
    for (const roleData of roles) {
      expect(await newAuthorizer.hasPermission(roleData.role, roleData.grantee, roleData.target)).to.be.true;
    }
  });

  it('schedules delayed roles', async () => {
    for (let i = 0; i < delayedRoles.length; ++i) {
      const roleData = delayedRoles[i];
      expect(await newAuthorizer.hasPermission(roleData.role, roleData.grantee, roleData.target)).to.be.false;

      const grantActionId = await newAuthorizer.getGrantPermissionActionId(roleData.role);
      expectEvent.inIndirectReceipt(
        migrationReceipt,
        newAuthorizer.interface,
        'ExecutionScheduled',
        {
          actionId: grantActionId,
          scheduledExecutionId: await migrator.scheduledExecutionIds(i),
        },
        newAuthorizer.address
      );
    }
  });

  // The only expected delayed role (see mainnet.ts) is the following (14 days):
  // GaugeController.actionId('GaugeController', 'add_gauge(address,int128)')
  it('skips executions while delay is not due', async () => {
    await advanceTime(7 * DAY);
    const tx = await migrator.executeDelays();

    expectEvent.notEmitted(await tx.wait(), 'ExecutionExecuted');

    for (const roleData of delayedRoles) {
      expect(await newAuthorizer.hasPermission(roleData.role, roleData.grantee, roleData.target)).to.be.false;
    }
  });

  it('executes delayed permissions after their delay passes', async () => {
    await advanceTime(14 * DAY); // 14 days since `migratePermissions` is called.
    const receipt = await (await migrator.executeDelays()).wait();

    for (let i = 0; i < delayedRoles.length; ++i) {
      const roleData = delayedRoles[i];
      expect(await newAuthorizer.hasPermission(roleData.role, roleData.grantee, roleData.target)).to.be.true;

      expectEvent.inIndirectReceipt(receipt, newAuthorizer.interface, 'ExecutionExecuted', {
        scheduledExecutionId: await migrator.scheduledExecutionIds(i),
      });
    }
  });

  it('does nothing when executing delays the second time', async () => {
    await advanceTime(14 * DAY); // 14 days since `migratePermissions` is called.
    await migrator.executeDelays();
    const receipt = await (await migrator.executeDelays()).wait();

    for (let i = 0; i < delayedRoles.length; ++i) {
      const roleData = delayedRoles[i];
      expect(await newAuthorizer.hasPermission(roleData.role, roleData.grantee, roleData.target)).to.be.true;
    }

    expectEvent.notEmitted(receipt, 'ExecutionExecuted');
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
