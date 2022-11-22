import Task, { TaskMode } from '../../src/task';

export type AaveLinearPoolDeployment = {
  Vault: string;
  BalancerQueries: string;
  ProtocolFeePercentagesProvider: string;
  WETH: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const BalancerQueries = new Task('20220721-balancer-queries', TaskMode.READ_ONLY);
const ProtocolFeePercentagesProvider = new Task('20220725-protocol-fee-percentages-provider', TaskMode.READ_ONLY);
const Tokens = new Task('00000000-tokens', TaskMode.READ_ONLY);

export default {
  Vault,
  BalancerQueries,
  ProtocolFeePercentagesProvider,
  mainnet: {
    WETH: Tokens.output({ network: 'mainnet' }).WETH,
  },
  polygon: {
    WETH: Tokens.output({ network: 'polygon' }).WETH, // WMATIC
  },
  arbitrum: {
    WETH: Tokens.output({ network: 'arbitrum' }).WETH,
  },
  optimism: {
    WETH: Tokens.output({ network: 'optimism' }).WETH,
  },
  gnosis: {
    WETH: Tokens.output({ network: 'gnosis' }).WETH, // wxDAI
  },
  bsc: {
    WETH: Tokens.output({ network: 'bsc' }).WETH, // WBNB
  },
  goerli: {
    WETH: Tokens.output({ network: 'goerli' }).WETH,
  },
};
