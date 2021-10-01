import hre from 'hardhat';
import { expect } from 'chai';

import Task from '../../../src/task';

describe('LidoRelayer', function () {
  const task = Task.fromHRE('20210812-lido-relayer', hre);

  it('references the vault correctly', async () => {
    const input = task.input();
    const output = task.output();

    const relayer = await task.instanceAt('LidoRelayer', output.LidoRelayer);

    expect(await relayer.getVault()).to.be.equal(input.Vault);
  });
});
