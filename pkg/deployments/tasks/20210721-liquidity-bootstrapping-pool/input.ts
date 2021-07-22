import Task from '../../src/task';

export type LiquidityBootstrappingPoolDeployment = {
  vault: string;
};

const vault = new Task('20210418-vault');

export default {
  vault,
};
