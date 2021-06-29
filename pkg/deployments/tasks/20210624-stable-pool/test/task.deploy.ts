import hre from 'hardhat';
import { expect } from 'chai';

import Task from '../../../src/task';

describe('StablePool', function () {
  const task = Task.fromHRE('20210624-stable-pool', hre);

  it('has a vault reference', async () => {
    const output = task.output();
    const factory = await task.instanceAt('StablePoolFactory', output.factory);

    expect(await factory.getVault()).to.be.equal('0xBA12222222228d8Ba445958a75a0704d566BF2C8');
  });
});
