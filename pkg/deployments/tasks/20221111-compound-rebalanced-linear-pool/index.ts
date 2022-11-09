import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { CompoundLinearPoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as CompoundLinearPoolDeployment;
  const args = [input.Vault, input.ProtocolFeePercentagesProvider, input.BalancerQueries];

  await task.deployAndVerify('CompoundLinearPoolFactory', args, from, force);
};
