import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { StablePoolV2Deployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as StablePoolV2Deployment;

  const args = [input.Vault];
  await task.deployAndVerify('StablePoolFactory', args, from, force);
};
