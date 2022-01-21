import hre from 'hardhat';
import { expect } from 'chai';

import Task from '../../../src/task';

describe('LiquidityBootstrappingPoolFactory', function () {
  const task = Task.fromHRE('20210721-liquidity-bootstrapping-pool', hre);

  it('references the vault correctly', async () => {
    const input = task.input();

    const factory = await task.deployedInstance('LiquidityBootstrappingPoolFactory');

    expect(await factory.getVault()).to.be.equal(input.Vault);
  });
});
