import Task, { TaskMode } from '../../src/task';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';

export type VaultDeployment = {
  Authorizer: string;
  WETH: string;
  pauseWindowDuration: number;
  bufferPeriodDuration: number;
};

const Authorizer = new Task('20210418-authorizer', TaskMode.READ_ONLY);
const WETH = new Task('00000000-tokens', TaskMode.READ_ONLY);

export default {
  Authorizer,
  pauseWindowDuration: 3 * MONTH,
  bufferPeriodDuration: MONTH,
  WETH,
};
