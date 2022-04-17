import hre from 'hardhat';
import { expect } from 'chai';

import Task from '../../../src/task';

describe('StablePoolFactory', function () {
  const task = Task.fromHRE('20220415-primary-issue-pool', hre);

  it('has a vault reference', async () => {
    const input = task.input();

    const factory = await task.deployedInstance('PrimaryIssuePoolFactory');

    expect(await factory.getVault()).to.be.equal(input.Vault);
  });
});
