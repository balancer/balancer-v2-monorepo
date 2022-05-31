import Task, { TaskMode } from '../../src/task';

export type ChildChainGaugeTokenAdderDeployment = {
  ChildChainLiquidityGaugeFactory: string;
  AuthorizerAdaptor: string;
};

const ChildChainLiquidityGaugeFactory = new Task('child-chain-gauge-factory', TaskMode.READ_ONLY);
const AuthorizerAdaptor = new Task('authorizer-adaptor', TaskMode.READ_ONLY);

export default {
  ChildChainLiquidityGaugeFactory,
  AuthorizerAdaptor,
};
