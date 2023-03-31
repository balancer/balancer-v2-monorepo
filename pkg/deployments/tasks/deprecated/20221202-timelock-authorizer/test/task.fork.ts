import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { advanceTime, DAY, WEEK } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

import { describeForkTest } from '../../../src/forkTests';
import Task, { TaskMode } from '../../../src/task';
import { impersonate } from '../../../src/signers';
import { getForkedNetwork } from '../../../src/test';
import { AuthorizerDeployment } from '../../20210418-authorizer/input';
import { TimelockAuthorizerDeployment } from '../input';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describeForkTest('TimelockAuthorizer', 'mainnet', 16076200, function () {
  let input: TimelockAuthorizerDeployment;
  let migrator: Contract, vault: Contract, newAuthorizer: Contract, oldAuthorizer: Contract;
  let root: SignerWithAddress;

  let task: Task;

  before('run task', async () => {
    task = new Task('20221202-timelock-authorizer', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    input = task.input() as TimelockAuthorizerDeployment;
    migrator = await task.deployedInstance('TimelockAuthorizerMigrator');
    newAuthorizer = await task.deployedInstance('TimelockAuthorizer');

    root = await impersonate(input.Root, fp(100));
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

  it('migrates all roles properly', async () => {
    for (const roleData of input.Roles) {
      expect(await newAuthorizer.hasPermission(roleData.role, roleData.grantee, roleData.target)).to.be.true;
    }
  });

  it('sets up granters properly', async () => {
    for (const granterData of input.Granters) {
      expect(await newAuthorizer.isGranter(granterData.role, granterData.grantee, granterData.target)).to.be.true;
    }
  });

  it('sets up revokers properly', async () => {
    for (const revokerData of input.Revokers) {
      expect(await newAuthorizer.isRevoker(revokerData.role, revokerData.grantee, revokerData.target)).to.be.true;
    }
  });

  it('sets up delays properly', async () => {
    await advanceTime(5 * DAY);
    await migrator.executeDelays();

    for (const delayData of input.ExecuteDelays) {
      expect(await newAuthorizer.getActionIdDelay(delayData.actionId)).to.be.eq(delayData.newDelay);
    }

    for (const delayData of input.GrantDelays) {
      const grantActionId = await newAuthorizer.getGrantPermissionActionId(delayData.actionId);
      expect(await newAuthorizer.getActionIdDelay(grantActionId)).to.be.eq(delayData.newDelay);
    }
  });

  it('starts the root transfer', async () => {
    await advanceTime(4 * WEEK);
    await migrator.startRootTransfer();
  });

  it('does not set the new authorizer immediately', async () => {
    expect(await newAuthorizer.isRoot(migrator.address)).to.be.true;
    expect(await vault.getAuthorizer()).to.be.equal(oldAuthorizer.address);
  });

  it('finalizes the migration once new root address claims root status', async () => {
    await expect(migrator.finalizeMigration()).to.be.revertedWith('ROOT_NOT_CLAIMED_YET');

    await newAuthorizer.connect(root).claimRoot();

    await migrator.finalizeMigration();
    expect(await vault.getAuthorizer()).to.be.equal(newAuthorizer.address);
    expect(await newAuthorizer.isRoot(root.address)).to.be.true;
    expect(await newAuthorizer.isRoot(migrator.address)).to.be.false;
  });

  it('allows minting after the migration', async () => {
    const balancerMinterTask = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, getForkedNetwork(hre));
    const balancerMinter = await balancerMinterTask.deployedInstance('BalancerMinter');

    const balancerTokenAdminTask = new Task('20220325-balancer-token-admin', TaskMode.READ_ONLY, getForkedNetwork(hre));
    const balancerTokenAdmin = await balancerTokenAdminTask.deployedInstance('BalancerTokenAdmin');

    const tokensTask = new Task('00000000-tokens', TaskMode.READ_ONLY, getForkedNetwork(hre));
    const balAddress = tokensTask.output().BAL;
    const balancerToken = await balancerTokenAdminTask.instanceAt('IERC20', balAddress);

    const balancerMinterSigner = await impersonate(balancerMinter.address, fp(100));

    const tx = await balancerTokenAdmin.connect(balancerMinterSigner).mint(balancerMinter.address, 100);

    expectEvent.inIndirectReceipt(await tx.wait(), balancerToken.interface, 'Transfer', {
      from: ZERO_ADDRESS,
      to: balancerMinter.address,
      value: 100,
    });
  });

  it('allows migrating the authorizer address again', async () => {
    const setAuthorizerActionId = await actionId(vault, 'setAuthorizer');

    expect(await vault.getAuthorizer()).to.be.eq(newAuthorizer.address);

    await newAuthorizer.connect(root).grantPermissions([setAuthorizerActionId], root.address, [vault.address]);

    // Schedule authorizer change
    const nextAuthorizer = '0xaF52695E1bB01A16D33D7194C28C42b10e0Dbec2';
    const tx = await newAuthorizer
      .connect(root)
      .schedule(vault.address, vault.interface.encodeFunctionData('setAuthorizer', [nextAuthorizer]), [root.address]);
    const event = expectEvent.inReceipt(await tx.wait(), 'ExecutionScheduled');

    await advanceTime(30 * DAY);

    // Execute authorizer change
    await newAuthorizer.connect(root).execute(event.args.scheduledExecutionId);

    expect(await vault.getAuthorizer()).to.be.eq(nextAuthorizer);
  });
});
