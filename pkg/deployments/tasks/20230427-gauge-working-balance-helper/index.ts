import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { GaugeWorkingBalanceHelperDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as GaugeWorkingBalanceHelperDeployment;

  await task.deployAndVerify(
    'GaugeWorkingBalanceHelper',
    [input.VotingEscrowDelegationProxy, input.ReadTotalSupplyFromVE],
    from,
    force
  );
};
