import hre from 'hardhat';
import { expect } from 'chai';

import Task from '../../../src/task';

describe('WstETHRateProvider', function () {
  const task = Task.fromHRE('20210812-wsteth-rate-provider', hre);

  it("doesn't revert on querying the rate", async () => {
    const output = task.output();

    const rateProvider = await task.instanceAt('WstETHRateProvider', output.WstETHRateProvider);

    await expect(rateProvider.getRate()).to.be.not.reverted;
  });
});
