import Task, { TaskMode } from '../../src/task';

export type WeightedPoolDeployment = {
  Vault: string;
  ProtocolFeePercentagesProvider: string;
  FactoryVersion: string;
  PoolVersion: string;
  WETH: string;
  BAL: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const ProtocolFeePercentagesProvider = new Task('20220725-protocol-fee-percentages-provider', TaskMode.READ_ONLY);
const WETH = new Task('00000000-tokens', TaskMode.READ_ONLY);
const BAL = new Task('00000000-tokens', TaskMode.READ_ONLY);

const BaseVersion = { version: 4, deployment: '20230320-weighted-pool-v4' };

export default {
  Vault,
  ProtocolFeePercentagesProvider,
  WETH,
  BAL,
  FactoryVersion: JSON.stringify({ name: 'WeightedPoolFactory', ...BaseVersion }),
  PoolVersion: JSON.stringify({ name: 'WeightedPool', ...BaseVersion }),
};
