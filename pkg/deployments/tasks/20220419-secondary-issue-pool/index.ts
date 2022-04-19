import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { SecondaryIssuePoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as SecondaryIssuePoolDeployment;
  const args = [input.Vault];
  await task.deployAndVerify('SecondaryIssuePoolFactory', args, from, force);
};
