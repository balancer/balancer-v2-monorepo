import Task from '../../src/task';

export type veBALGaugeFixCoordinatorDeployment = {
  AuthorizerAdaptor: string;
  BalancerTokenAdmin: string;
  GaugeController: string;
};

const AuthorizerAdaptor = new Task('20220325-authorizer-adaptor');
const BalancerTokenAdmin = new Task('20220325-balancer-token-admin');
const GaugeController = new Task('20220325-gauge-controller');

export default {
  mainnet: {
    AuthorizerAdaptor,
    BalancerTokenAdmin,
    GaugeController,
  },
};
