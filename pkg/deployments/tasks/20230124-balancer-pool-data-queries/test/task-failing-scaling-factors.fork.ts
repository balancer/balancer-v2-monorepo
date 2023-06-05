import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { describeForkTest } from '../../../src/forkTests';
import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';

const BBAUSDC = '0x82698aecc9e28e9bb27608bd52cf57f704bd1b83';
const BBAUSDC_POOL_ID = '0x82698aecc9e28e9bb27608bd52cf57f704bd1b83000000000000000000000336';
const POOL_WITH_FAILING_SCALING_FACTORS_ID = '0x3c640f0d3036ad85afa2d5a9e32be651657b874f00000000000000000000046b';
const POOL_WITH_FAILING_SCALING_FACTORS = '0x3c640f0d3036ad85afa2d5a9e32be651657b874f';


const defaultPoolDataQueryConfig = {
    loadTokenBalanceUpdatesAfterBlock: false,
    loadTotalSupply: false,
    loadSwapFees: false,
    loadLinearWrappedTokenRates: false,
    loadNormalizedWeights: false,
    loadScalingFactors: false,
    loadAmps: false,
    loadRates: false,
  
    blockNumber: 0,
    totalSupplyTypes: [],
    swapFeeTypes: [],
    linearPoolIdxs: [],
    weightedPoolIdxs: [],
    scalingFactorPoolIdxs: [],
    ampPoolIdxs: [],
    ratePoolIdxs: [],
  };

describeForkTest('BalancerPoolDataQueries', 'mainnet', 17238447, function () {
  let balancerPoolDataQueries: Contract;

  before('deploy balancer pool data queries', async () => {
    const task = new Task('20230124-balancer-pool-data-queries', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });

    balancerPoolDataQueries = await task.deployedInstance('BalancerPoolDataQueries');
  });

  context('handles failing scaling factors', () => {
    it('Should return an empty array for a pool with failing scaling factors', async () => {
      const response = await balancerPoolDataQueries.getScalingFactorsForPools([BBAUSDC, POOL_WITH_FAILING_SCALING_FACTORS]);

      expect(response.length).to.equal(2);
      expect(response[0].length).to.equal(3);
      expect(response[1].length).to.equal(0);
    });

    it('Should add the pool to ignoreIdxs when it has failing scaling factors', async () => {
      const response = await balancerPoolDataQueries.getPoolData([BBAUSDC_POOL_ID, POOL_WITH_FAILING_SCALING_FACTORS_ID], {
        ...defaultPoolDataQueryConfig,
        loadScalingFactors: true,
        scalingFactorPoolIdxs: [0, 1],
      });

      expect(response.ignoreIdxs[0]).to.equal(1);
    });
  });
});
