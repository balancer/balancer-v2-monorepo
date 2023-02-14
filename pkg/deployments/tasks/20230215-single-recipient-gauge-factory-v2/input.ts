import Task, { TaskMode } from '../../src/task';

export type SingleRecipientGaugeFactoryDeployment = {
  BalancerMinter: string;
};

const BalancerMinter = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);

export default {
  BalancerMinter,
};
