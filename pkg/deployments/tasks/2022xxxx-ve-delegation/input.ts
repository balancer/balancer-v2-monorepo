import Task from '../../src/task';

export type TestBalancerTokenDeployment = {
  Vault: string;
  VotingEscrow: string;
  veDelegation: string;
};

const Vault = new Task('20210418-vault');
const VotingEscrow = new Task('2022xxxx-gauge-controller');

export default {
  kovan: {
    Vault,
    VotingEscrow,
    veDelegation: '',
  },
};
