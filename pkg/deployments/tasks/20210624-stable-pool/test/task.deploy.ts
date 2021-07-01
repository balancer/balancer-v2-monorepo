import hre from 'hardhat';
import { expect } from 'chai';

import Task from '../../../src/task';

describe('StablePoolFactory', function () {
  const task = Task.fromHRE('20210624-stable-pool', hre);

  it('has a vault reference', async () => {
    const input = task.input();
    const output = task.output();

    const factory = await task.instanceAt('StablePoolFactory', output.factory);

    expect(await factory.getVault()).to.be.equal(input.vault);
  });
});
