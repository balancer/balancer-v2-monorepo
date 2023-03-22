import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { L2BalancerPseudoMinterDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as L2BalancerPseudoMinterDeployment;

  await task.deployAndVerify('L2BalancerPseudoMinter', [input.Vault, input.BAL], from, force);
};
