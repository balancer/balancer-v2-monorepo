import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { SingleRecipientFactoryDelegationDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as SingleRecipientFactoryDelegationDeployment;

  const args = [input.BalancerMinter];
  await task.deployAndVerify('SingleRecipientGaugeFactory', args, from, force);
};
