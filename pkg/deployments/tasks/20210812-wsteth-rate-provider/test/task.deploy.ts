import hre from 'hardhat';
import { expect } from 'chai';

import Task from '../../../src/task';

describe('WstETHRateProvider', function () {
  const task = Task.fromHRE('20210812-wsteth-rate-provider', hre);

  it('references the vault correctly', async () => {
    const input = task.input();
    const output = task.output();

    const relayer = await task.instanceAt('WstETHRateProvider', output.relayer);

    expect(await relayer.wstETH()).to.be.equal(input.wsteth);
  });
});
