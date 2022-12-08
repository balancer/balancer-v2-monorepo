import Task from '../../../src/task';
import { TaskRunOptions } from '../../../src/types';
import { LiquidityBootstrappingPoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as LiquidityBootstrappingPoolDeployment;
  const args = [input.Vault];
  await task.deployAndVerify('LiquidityBootstrappingPoolFactory', args, from, force);
};
