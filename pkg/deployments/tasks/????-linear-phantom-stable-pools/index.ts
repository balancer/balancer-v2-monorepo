import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { LinearPhantomStablePoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as LinearPhantomStablePoolDeployment;

  const linearArgs = [input.Vault];
  await task.deployAndVerify('LinearPoolFactory', linearArgs, from, force);

  const stablePhantomArgs = [input.Vault];
  await task.deployAndVerify('StablePhantomPoolFactory', stablePhantomArgs, from, force);
};
