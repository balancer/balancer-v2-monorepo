import Task from '../../src/task';

export type SingleRecipientFactoryDelegationDeployment = {
  BalancerMinter: string;
};

const BalancerMinter = new Task('20220325-gauge-controller');

export default {
  BalancerMinter,
};
