import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { FeeDistributorBALClaimerDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as FeeDistributorBALClaimerDeployment;

  const args = [input.FeeDistributor, input.Gauge, input.AuthorizerAdaptor];
  await task.deployAndVerify('FeeDistributorBALClaimer', args, from, force);
};
