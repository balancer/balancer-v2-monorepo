import Task from '../../src/task';

export type GaugeSystemDeployment = {
  AuthorizerAdaptor: string;
  BalancerMinter: string;
  Vault: string;
};

const AuthorizerAdaptor = new Task('2022xxxx-authorizer-adaptor');
const BalancerMinter = new Task('2022xxxx-gauge-controller');
const Vault = new Task('20210418-vault');

export default {
  mainnet: {
    AuthorizerAdaptor,
    BalancerMinter,
    Vault,
  },
};
