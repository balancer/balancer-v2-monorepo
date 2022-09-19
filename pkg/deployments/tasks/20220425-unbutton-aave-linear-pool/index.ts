import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { UnbuttonAaveLinearPoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as UnbuttonAaveLinearPoolDeployment;
  const args = [input.Vault];
  await task.deployAndVerify('UnbuttonAaveLinearPoolFactory', args, from, force);
};
