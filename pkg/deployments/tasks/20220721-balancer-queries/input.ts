import Task, { TaskMode } from '../../src/task';

export type BalancerQueriesDeployment = {
  Vault: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);

export default {
  Vault,
};
