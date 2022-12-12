import Task, { TaskMode } from '../../src/task';

export type PoolRecoveryHelperDeployment = {
  Vault: string;
  InitialFactories: Array<string>;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const ComposableStablePoolFactoryTask = new Task('20220906-composable-stable-pool', TaskMode.READ_ONLY);
const ComposableStablePoolFactoryV2Task = new Task('20221122-composable-stable-pool-v2', TaskMode.READ_ONLY);
const WeightedPoolFactoryTask = new Task('20220908-weighted-pool-v2', TaskMode.READ_ONLY);

export default {
  Vault,
  mainnet: {
    InitialFactories: [
      ComposableStablePoolFactoryTask.output({ network: 'mainnet' }).ComposableStablePoolFactory,
      WeightedPoolFactoryTask.output({ network: 'mainnet' }).WeightedPoolFactory,
    ],
  },
  goerli: {
    InitialFactories: [
      ComposableStablePoolFactoryTask.output({ network: 'goerli' }).ComposableStablePoolFactory,
      WeightedPoolFactoryTask.output({ network: 'goerli' }).WeightedPoolFactory,
    ],
  },
  polygon: {
    InitialFactories: [
      ComposableStablePoolFactoryTask.output({ network: 'polygon' }).ComposableStablePoolFactory,
      WeightedPoolFactoryTask.output({ network: 'polygon' }).WeightedPoolFactory,
    ],
  },
  arbitrum: {
    InitialFactories: [
      ComposableStablePoolFactoryTask.output({ network: 'arbitrum' }).ComposableStablePoolFactory,
      WeightedPoolFactoryTask.output({ network: 'arbitrum' }).WeightedPoolFactory,
    ],
  },
  optimism: {
    InitialFactories: [
      ComposableStablePoolFactoryTask.output({ network: 'optimism' }).ComposableStablePoolFactory,
      WeightedPoolFactoryTask.output({ network: 'optimism' }).WeightedPoolFactory,
    ],
  },
  bsc: {
    InitialFactories: [
      ComposableStablePoolFactoryTask.output({ network: 'bsc' }).ComposableStablePoolFactory,
      WeightedPoolFactoryTask.output({ network: 'bsc' }).WeightedPoolFactory,
    ],
  },
  gnosis: {
    InitialFactories: [
      ComposableStablePoolFactoryV2Task.output({ network: 'gnosis' }).ComposableStablePoolFactory,
      WeightedPoolFactoryTask.output({ network: 'gnosis' }).WeightedPoolFactory,
    ],
  },
};
