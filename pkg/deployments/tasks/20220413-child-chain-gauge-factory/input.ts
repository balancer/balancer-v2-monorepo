import Task, { TaskMode } from '../../src/task';

export type ChildChainLiquidityGaugeFactoryDeployment = {
  AuthorizerAdaptor: string;
  BAL: string;
  Vault: string;
};

const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY);
const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const BAL = new Task('00000000-tokens', TaskMode.READ_ONLY);

export default {
  AuthorizerAdaptor,
  Vault,
  BAL,
};
