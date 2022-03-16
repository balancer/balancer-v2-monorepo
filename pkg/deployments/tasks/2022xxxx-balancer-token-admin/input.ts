import Task from '../../src/task';

export type BalancerTokenAdminDeployment = {
  BAL: string;
  Vault: string;
};

const TestBAL = new Task('2021xxxx-test-balancer-token');
const Vault = new Task('20210418-vault');

export default {
  mainnet: {
    BAL: '0xba100000625a3754423978a60c9317c58a424e3D',
    Vault,
  },
  kovan: {
    BAL: TestBAL,
    Vault,
  },
};
