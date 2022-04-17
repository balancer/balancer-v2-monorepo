import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { PrimaryIssuePoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as PrimaryIssuePoolDeployment;
  const args = [input.Vault];
  await task.deployAndVerify('PrimaryIssuePoolFactory', args, from, force);
};
