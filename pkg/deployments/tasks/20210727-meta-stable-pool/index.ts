import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { MetaStablePoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const query = await task.deployAndVerify('QueryProcessor', [], from, force);

  const input = task.input() as MetaStablePoolDeployment;
  const args = [input.Vault];
  await task.deployAndVerify('MetaStablePoolFactory', args, from, force, { QueryProcessor: query.address });
};
