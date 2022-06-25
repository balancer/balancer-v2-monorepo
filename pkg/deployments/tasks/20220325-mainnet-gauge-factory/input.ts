import Task, { TaskMode } from '../../src/task';

export type LiquidityGaugeFactoryDeployment = {
  AuthorizerAdaptor: string;
  BalancerMinter: string;
  VotingEscrowDelegationProxy: string;
};

const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY);
const BalancerMinter = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);
const VotingEscrowDelegationProxy = new Task('20220325-ve-delegation', TaskMode.READ_ONLY);

export default {
  AuthorizerAdaptor,
  BalancerMinter,
  VotingEscrowDelegationProxy,
};
