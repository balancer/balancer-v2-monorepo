import Task, { TaskMode } from '../../../src/task';

export type veBALGaugeFixCoordinatorDeployment = {
  AuthorizerAdaptor: string;
  BalancerTokenAdmin: string;
  GaugeController: string;
};

const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor', TaskMode.READ_ONLY);
const BalancerTokenAdmin = new Task('20220325-balancer-token-admin', TaskMode.READ_ONLY);
const GaugeController = new Task('20220325-gauge-controller', TaskMode.READ_ONLY);

export default {
  mainnet: {
    AuthorizerAdaptor,
    BalancerTokenAdmin,
    GaugeController,
  },
};
