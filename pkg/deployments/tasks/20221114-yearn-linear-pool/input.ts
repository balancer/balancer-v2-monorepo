import Task, { TaskMode } from '../../src/task';

export type YearnLinearPoolDeployment = {
  Vault: string;
  ProtocolFeePercentagesProvider: string;
  YearnShareValueHelper: string;
  BalancerQueries: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const ProtocolFeePercentagesProvider = new Task('20220725-protocol-fee-percentages-provider', TaskMode.READ_ONLY);
const BalancerQueries = new Task('20220721-balancer-queries', TaskMode.READ_ONLY);

export default {
  kovan: {
    Vault,
    ProtocolFeePercentagesProvider,
    BalancerQueries,
    YearnShareValueHelper: '0x0000000000000000000000000000000000000000',
  },
  mainnet: {
    Vault,
    ProtocolFeePercentagesProvider,
    BalancerQueries,
    YearnShareValueHelper: '0x0000000000000000000000000000000000000000',
  },
  polygon: {
    Vault,
    ProtocolFeePercentagesProvider,
    BalancerQueries,
    YearnShareValueHelper: '0x0000000000000000000000000000000000000000',
  },
  arbitrum: {
    Vault,
    ProtocolFeePercentagesProvider,
    BalancerQueries,
    YearnShareValueHelper: '0x0000000000000000000000000000000000000000',
  },
  optimism: {
    Vault,
    ProtocolFeePercentagesProvider,
    BalancerQueries,
    YearnShareValueHelper: '0x8605c9f58a64fd60eb01ccaa99a1f7524bc37286',
  },
  goerli: {
    Vault,
    ProtocolFeePercentagesProvider,
    BalancerQueries,
    YearnShareValueHelper: '0x0000000000000000000000000000000000000000',
  },
};
