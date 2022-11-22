import Task, { TaskMode } from '../../src/task';

export type PoolRecoveryHelperDeployment = {
  Vault: string;
  InitialFactories: Array<string>;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const ComposableStablePoolFactoryTask = new Task('20220906-composable-stable-pool', TaskMode.READ_ONLY);
const WeightedPoolFactoryTask = new Task('20220908-weighted-pool-v2', TaskMode.READ_ONLY);

export default {
  Vault,
  mainnet: {
    InitialFactories: [
      ComposableStablePoolFactoryTask.output({ network: 'mainnet' }).ComposableStablePoolFactory,
      WeightedPoolFactoryTask.output({ network: 'mainnet' }).WeightedPoolFactory,
    ],
  },
};
