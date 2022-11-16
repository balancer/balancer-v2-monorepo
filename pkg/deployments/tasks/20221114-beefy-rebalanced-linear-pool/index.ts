import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { BeefyLinearPoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as BeefyLinearPoolDeployment;
  const args = [input.Vault, input.ProtocolFeePercentagesProvider, input.BalancerQueries];

  await task.deployAndVerify('BeefyLinearPoolFactory', args, from, force);
};
