import Task, { TaskMode } from '../../src/task';

export type PolygonZkEVMRootGaugeFactoryDeployment = {
  BalancerMinter: string;
  PolygonZkEVMBridge: string;
};

const BalancerMinter = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);

export default {
  mainnet: {
    BalancerMinter,
    PolygonZkEVMBridge: '0x2a3dd3eb832af982ec71669e178424b10dca2ede',
  },
};
