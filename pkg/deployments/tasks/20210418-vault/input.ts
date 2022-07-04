import Task, { TaskMode } from '../../src/task';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';

export type VaultDeployment = {
  Authorizer: string;
  weth: string;
  pauseWindowDuration: number;
  bufferPeriodDuration: number;
};

const Authorizer = new Task('20210418-authorizer', TaskMode.READ_ONLY);

export default {
  kovan: {
    Authorizer,
    weth: '0xdFCeA9088c8A88A76FF74892C1457C17dfeef9C1',
    pauseWindowDuration: 3 * MONTH,
    bufferPeriodDuration: MONTH,
  },
  mainnet: {
    Authorizer,
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    pauseWindowDuration: 3 * MONTH,
    bufferPeriodDuration: MONTH,
  },
  polygon: {
    Authorizer,
    weth: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', // WMATIC
    pauseWindowDuration: 3 * MONTH,
    bufferPeriodDuration: MONTH,
  },
  arbitrum: {
    Authorizer,
    weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    pauseWindowDuration: 3 * MONTH,
    bufferPeriodDuration: MONTH,
  },
  optimism: {
    Authorizer,
    weth: '0x4200000000000000000000000000000000000006',
    pauseWindowDuration: 3 * MONTH,
    bufferPeriodDuration: MONTH,
  },
  goerli: {
    Authorizer,
    weth: '0xdFCeA9088c8A88A76FF74892C1457C17dfeef9C1',
    pauseWindowDuration: 3 * MONTH,
    bufferPeriodDuration: MONTH,
  },
};
