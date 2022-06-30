import Task, { TaskMode } from '../../src/task';

export type GnosisRootGaugeFactoryDeployment = {
  BalancerMinter: string;
  GnosisBridge: string;
};

const BalancerMinter = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);

export default {
  mainnet: {
    BalancerMinter,
    // This contract is the "Mediator" contract listed at the below link:
    // https://docs.tokenbridge.net/eth-xdai-amb-bridge/multi-token-extension
    GnosisBridge: '0x88ad09518695c6c3712ac10a214be5109a655671',
  },
};
