import Task from '../../../src/task';
import { TaskRunOptions } from '../../../src/types';
import { InvestmentPoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as InvestmentPoolDeployment;
  const args = [input.Vault];
  await task.deployAndVerify('InvestmentPoolFactory', args, from, force);
};
