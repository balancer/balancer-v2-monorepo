import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { veBALDeploymentCoordinatorDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as veBALDeploymentCoordinatorDeployment;

  const args = [input.BalancerMinter, input.AuthorizerAdaptor, input.activationScheduledTime, input.secondStageDelay];
  await task.deployAndVerify('veBALDeploymentCoordinator', args, from, force);
};
