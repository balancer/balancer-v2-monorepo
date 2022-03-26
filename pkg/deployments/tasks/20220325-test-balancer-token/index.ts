import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { TestBalancerTokenDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as TestBalancerTokenDeployment;

  const args = [input.Admin, 'Balancer Governance Token', 'BAL'];
  await task.deployAndVerify('TestBalancerToken', args, from, force);
};
