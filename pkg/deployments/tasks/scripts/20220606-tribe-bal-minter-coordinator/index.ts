import Task from '../../../src/task';
import { TaskRunOptions } from '../../../src/types';
import { TribeBALMinterCoordinatorDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as TribeBALMinterCoordinatorDeployment;

  const args = [input.AuthorizerAdaptor];
  await task.deployAndVerify('TribeBALMinterCoordinator', args, from, force);
};
