import Task from '../../src/task';

export type veBALDeploymentCoordinatorDeployment = {
  AuthorizerAdaptor: string;
  BalancerMinter: string;
  activationScheduledTime: string;
  secondStageDelay: string;
};

const AuthorizerAdaptor = new Task('2022xxxx-authorizer-adaptor');
const BalancerMinter = new Task('2022xxxx-gauge-controller');

export default {
  AuthorizerAdaptor,
  BalancerMinter,
  kovan: {
    activationScheduledTime: '1647459355',
    secondStageDelay: '600',
  },
};
