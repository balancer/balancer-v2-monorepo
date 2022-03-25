import Task from '../../src/task';

export type LiquidityGaugeFactoryDeployment = {
  AuthorizerAdaptor: string;
  BalancerMinter: string;
  VotingEscrowDelegationProxy: string;
};

const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor');
const BalancerMinter = new Task('20220325-gauge-controller');
const VotingEscrowDelegationProxy = new Task('20220325-ve-delegation');

export default {
  AuthorizerAdaptor,
  BalancerMinter,
  VotingEscrowDelegationProxy,
};
