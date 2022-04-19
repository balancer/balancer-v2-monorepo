import hre from 'hardhat';
import { expect } from 'chai';

import Task from '../../../src/task';

describe('SecondaryIssuePoolFactory', function () {
  const task = Task.fromHRE('20220419-secondary-issue-pool', hre);

  it('has a vault reference', async () => {
    const input = task.input();

    const factory = await task.deployedInstance('SecondaryIssuePoolFactory');

    expect(await factory.getVault()).to.be.equal(input.Vault);
  });
});
