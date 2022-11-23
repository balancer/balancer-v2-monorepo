import Task, { TaskMode } from '../../src/task';

export type AaveLinearPoolDeployment = {
  Vault: string;
  BalancerQueries: string;
  ProtocolFeePercentagesProvider: string;
  FactoryVersion: string;
  PoolVersion: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const BalancerQueries = new Task('20220721-balancer-queries', TaskMode.READ_ONLY);
const ProtocolFeePercentagesProvider = new Task('20220725-protocol-fee-percentages-provider', TaskMode.READ_ONLY);

const BaseVersion = { version: 2, deployment: '20221115-aave-rebalanced-linear-pool' };

export default {
  Vault,
  BalancerQueries,
  ProtocolFeePercentagesProvider,
  FactoryVersion: JSON.stringify({ name: 'AaveLinearPoolFactory', ...BaseVersion }),
  PoolVersion: JSON.stringify({ name: 'AaveLinearPool', ...BaseVersion }),
};
