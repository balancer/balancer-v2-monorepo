import hre from 'hardhat';
import { expect } from 'chai';

import Task from '../../../src/task';

describe('MerkleOrchard', function () {
  const task = Task.fromHRE('20211012-merkle-orchard', hre);

  it('references the vault correctly', async () => {
    const input = task.input();
    const output = task.output();

    const relayer = await task.instanceAt('MerkleOrchard', output.MerkleOrchard);

    expect(await relayer.getVault()).to.be.equal(input.Vault);
  });
});
