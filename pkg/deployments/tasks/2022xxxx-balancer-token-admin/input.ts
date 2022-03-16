import Task from '../../src/task';

export type BalancerTokenAdminDeployment = {
  BAL: string;
  Vault: string;
};

const TestBALTask = new Task('2022xxxx-test-balancer-token');
const Vault = new Task('20210418-vault');

export default {
  mainnet: {
    BAL: '0xba100000625a3754423978a60c9317c58a424e3D',
    Vault,
  },
  kovan: {
    BAL: TestBALTask.output({ network: 'kovan' }).TestBalancerToken,
    Vault,
  },
};
