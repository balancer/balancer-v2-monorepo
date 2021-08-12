import hre from 'hardhat';
import { expect } from 'chai';

import Task from '../../../src/task';
import { WstETHRateProviderDeployment } from '../input';

describe('WstETHRateProvider', function () {
  const task = Task.fromHRE('20210812-wsteth-rate-provider', hre);

  it('returns the same value as wstETH.stEthPerToken()', async () => {
    const input = task.input() as WstETHRateProviderDeployment;
    const output = task.output();

    const wstETH = await hre.ethers.getContractAt(
      ['function stEthPerToken() external view returns (uint256)'],
      input.wstETH
    );
    const expectedRate = await wstETH.stEthPerToken();

    const rateProvider = await task.instanceAt('WstETHRateProvider', output.WstETHRateProvider);
    const actualRate = await rateProvider.getRate();

    expect(actualRate).to.be.eq(expectedRate);
  });
});
