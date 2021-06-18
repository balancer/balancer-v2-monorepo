import Task from '../../src/task';

export type VaultDeployment = {
  authorizer: string;
  weth: string;
  pauseWindowDuration: number;
  bufferPeriodDuration: number;
};

const authorizer = new Task('20210418-authorizer');

export default {
  authorizer,
  weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  pauseWindowDuration: 7776000,
  bufferPeriodDuration: 2592000,
};
