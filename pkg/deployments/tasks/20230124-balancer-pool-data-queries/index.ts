import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { BalancerPoolDataQueriesDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as BalancerPoolDataQueriesDeployment;

  const args = [input.Vault];
  await task.deployAndVerify('BalancerPoolDataQueries', args, from, force);
};
