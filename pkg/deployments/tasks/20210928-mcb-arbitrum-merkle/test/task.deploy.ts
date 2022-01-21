import hre from 'hardhat';
import { expect } from 'chai';

import Task from '../../../src/task';

describe('MerkleRedeem', function () {
  const task = Task.fromHRE('20210928-mcb-arbitrum-merkle', hre);

  it('references the vault correctly', async () => {
    const input = task.input();

    const distributor = await task.deployedInstance('MerkleRedeem');

    expect(await distributor.vault()).to.be.equal(input.Vault);
  });

  it('references the MCB token correctly', async () => {
    const input = task.input();

    const distributor = await task.deployedInstance('MerkleRedeem');

    expect(await distributor.rewardToken()).to.be.equal(input.rewardToken);
  });
});
