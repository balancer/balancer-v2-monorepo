import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { GaugeWorkingBalanceHelperDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as GaugeWorkingBalanceHelperDeployment;

  const isL1 = task.network == 'mainnet' || task.network == 'goerli';

  const proxy = isL1 ? input.L1VotingEscrowDelegationProxy : input.L2VotingEscrowDelegationProxy;
  const readTotalSupplyFromVE = isL1;

  await task.deployAndVerify('GaugeWorkingBalanceHelper', [proxy, readTotalSupplyFromVE], from, force);
};
