import Task, { TaskMode } from '../../src/task';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';

export type VaultDeployment = {
  Authorizer: string;
  weth: string;
  pauseWindowDuration: number;
  bufferPeriodDuration: number;
};

const Authorizer = new Task('20210418-authorizer', TaskMode.READ_ONLY);
const Tokens = new Task('00000000-tokens', TaskMode.READ_ONLY);

export default {
  Authorizer,
  pauseWindowDuration: 3 * MONTH,
  bufferPeriodDuration: MONTH,

  mainnet: {
    weth: Tokens.output({ network: 'mainnet' }).WETH,
  },
  polygon: {
    weth: Tokens.output({ network: 'polygon' }).WETH, // WMATIC
  },
  arbitrum: {
    weth: Tokens.output({ network: 'arbitrum' }).WETH,
  },
  optimism: {
    weth: Tokens.output({ network: 'optimism' }).WETH,
  },
  gnosis: {
    weth: Tokens.output({ network: 'gnosis' }).WETH, // wxDAI
  },
  bsc: {
    weth: Tokens.output({ network: 'bsc' }).WETH, // WBNB
  },
  goerli: {
    weth: Tokens.output({ network: 'goerli' }).WETH,
  },
};
