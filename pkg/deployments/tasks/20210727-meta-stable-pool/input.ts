import Task from '../../src/task';

export type MetaStablePoolDeployment = {
  Vault: string;
};

const Vault = new Task('20210418-vault');

export default {
  Vault,
};
