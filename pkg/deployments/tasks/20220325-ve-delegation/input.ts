import Task from '../../src/task';

export type TestBalancerTokenDeployment = {
  Vault: string;
  AuthorizerAdaptor: string;
  VotingEscrow: string;
  veDelegation: string;
};

const Vault = new Task('20210418-vault');
const AuthorizerAdaptor = new Task('2022xxxx-authorizer-adaptor');
const VotingEscrow = new Task('2022xxxx-gauge-controller');

export default {
  kovan: {
    Vault,
    AuthorizerAdaptor,
    VotingEscrow,
    veDelegation: '',
  },
};
