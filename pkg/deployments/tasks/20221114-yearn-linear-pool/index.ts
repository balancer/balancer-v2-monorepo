import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { YearnLinearPoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as YearnLinearPoolDeployment;

  const args = [input.Vault, input.ProtocolFeePercentagesProvider, input.BalancerQueries, input.YearnShareValueHelper];
  await task.deployAndVerify('YearnLinearPoolFactory', args, from, force);
};
