import Task, { TaskMode } from '../../src/task';

export type NoProtocolFeeLiquidityBootstrappingPoolDeployment = {
  Vault: string;
  WETH: string;
  BAL: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const WETH = new Task('00000000-tokens', TaskMode.READ_ONLY);
const BAL = new Task('00000000-tokens', TaskMode.READ_ONLY);

export default {
  Vault,
  WETH,
  BAL,
};
