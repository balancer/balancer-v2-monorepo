import hre from 'hardhat';
import { expect } from 'chai';

import Task from '../../../src/task';

describe('MetaStablePoolFactory', function () {
  const task = Task.fromHRE('20210727-meta-stable-pool', hre);

  it('has a vault reference', async () => {
    const input = task.input();

    const factory = await task.deployedInstance('MetaStablePoolFactory');

    expect(await factory.getVault()).to.be.equal(input.Vault);
  });
});
