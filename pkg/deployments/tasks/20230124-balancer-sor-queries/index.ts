import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { BalancerSorQueriesDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as BalancerSorQueriesDeployment;

  const args = [input.Vault];
  await task.deployAndVerify('BalancerSorQueries', args, from, force);
};
