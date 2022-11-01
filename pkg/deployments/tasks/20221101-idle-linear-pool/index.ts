import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { IdleLinearPoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as IdleLinearPoolDeployment;
  const args = [input.Vault, input.ProtocolFeePercentagesProvider];

  await task.deployAndVerify('IdleLinearPoolFactory', args, from, force);
};
