import hre from 'hardhat';
import { expect } from 'chai';

import Task from '../../../src/task';

describe('InvestmentPoolFactory', function () {
  const task = Task.fromHRE('20210907-investment-pool', hre);

  it('references the vault correctly', async () => {
    const input = task.input();

    const factory = await task.deployedInstance('InvestmentPoolFactory');

    expect(await factory.getVault()).to.be.equal(input.Vault);
  });
});
