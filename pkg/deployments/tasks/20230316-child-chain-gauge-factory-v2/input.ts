import Task, { TaskMode } from '../../src/task';

export type ChildChainLiquidityGaugeFactoryDeployment = {
  VotingEscrowDelegationProxy: string;
  AuthorizerAdaptor: string;
  L2BalancerPseudoMinter: string;
  FactoryVersion: string;
  ProductVersion: string;
};

// const VotingEscrowDelegationProxy = new Task('20220325-ve-delegation', TaskMode.READ_ONLY);
const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY);
// const L2BalancerPseudoMinter = new Task('20230316-l2-balancer-pseudo-minter', TaskMode.READ_ONLY);
const BaseVersion = { version: 2, deployment: '20230316-child-chain-gauge-factory-v2' };

export default {
  VotingEscrowDelegationProxy: 'Remove me',
  AuthorizerAdaptor,
  L2BalancerPseudoMinter: 'Remove me',
  FactoryVersion: JSON.stringify({ name: 'ChildChainGaugeFactory', ...BaseVersion }),
  ProductVersion: JSON.stringify({ name: 'ChildChainGauge', ...BaseVersion }),
};
