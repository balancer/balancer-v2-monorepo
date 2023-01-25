import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';

import { describeForkTest } from '../../../src/forkTests';
import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';

const BAL_ETH_POOL_ID = '0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014';
const BAL_ETH_POOL = '0x5c6ee304399dbdb9c8ef030ab642b10820db8f56';
const WSTETH_ETH_POOL_ID = '0x32296969ef14eb0c6d29669c550d4a0449130230000200000000000000000080';
const BAL_ETH_POOL_LAST_CHANGED_BLOCK = 16473966;
const OHM_ETH_POOL = '0xd1ec5e215e8148d76f4460e4097fd3d5ae0a3558';

const BBAUSDC = '0x82698aecc9e28e9bb27608bd52cf57f704bd1b83';
const BBAUSDC_POOL_ID = '0x82698aecc9e28e9bb27608bd52cf57f704bd1b83000000000000000000000336';
const BBAUSDT = '0x2f4eb100552ef93840d5adc30560e5513dfffacb';
const BBAUSDT_POOL_ID = '0x2f4eb100552ef93840d5adc30560e5513dfffacb000000000000000000000334';
const LPePyvCurve_MIM_11FEB22 = '0x09b1b33bad0e87454ff05696b1151bfbd208a43f';
const LPePyvCurve_MIM_11FEB22_POOL_ID = '0x09b1b33bad0e87454ff05696b1151bfbd208a43f0002000000000000000000a6';
const LPePyvUSDC_28JAN22 = '0x10a2f8bd81ee2898d7ed18fb8f114034a549fa59';
const PHANTOM_STABLE_POOL = '0x7b50775383d3d6f0215a8f290f2c9e2eebbeceb2';
const COMPOSABLE_STABLE_POOL = '0xa13a9247ea42d743238089903570127dda72fe44';
const COMPOSABLE_STABLE_POOL_ID = '0xa13a9247ea42d743238089903570127dda72fe4400000000000000000000035d';
const PHANTOM_STABLE_POOL_ID = '0x7b50775383d3d6f0215a8f290f2c9e2eebbeceb20000000000000000000000fe';

enum TotalSupplyType {
  TOTAL_SUPPLY = 0,
  VIRTUAL_SUPPLY,
  ACTUAL_SUPPLY,
}

enum SwapFeeType {
  SWAP_FEE_PERCENTAGE = 0,
  PERCENT_FEE,
}

const defaultPoolDataQueryConfig = {
  loadTokenBalanceUpdatesAfterBlock: false,
  loadTotalSupply: false,
  loadSwapFees: false,
  loadLinearWrappedTokenRates: false,
  loadNormalizedWeights: false,
  loadTokenRates: false,

  blockNumber: 0,
  totalSupplyTypes: [],
  swapFeeTypes: [],
  linearPoolIdxs: [],
  weightedPoolIdxs: [],
  tokenRatePoolIdxs: [],
};

