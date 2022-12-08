import Task from '../../../src/task';
import { TaskRunOptions } from '../../../src/types';
import { veBALGaugeFixCoordinatorDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as veBALGaugeFixCoordinatorDeployment;

  const args = [input.AuthorizerAdaptor, input.BalancerTokenAdmin, input.GaugeController];
  await task.deployAndVerify('veBALGaugeFixCoordinator', args, from, force);
};
