import Task, { TaskMode } from '../../src/task';

export type ChildChainGaugeTokenAdderDeployment = {
  ChildChainLiquidityGaugeFactory: string;
  AuthorizerAdaptor: string;
};

const ChildChainLiquidityGaugeFactory = new Task('20220413-child-chain-gauge-factory', TaskMode.READ_ONLY);
const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY);

export default {
  ChildChainLiquidityGaugeFactory,
  AuthorizerAdaptor,
};
