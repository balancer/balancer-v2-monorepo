import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { PoolRecoveryHelperDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as PoolRecoveryHelperDeployment;

  const args = [input.Vault, input.InitialFactories];
  await task.deployAndVerify('PoolRecoveryHelper', args, from, force);
};
