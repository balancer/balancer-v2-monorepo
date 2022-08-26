import Task, { TaskMode } from '../../src/task';

export type AaveLinearPoolDeployment = {
  Vault: string;
  BalancerQueries: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const BalancerQueries = new Task('20220721-balancer-queries', TaskMode.READ_ONLY);

export default {
  Vault,
  BalancerQueries,
};
