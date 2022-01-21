import hre from 'hardhat';
import { expect } from 'chai';

import Task from '../../../src/task';

describe('StablePoolFactory', function () {
  const task = Task.fromHRE('20210624-stable-pool', hre);

  it('has a vault reference', async () => {
    const input = task.input();

    const factory = await task.deployedInstance('StablePoolFactory');

    expect(await factory.getVault()).to.be.equal(input.Vault);
  });
});
