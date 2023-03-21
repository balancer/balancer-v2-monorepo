import Task, { TaskMode } from '../../src/task';

export type L2BalancerPseudoMinterDeployment = {
  Vault: string;
  BAL: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const BAL = new Task('00000000-tokens', TaskMode.READ_ONLY);

export default {
  Vault,
  BAL,
};
