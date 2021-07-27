import hre from 'hardhat';
import { expect } from 'chai';

import Task from '../../../src/task';

describe('MetaStablePoolFactory', function () {
  const task = Task.fromHRE('20210727-meta-stable-pool', hre);

  it('has a vault reference', async () => {
    const input = task.input();
    const output = task.output();

    const factory = await task.instanceAt('MetaStablePoolFactory', output.factory);

    expect(await factory.getVault()).to.be.equal(input.vault);
  });
});
