import Task, { TaskMode } from '../../src/task';

export type ERC4626LinearPoolDeployment = {
  Vault: string;
  ProtocolFeePercentagesProvider: string;
  BalancerQueries: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const ProtocolFeePercentagesProvider = new Task('20220725-protocol-fee-percentages-provider', TaskMode.READ_ONLY);
const BalancerQueries = new Task('20220721-balancer-queries', TaskMode.READ_ONLY);

export default {
  Vault,
  ProtocolFeePercentagesProvider,
  BalancerQueries
};