describeForkTest('BalancerSorQueries', 'mainnet', 16474000, function () {
  let balancerSorQueries: Contract;

  before('deploy balancer sor queries', async () => {
    const task = new Task('20230124-balancer-sor-queries', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });

    balancerSorQueries = await task.deployedInstance('BalancerSorQueries');
  });

  context('pool token balances', () => {
    it('returns values if balances have been updated after the block provided', async () => {
      const response = await balancerSorQueries.getPoolTokenBalancesWithUpdatesAfterBlock(
        [BAL_ETH_POOL_ID],
        BAL_ETH_POOL_LAST_CHANGED_BLOCK - 1
      );

      expect(response.length).to.equal(1);
      expect(response[0].length).to.equal(2);
    });

    it('returns no values if balances have not been updated after the block provided', async () => {
      const response = await balancerSorQueries.getPoolTokenBalancesWithUpdatesAfterBlock(
        [BAL_ETH_POOL_ID],
        BAL_ETH_POOL_LAST_CHANGED_BLOCK
      );

      expect(response.length).to.equal(1);
      expect(response[0].length).to.equal(0);
    });

    it('returns values only for pools with updates since block provided', async () => {
      const response = await balancerSorQueries.getPoolTokenBalancesWithUpdatesAfterBlock(
        [BAL_ETH_POOL_ID, WSTETH_ETH_POOL_ID],
        BAL_ETH_POOL_LAST_CHANGED_BLOCK
      );

      expect(response.length).to.equal(2);
      expect(response[0].length).to.equal(0);
      expect(response[1].length).to.equal(2);
    });
  });

  context('linear pool rates', () => {
    it('returns the correct wrapped token rates for linear pools', async () => {
      const response = await balancerSorQueries.getWrappedTokenRateForLinearPools([BBAUSDC, BBAUSDT]);

      expect(response[0]).to.equal(fp('1.081498386280161947'));
      expect(response[1]).to.equal(fp('1.102128584906008204'));
    });
  });

  context('swap fee percentages', () => {
    it('returns the correct swap fees for pools', async () => {
      const response = await balancerSorQueries.getSwapFeePercentageForPools(
        [BAL_ETH_POOL, BBAUSDT],
        [SwapFeeType.SWAP_FEE_PERCENTAGE, SwapFeeType.SWAP_FEE_PERCENTAGE]
      );

      expect(response[0]).to.equal(fp('0.01'));
      expect(response[1]).to.equal(fp('0.00001'));
    });

    it('returns the correct swap fees for element pools', async () => {
      const response = await balancerSorQueries.getSwapFeePercentageForPools(
        [LPePyvCurve_MIM_11FEB22, LPePyvUSDC_28JAN22],
        [SwapFeeType.PERCENT_FEE, SwapFeeType.PERCENT_FEE]
      );

      expect(response[0]).to.equal(fp('0.1'));
      expect(response[1]).to.equal(fp('0.1'));
    });

    it('returns the correct swap fees for mixed pools', async () => {
      const response = await balancerSorQueries.getSwapFeePercentageForPools(
        [BAL_ETH_POOL, LPePyvCurve_MIM_11FEB22, BBAUSDT],
        [SwapFeeType.SWAP_FEE_PERCENTAGE, SwapFeeType.PERCENT_FEE, SwapFeeType.SWAP_FEE_PERCENTAGE]
      );

      expect(response[0]).to.equal(fp('0.01'));
      expect(response[1]).to.equal(fp('0.1'));
      expect(response[2]).to.equal(fp('0.00001'));
    });
  });

  context('total supply', () => {
    it('returns the correct total supply for pool', async () => {
      const response = await balancerSorQueries.getTotalSupplyForPools([BAL_ETH_POOL], [TotalSupplyType.TOTAL_SUPPLY]);

      expect(response[0]).to.equal(bn('13786043841624360249590791'));
    });

    it('returns the correct virtual supply for pool', async () => {
      const response = await balancerSorQueries.getTotalSupplyForPools(
        [PHANTOM_STABLE_POOL],
        [TotalSupplyType.VIRTUAL_SUPPLY]
      );

      expect(response[0]).to.equal(bn('3079594133035530969647581'));
    });

    it('returns the correct actual supply for pool', async () => {
      const response = await balancerSorQueries.getTotalSupplyForPools(
        [COMPOSABLE_STABLE_POOL],
        [TotalSupplyType.ACTUAL_SUPPLY]
      );

      expect(response[0]).to.equal(bn('67178285823602489267972373'));
    });

    it('returns the correct supply for mixed pools', async () => {
      const response = await balancerSorQueries.getTotalSupplyForPools(
        [BAL_ETH_POOL, PHANTOM_STABLE_POOL, COMPOSABLE_STABLE_POOL],
        [TotalSupplyType.TOTAL_SUPPLY, TotalSupplyType.VIRTUAL_SUPPLY, TotalSupplyType.ACTUAL_SUPPLY]
      );

      expect(response[0]).to.equal(bn('13786043841624360249590791'));
      expect(response[1]).to.equal(bn('3079594133035530969647581'));
      expect(response[2]).to.equal(bn('67178285823602489267972373'));
    });
  });

  context('normalized weights', () => {
    it('returns the correct weights for 1 pool', async () => {
      const response = await balancerSorQueries.getNormalizedWeightsForPools([BAL_ETH_POOL]);

      expect(response[0][0]).to.equal(fp('0.8'));
      expect(response[0][1]).to.equal(fp('0.2'));
    });

    it('returns the correct weights for several pools', async () => {
      const response = await balancerSorQueries.getNormalizedWeightsForPools([BAL_ETH_POOL, OHM_ETH_POOL]);

      expect(response[0][0]).to.equal(fp('0.8'));
      expect(response[0][1]).to.equal(fp('0.2'));

      expect(response[1][0]).to.equal(fp('0.5'));
      expect(response[1][1]).to.equal(fp('0.5'));
    });
  });

  context('token rates', () => {
    it('returns the correct rates for 1 pool', async () => {
      const response = await balancerSorQueries.getTokenRatesForPools(
        [COMPOSABLE_STABLE_POOL_ID],
        [COMPOSABLE_STABLE_POOL]
      );

      expect(response[0][0]).to.equal(bn('1005671911533217346'));
      expect(response[0][1]).to.equal(bn('1001773828282482904'));
      expect(response[0][2]).to.equal(bn('1000000000000000000'));
      expect(response[0][3]).to.equal(bn('1001905060971436536'));
    });

    it('returns the correct rates for several pools', async () => {
      const response = await balancerSorQueries.getTokenRatesForPools(
        [COMPOSABLE_STABLE_POOL_ID, PHANTOM_STABLE_POOL_ID],
        [COMPOSABLE_STABLE_POOL, PHANTOM_STABLE_POOL]
      );

      expect(response[0][0]).to.equal(bn('1005671911533217346'));
      expect(response[0][1]).to.equal(bn('1001773828282482904'));
      expect(response[0][2]).to.equal(bn('1000000000000000000'));
      expect(response[0][3]).to.equal(bn('1001905060971436536'));

      expect(response[1][0]).to.equal(bn('1017033447123846653'));
      expect(response[1][1]).to.equal(bn('1000000000000000000'));
      expect(response[1][2]).to.equal(bn('1011888479898642476'));
      expect(response[1][3]).to.equal(bn('1010971331127696692'));
    });
  });

  context('get pool data', () => {
    it('loads only token balances', async () => {
      const response = await balancerSorQueries.getPoolData([BAL_ETH_POOL_ID], {
        ...defaultPoolDataQueryConfig,
        loadTokenBalanceUpdatesAfterBlock: true,
      });

      expect(response.balances.length).to.equal(1);
      expect(response.balances[0].length).to.equal(2);
      expect(response.totalSupplies.length).to.equal(0);
      expect(response.linearWrappedTokenRates.length).to.equal(0);
      expect(response.weights.length).to.equal(0);
      expect(response.tokenRates.length).to.equal(0);
      expect(response.swapFees.length).to.equal(0);
    });

    it('loads total supply', async () => {
      const response = await balancerSorQueries.getPoolData([BAL_ETH_POOL_ID, COMPOSABLE_STABLE_POOL_ID], {
        ...defaultPoolDataQueryConfig,
        loadTotalSupply: true,
        totalSupplyTypes: [TotalSupplyType.TOTAL_SUPPLY, TotalSupplyType.ACTUAL_SUPPLY],
      });

      expect(response.totalSupplies[0]).to.equal(bn('13786043841624360249590791'));
      expect(response.totalSupplies[1]).to.equal(bn('67178285823602489267972373'));
    });

    it('loads swap fees', async () => {
      const response = await balancerSorQueries.getPoolData([BAL_ETH_POOL_ID, LPePyvCurve_MIM_11FEB22_POOL_ID], {
        ...defaultPoolDataQueryConfig,
        loadSwapFees: true,
        swapFeeTypes: [SwapFeeType.SWAP_FEE_PERCENTAGE, SwapFeeType.PERCENT_FEE],
      });

      expect(response.swapFees[0]).to.equal(fp('0.01'));
      expect(response.swapFees[1]).to.equal(fp('0.1'));
    });

    it('loads linear wrapped token rates at specified idxs', async () => {
      const response = await balancerSorQueries.getPoolData([BBAUSDT_POOL_ID, BAL_ETH_POOL_ID, BBAUSDC_POOL_ID], {
        ...defaultPoolDataQueryConfig,
        loadLinearWrappedTokenRates: true,
        linearPoolIdxs: [0, 2],
      });

      expect(response.linearWrappedTokenRates[0]).to.equal(fp('1.102128584906008204'));
      expect(response.linearWrappedTokenRates[1]).to.equal(fp('1.081498386280161947'));
    });

    it('loads weights at specified idxs', async () => {
      const response = await balancerSorQueries.getPoolData([BBAUSDT_POOL_ID, BAL_ETH_POOL_ID], {
        ...defaultPoolDataQueryConfig,
        loadNormalizedWeights: true,
        weightedPoolIdxs: [1],
      });

      expect(response.weights[0][0]).to.equal(fp('0.8'));
      expect(response.weights[0][1]).to.equal(fp('0.2'));
    });

    it('loads token rates at specified idxs', async () => {
      const response = await balancerSorQueries.getPoolData(
        [BAL_ETH_POOL_ID, COMPOSABLE_STABLE_POOL_ID, PHANTOM_STABLE_POOL_ID],
        {
          ...defaultPoolDataQueryConfig,
          loadTokenRates: true,
          tokenRatePoolIdxs: [1, 2],
        }
      );

      expect(response.tokenRates[0][0]).to.equal(bn('1005671911533217346'));
      expect(response.tokenRates[0][1]).to.equal(bn('1001773828282482904'));
      expect(response.tokenRates[0][2]).to.equal(bn('1000000000000000000'));
      expect(response.tokenRates[0][3]).to.equal(bn('1001905060971436536'));

      expect(response.tokenRates[1][0]).to.equal(bn('1017033447123846653'));
      expect(response.tokenRates[1][1]).to.equal(bn('1000000000000000000'));
      expect(response.tokenRates[1][2]).to.equal(bn('1011888479898642476'));
      expect(response.tokenRates[1][3]).to.equal(bn('1010971331127696692'));
    });
  });
});
