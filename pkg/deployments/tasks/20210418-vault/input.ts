import Task from '../../src/task';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';

export type VaultDeployment = {
  authorizer: string;
  weth: string;
  pauseWindowDuration: number;
  bufferPeriodDuration: number;
};

const authorizer = new Task('20210418-authorizer');

export default {
  goerli: {
    authorizer,
    weth: '0xdFCeA9088c8A88A76FF74892C1457C17dfeef9C1',
    pauseWindowDuration: 3 * MONTH,
    bufferPeriodDuration: MONTH,
  },
  kovan: {
    authorizer,
    weth: '0xdFCeA9088c8A88A76FF74892C1457C17dfeef9C1',
    pauseWindowDuration: 3 * MONTH,
    bufferPeriodDuration: MONTH,
  },
  mainnet: {
    authorizer,
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    pauseWindowDuration: 3 * MONTH,
    bufferPeriodDuration: MONTH,
  },
  rinkeby: {
    authorizer,
    weth: '0xdFCeA9088c8A88A76FF74892C1457C17dfeef9C1',
    pauseWindowDuration: 3 * MONTH,
    bufferPeriodDuration: MONTH,
  },
  ropsten: {
    authorizer,
    weth: '0xdFCeA9088c8A88A76FF74892C1457C17dfeef9C1',
    pauseWindowDuration: 3 * MONTH,
    bufferPeriodDuration: MONTH,
  },
};
